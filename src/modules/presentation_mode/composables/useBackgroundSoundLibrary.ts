import { computed, ref } from "vue";
import $idb from "@/helpers/IndexedDB";
import Telemetry from "@/helpers/Telemetry";
import { DB_TABLE } from "@/constants/DbTables";
import { blobOf } from "@/helpers/Bytes";

/**
 * A biblioteca do módulo Som de Fundo vista do Modo apresentação: categorias e
 * sons do IndexedDB, só para listar, tocar e acrescentar ao programa. A
 * organização continua no módulo Som de Fundo.
 *
 * O som não é um arquivo da biblioteca de arquivos: o registro pode ter bytes
 * (`data`), caminho de disco ou os dois. Quem resolve a URL reproduzível é
 * `resolveBackgroundSoundPath`, com a mesma regra do player do módulo.
 */

/** O que o módulo grava; aqui só se lê. */
export interface BackgroundSoundRecord {
  id: string;
  name: string;
  fileName?: string;
  path?: string;
  categoryId?: string;
  order?: number;
  mime?: string;
  data?: Blob | ArrayBuffer;
  size?: number;
}

export interface BackgroundSoundCategory {
  id: string;
  name: string;
  icon?: string;
  iconType?: "icon" | "image";
  color?: string;
  /** Bytes do ícone enviado pelo usuário; sobrevivem ao blob URL da sessão. */
  iconData?: Blob | ArrayBuffer | Uint8Array | null;
  iconMime?: string | null;
}

/** Filtro: todas, uma categoria, ou as sem categoria (id ""). */
export const BACKGROUND_SOUND_ALL = "*";
export const BACKGROUND_SOUND_UNCATEGORIZED = "";

/** O nome que o módulo mostra: o campo `name` ou o arquivo sem extensão. */
export function backgroundSoundName(record: BackgroundSoundRecord): string {
  const file = record.fileName || "";
  const withoutExtension = file.replace(/\.[^.]+$/, "");
  return record.name || withoutExtension || record.id;
}

const _records = ref<BackgroundSoundRecord[]>([]);
const _categories = ref<BackgroundSoundCategory[]>([]);
const _filter = ref<string>(BACKGROUND_SOUND_ALL);
const _loading = ref(false);
const _loaded = ref(false);
const _categoryIconUrls = new Map<string, string>();

function disposeCategoryIcons(): void {
  for (const url of _categoryIconUrls.values()) {
    if (url.startsWith("blob:")) URL.revokeObjectURL(url);
  }
  _categoryIconUrls.clear();
}

/** Ícone de imagem da categoria, recriando o blob a partir dos bytes persistidos. */
function categoryImageOf(category: BackgroundSoundCategory): string {
  if (category.iconType !== "image") return "";
  if (category.iconData) {
    const cached = _categoryIconUrls.get(category.id);
    if (cached) return cached;
    const blob = blobOf(category.iconData, category.iconMime || "image/png");
    if (!blob) return "";
    const url = URL.createObjectURL(blob);
    _categoryIconUrls.set(category.id, url);
    return url;
  }
  const raw = (category.icon || "").trim();
  return /^(data:image\/|https?:\/\/|blob:)/i.test(raw) ? raw : "";
}

async function load(): Promise<void> {
  if (_loading.value) return;
  _loading.value = true;
  try {
    const [records, categories] = await Promise.all([
      $idb.getAll<BackgroundSoundRecord>(DB_TABLE.BACKGROUND_SOUND_LIBRARY),
      $idb.getAll<BackgroundSoundCategory>(DB_TABLE.BACKGROUND_SOUND_CATEGORY),
    ]);
    // A troca dos registros e a limpeza das URLs acontecem no mesmo tick; o
    // render seguinte recria só os ícones das categorias que continuam.
    disposeCategoryIcons();
    _records.value = [...records].sort(
      (a, b) =>
        (a.order ?? 0) - (b.order ?? 0) ||
        backgroundSoundName(a).localeCompare(backgroundSoundName(b))
    );
    _categories.value = [...categories].sort((a, b) => a.name.localeCompare(b.name));
    // A categoria escolhida sumiu (apagada no módulo): volta para todas.
    if (
      _filter.value !== BACKGROUND_SOUND_ALL &&
      _filter.value !== BACKGROUND_SOUND_UNCATEGORIZED &&
      !_categories.value.some((category) => category.id === _filter.value)
    ) {
      _filter.value = BACKGROUND_SOUND_ALL;
    }
  } catch (error) {
    Telemetry.captureException(error, { source: "presentation_mode.background_sound.load" });
    disposeCategoryIcons();
    _records.value = [];
    _categories.value = [];
  } finally {
    _loading.value = false;
    _loaded.value = true;
  }
}

export function useBackgroundSoundLibrary() {
  const categoryById = computed(
    () => new Map(_categories.value.map((category) => [category.id, category]))
  );

  const categoryOf = (record: BackgroundSoundRecord): BackgroundSoundCategory | null =>
    categoryById.value.get(String(record.categoryId || "")) ?? null;

  const filtered = computed(() => {
    if (_filter.value === BACKGROUND_SOUND_ALL) return _records.value;
    return _records.value.filter(
      (record) => (categoryOf(record)?.id ?? BACKGROUND_SOUND_UNCATEGORIZED) === _filter.value
    );
  });

  /** "Sem categoria" inclui registros cuja categoria foi apagada. */
  const hasUncategorized = computed(() => _records.value.some((record) => !categoryOf(record)));

  const countOf = (categoryId: string): number =>
    _records.value.filter(
      (record) => (categoryOf(record)?.id ?? BACKGROUND_SOUND_UNCATEGORIZED) === categoryId
    ).length;

  return {
    records: _records,
    categories: _categories,
    filter: _filter,
    loading: _loading,
    loaded: _loaded,
    filtered,
    hasUncategorized,
    countOf,
    categoryOf,
    categoryImageOf,
    load,
    disposeCategoryIcons,
    displayName: backgroundSoundName,
  };
}
