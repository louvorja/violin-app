import { computed, ref } from "vue";
import $idb from "@/helpers/IndexedDB";
import Platform from "@/helpers/Platform";
import Telemetry from "@/helpers/Telemetry";
import { DB_TABLE } from "@/constants/DbTables";
import type { LibraryEntry } from "./useFileLibrary";

/**
 * A Biblioteca de Mídia nativa (módulo `media_library`) vista do Modo
 * apresentação: os mesmos registros do IndexedDB, só para ler. Organizar,
 * importar e apagar continuam lá — aqui o operador só projeta.
 *
 * No desktop o registro guarda o caminho do arquivo no disco, e isso basta:
 * vira um `LibraryEntry` e segue pela prévia, ar, retorno e programa como
 * qualquer arquivo da aba Arquivos. O que foi guardado como bytes (o HEIC
 * arrastado, tudo no navegador) não tem caminho, e só abre por lá.
 */

/** O que a Biblioteca de Mídia grava; aqui só se lê. */
export interface NativeMediaRecord {
  id: string;
  name: string;
  path: string;
  type: string;
  addedAt: number;
  categoryId?: string;
}

export interface NativeMediaCategory {
  id: string;
  name: string;
  color?: string;
}

/** Filtro: todas, uma categoria, ou as sem categoria (id ""). */
export const ALL = "*";

/**
 * O arquivo no disco por trás do registro, ou `null` quando não há: blob,
 * endereço da web ou registro sem caminho.
 */
export function entryOf(record: NativeMediaRecord): LibraryEntry | null {
  const path = record.path || "";
  if (!path || /^(blob:|data:|https?:|louvorja:)/i.test(path)) return null;
  const base = path.split(/[\\/]/).filter(Boolean).pop() || record.name;
  const ext = base.includes(".") ? (base.split(".").pop() ?? "").toLowerCase() : "";
  return { name: record.name || base, path, isDir: false, ext, size: 0, mtimeMs: record.addedAt || 0 };
}

const _records = ref<NativeMediaRecord[]>([]);
const _categories = ref<NativeMediaCategory[]>([]);
const _loading = ref(false);
const _loaded = ref(false);
const _filter = ref<string>(ALL);

async function load(): Promise<void> {
  if (_loading.value) return;
  _loading.value = true;
  try {
    const [records, categories] = await Promise.all([
      $idb.getAll<NativeMediaRecord>(DB_TABLE.MEDIA_LIBRARY),
      $idb.getAll<NativeMediaCategory>(DB_TABLE.MEDIA_LIBRARY_CATEGORY),
    ]);
    // A ordem da própria Biblioteca: o mais recente primeiro; categorias por nome.
    _records.value = [...records].sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
    _categories.value = [...categories].sort((a, b) => a.name.localeCompare(b.name));
    // A categoria escolhida sumiu (apagada na Biblioteca): volta para todas.
    if (_filter.value !== ALL && _filter.value !== "" && !_categories.value.some((c) => c.id === _filter.value))
      _filter.value = ALL;
  } catch (e) {
    Telemetry.captureException(e, { source: "presentation_mode.native_library.load" });
    _records.value = [];
    _categories.value = [];
  } finally {
    _loading.value = false;
    _loaded.value = true;
  }
}

export function useNativeMediaLibrary() {
  const inFilter = computed(() =>
    _filter.value === ALL ? _records.value : _records.value.filter((r) => (r.categoryId || "") === _filter.value)
  );
  const entries = computed(() =>
    inFilter.value.map(entryOf).filter((e): e is LibraryEntry => e !== null)
  );
  /** Registros do filtro que não têm arquivo no disco: só abrem na Biblioteca. */
  const unavailable = computed(() => inFilter.value.length - entries.value.length);
  /** "Sem categoria" só aparece quando há o que mostrar nela. */
  const hasUncategorized = computed(() => _records.value.some((r) => !r.categoryId));
  /** Conta o que a grade mostra: o que não tem arquivo fica só no aviso do rodapé. */
  const countOf = (categoryId: string): number =>
    _records.value.filter(
      (r) => (categoryId === ALL || (r.categoryId || "") === categoryId) && entryOf(r) !== null
    ).length;

  return {
    supported: Platform.isDesktop,
    records: _records,
    categories: _categories,
    filter: _filter,
    loading: _loading,
    loaded: _loaded,
    entries,
    unavailable,
    hasUncategorized,
    countOf,
    load,
  };
}
