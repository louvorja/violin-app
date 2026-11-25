import { computed, ref } from "vue";
import $idb from "@/helpers/IndexedDB";
import Telemetry from "@/helpers/Telemetry";
import { DB_TABLE } from "@/constants/DbTables";
import { blobOf } from "@/helpers/Bytes";
import { fetchYoutubeTitle, youtubeThumb } from "@/helpers/OnlineVideo";
import { useOnlineVideoDownloads } from "@/composables/useOnlineVideoDownloads";
import { createVideoTitleEnrichment } from "@/modules/custom_online_videos/helpers/VideoTitleEnrichment";

/**
 * "Meus Vídeos Online" vistos do Modo apresentação: os links salvos pelo
 * operador, suas categorias e as miniaturas já guardadas no IndexedDB.
 * Adicionar aqui grava na mesma biblioteca do módulo; organizar continua lá.
 */

export interface CustomOnlineVideo {
  id: string;
  name: string;
  url: string;
  createdAt: string;
  categoryId?: string;
  order?: number;
}

export interface CustomOnlineCategory {
  id: string;
  name: string;
  icon?: string;
  iconType?: "icon" | "image";
  color?: string;
  iconData?: Blob | ArrayBuffer | Uint8Array | null;
  iconMime?: string | null;
}

interface ThumbnailRow {
  id?: string;
  video_id?: string;
  blob: ArrayBuffer;
  mime?: string;
}

export interface AddCustomVideoInput {
  url: string;
  name?: string;
  categoryId?: string;
}

export type AddCustomVideoResult =
  | { ok: true; video: CustomOnlineVideo }
  | { ok: false; error: "invalid" | "duplicate" };

const _videos = ref<CustomOnlineVideo[]>([]);
const _categories = ref<CustomOnlineCategory[]>([]);
const _loading = ref(false);
const _loaded = ref(false);
const _error = ref(false);
const _thumbUrls = ref<Record<string, string>>({});
const _categoryIconUrls = new Map<string, string>();

const YT_ID_RE =
  /(?:youtube\.com\/watch\?(?:[^#]*&)?v=|youtu\.be\/|youtube\.com\/(?:embed|v|shorts)\/)([a-zA-Z0-9_-]{11})/;

function youtubeIdOf(url: string | null | undefined): string | null {
  return typeof url === "string" ? url.match(YT_ID_RE)?.[1] ?? null : null;
}

function revokeAll(urls: Record<string, string>): void {
  for (const url of Object.values(urls)) {
    if (url.startsWith("blob:")) URL.revokeObjectURL(url);
  }
}

function revokeCategoryIcons(): void {
  for (const url of _categoryIconUrls.values()) {
    if (url.startsWith("blob:")) URL.revokeObjectURL(url);
  }
  _categoryIconUrls.clear();
}

function disposeThumbs(): void {
  revokeAll(_thumbUrls.value);
  _thumbUrls.value = {};
  revokeCategoryIcons();
}

const titleEnrichment = createVideoTitleEnrichment<CustomOnlineVideo>({
  find: (id) => _videos.value.find((video) => video.id === id),
  fetchTitle: fetchYoutubeTitle,
  persist: (video) => $idb.put(DB_TABLE.CUSTOM_ONLINE_VIDEOS, video),
});

async function load(): Promise<void> {
  if (_loading.value) return;
  _loading.value = true;
  _error.value = false;
  try {
    const [videos, categories, thumbnails] = await Promise.all([
      $idb.getAll<CustomOnlineVideo>(DB_TABLE.CUSTOM_ONLINE_VIDEOS),
      $idb.getAll<CustomOnlineCategory>(DB_TABLE.CUSTOM_ONLINE_VIDEOS_CATEGORIES),
      $idb.getAll<ThumbnailRow>(DB_TABLE.CUSTOM_ONLINE_VIDEOS_THUMBNAILS),
    ]);

    const nextThumbs: Record<string, string> = {};
    for (const thumb of thumbnails) {
      const key = thumb.id || thumb.video_id || "";
      const id = thumb.video_id || thumb.id || "";
      if (!key || !id || !thumb.blob || nextThumbs[id]) continue;
      const blob = new Blob([thumb.blob], { type: thumb.mime || "image/jpeg" });
      nextThumbs[id] = URL.createObjectURL(blob);
    }

    // Só revoga as antigas depois de preparar as novas.
    disposeThumbs();
    _thumbUrls.value = nextThumbs;
    _videos.value = [...videos]
      .filter((video) => !!video?.id && !!video.url)
      .sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1));
    _categories.value = [...categories]
      .filter((category) => !!category?.id && !!category.name)
      .sort((a, b) => a.name.localeCompare(b.name));
    _loaded.value = true;
  } catch (error) {
    Telemetry.captureException(error, {
      source: "presentation_mode.custom_online_videos.load",
    });
    disposeThumbs();
    _videos.value = [];
    _categories.value = [];
    _loaded.value = false;
    _error.value = true;
  } finally {
    _loading.value = false;
  }
}

async function addVideo(input: AddCustomVideoInput): Promise<AddCustomVideoResult> {
  const url = String(input.url || "").trim();
  const ytId = youtubeIdOf(url);
  if (!ytId) return { ok: false, error: "invalid" };
  if (_videos.value.some((video) => youtubeIdOf(video.url) === ytId)) {
    return { ok: false, error: "duplicate" };
  }

  const typedName = String(input.name || "").trim();
  const categoryId = _categories.value.some((category) => category.id === input.categoryId)
    ? input.categoryId
    : undefined;
  const video: CustomOnlineVideo = {
    id: crypto.randomUUID(),
    name: typedName || ytId,
    url,
    createdAt: new Date().toISOString(),
    categoryId,
  };

  await $idb.put(DB_TABLE.CUSTOM_ONLINE_VIDEOS, video);
  _videos.value = [video, ..._videos.value];

  if (!typedName) {
    titleEnrichment.enrich({
      id: video.id,
      videoId: ytId,
      url,
      temporaryName: video.name,
    });
  }

  // A opção de download automático decide se começa; um clique no card
  // continua podendo baixar manualmente.
  void useOnlineVideoDownloads().startForNewLink(ytId, video.name);

  return { ok: true, video };
}

export function useCustomOnlineVideos() {
  const categoryById = computed(
    () => new Map(_categories.value.map((category) => [category.id, category]))
  );

  function categoryOf(video: CustomOnlineVideo): CustomOnlineCategory | null {
    return categoryById.value.get(String(video.categoryId || "")) ?? null;
  }

  function videosOfCategory(categoryId: string): CustomOnlineVideo[] {
    const normalized = categoryId || "";
    return _videos.value.filter((video) => (categoryOf(video)?.id ?? "") === normalized);
  }

  function countOf(categoryId: string): number {
    return videosOfCategory(categoryId).length;
  }

  function thumbOf(video: CustomOnlineVideo): string {
    const cached = _thumbUrls.value[video.id];
    if (cached) return cached;
    const videoId = youtubeIdOf(video.url);
    return videoId ? youtubeThumb(videoId) : "";
  }

  function categoryImageOf(category: CustomOnlineCategory): string {
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

  return {
    videos: _videos,
    categories: _categories,
    loading: _loading,
    loaded: _loaded,
    error: _error,
    categoryOf,
    videosOfCategory,
    countOf,
    hasUncategorized: computed(() => _videos.value.some((video) => !categoryOf(video))),
    thumbOf,
    categoryImageOf,
    displayName: (video: CustomOnlineVideo) => (video.name || "").trim() || video.id,
    youtubeIdOf,
    load,
    addVideo,
    disposeThumbs,
  };
}
