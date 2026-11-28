import { computed, ref } from "vue";
import $idb from "@/helpers/IndexedDB";
import $path from "@/helpers/Path";
import Telemetry from "@/helpers/Telemetry";
import { DB_TABLE } from "@/constants/DbTables";
import { resolveBackgroundProjectionUrl } from "@/helpers/BackgroundProjectionPlayback";
import { blobOf } from "@/helpers/Bytes";

/**
 * A biblioteca do módulo Projeção de Fundo vista do Modo apresentação: fotos e
 * vídeos do IndexedDB, com categorias e miniaturas. Organizar continua no
 * módulo; aqui o operador ativa a projeção ou acrescenta a mídia ao programa.
 */

export interface BackgroundProjectionFile {
  id: string;
  name: string;
  path?: string | null;
  type: "image" | "video";
  categoryId?: string;
  thumb?: string | null;
  addedAt?: number;
  data?: Blob | ArrayBuffer | Uint8Array | null;
  mime?: string | null;
  size?: number;
  order?: number;
}

export interface BackgroundProjectionCategory {
  id: string;
  name: string;
  icon?: string;
  iconType?: "icon" | "image";
  color?: string;
  /** Bytes do ícone enviado pelo usuário; sobrevivem ao blob URL da sessão. */
  iconData?: Blob | ArrayBuffer | Uint8Array | null;
  iconMime?: string | null;
}

export const BACKGROUND_PROJECTION_ALL = "*";
export const BACKGROUND_PROJECTION_UNCATEGORIZED = "";

export function backgroundProjectionName(file: BackgroundProjectionFile): string {
  return (file.name || "").trim() || file.id;
}

const _records = ref<BackgroundProjectionFile[]>([]);
const _categories = ref<BackgroundProjectionCategory[]>([]);
const _filter = ref<string>(BACKGROUND_PROJECTION_ALL);
const _loading = ref(false);
const _loaded = ref(false);
const _thumbUrls = new Map<string, string>();
const _categoryIconUrls = new Map<string, string>();

function revokeAll(urls: Map<string, string>): void {
  for (const url of urls.values()) {
    if (url.startsWith("blob:")) URL.revokeObjectURL(url);
  }
  urls.clear();
}

function disposeThumbs(): void {
  revokeAll(_thumbUrls);
  revokeAll(_categoryIconUrls);
}

/** Ícone de imagem da categoria, recriando o blob a partir dos bytes persistidos. */
function categoryImageOf(category: BackgroundProjectionCategory): string {
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

function thumbOf(file: BackgroundProjectionFile): string {
  const raw = (file.thumb || "").trim();
  if (raw) {
    if (/^blob:/i.test(raw)) {
      // Blob URL de outra sessão não vale; para imagens os bytes são a fonte
      // confiável. Vídeo não tem miniatura recuperável a partir do vídeo.
      if (file.type === "image" && file.data && file.mime) {
        const cached = _thumbUrls.get(file.id);
        if (cached) return cached;
        const url = resolveBackgroundProjectionUrl(file);
        if (url) {
          _thumbUrls.set(file.id, url);
          return url;
        }
      }
    } else if (/^(data|https?|louvorja|file):/i.test(raw)) {
      return raw;
    } else {
      return $path.media(raw);
    }
  }

  if (file.type !== "image") return "";
  const cached = _thumbUrls.get(file.id);
  if (cached) return cached;
  const url = resolveBackgroundProjectionUrl(file);
  if (url) _thumbUrls.set(file.id, url);
  return url;
}

async function load(): Promise<void> {
  if (_loading.value) return;
  _loading.value = true;
  try {
    const [records, categories] = await Promise.all([
      $idb.getAll<BackgroundProjectionFile>(DB_TABLE.BACKGROUND_PROJECTION_LIBRARY),
      $idb.getAll<BackgroundProjectionCategory>(DB_TABLE.BACKGROUND_PROJECTION_CATEGORIES),
    ]);
    // Só aqui as URLs antigas podem cair: os registros novos entram no mesmo
    // tick, antes do próximo render, que recria as miniaturas necessárias.
    disposeThumbs();
    _records.value = [...records]
      .filter(
        (file): file is BackgroundProjectionFile =>
          !!file &&
          typeof file.id === "string" &&
          file.id.length > 0 &&
          (file.type === "image" || file.type === "video")
      )
      .sort(
        (a, b) =>
          (a.order ?? 0) - (b.order ?? 0) ||
          backgroundProjectionName(a).localeCompare(backgroundProjectionName(b))
      );
    _categories.value = [...categories]
      .filter(
        (category): category is BackgroundProjectionCategory =>
          !!category && typeof category.id === "string" && typeof category.name === "string"
      )
      .sort((a, b) => a.name.localeCompare(b.name));
    if (
      _filter.value !== BACKGROUND_PROJECTION_ALL &&
      _filter.value !== BACKGROUND_PROJECTION_UNCATEGORIZED &&
      !_categories.value.some((category) => category.id === _filter.value)
    ) {
      _filter.value = BACKGROUND_PROJECTION_ALL;
    }
  } catch (error) {
    Telemetry.captureException(error, {
      source: "presentation_mode.background_projection.load",
    });
    disposeThumbs();
    _records.value = [];
    _categories.value = [];
  } finally {
    _loading.value = false;
    _loaded.value = true;
  }
}

export function useBackgroundProjectionLibrary() {
  const categoryById = computed(
    () => new Map(_categories.value.map((category) => [category.id, category]))
  );

  const categoryOf = (file: BackgroundProjectionFile): BackgroundProjectionCategory | null =>
    categoryById.value.get(String(file.categoryId || "")) ?? null;

  const filtered = computed(() => {
    if (_filter.value === BACKGROUND_PROJECTION_ALL) return _records.value;
    return _records.value.filter(
      (file) => (categoryOf(file)?.id ?? BACKGROUND_PROJECTION_UNCATEGORIZED) === _filter.value
    );
  });

  const hasUncategorized = computed(() => _records.value.some((file) => !categoryOf(file)));

  const countOf = (categoryId: string): number =>
    _records.value.filter(
      (file) => (categoryOf(file)?.id ?? BACKGROUND_PROJECTION_UNCATEGORIZED) === categoryId
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
    thumbOf,
    load,
    disposeThumbs,
    displayName: backgroundProjectionName,
  };
}
