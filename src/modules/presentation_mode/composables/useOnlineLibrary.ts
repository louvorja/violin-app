import { computed, ref, shallowRef } from "vue";
import $alert from "@/helpers/Alert";
import $docs from "@/helpers/DocStore";
import $idb from "@/helpers/IndexedDB";
import Telemetry from "@/helpers/Telemetry";
import { DB_TABLE } from "@/constants/DbTables";
import {
  collectionsAvailable,
  listCollection,
  youtubeOembed,
  youtubeSourceFromUrl,
  type YouTubeCollectionEntry,
  type YouTubeCollectionSource,
} from "@/helpers/OnlineVideo";
import { newId } from "./useProgram";

/**
 * Vídeos on-line da biblioteca: os favoritos do operador — vídeos soltos,
 * playlists e canais do YouTube — e o que está aberto na aba. O canal mostra
 * os vídeos do mais recente ao mais antigo; a playlist, na ordem dela. As
 * duas listas vêm aos pedaços, conforme o operador rola até o fim.
 *
 * Cada consulta ao YouTube passa pelo yt-dlp e leva segundos. Por isso a
 * primeira página de cada lista fica guardada em cache: abrir a lista é
 * imediato, e ela só é consultada de novo quando a cópia envelhece ou o
 * operador pede. O cache mora no IndexedDB, não no documento do favorito —
 * a pasta de documentos costuma ser sincronizada, e a cópia muda o tempo todo.
 */

interface FavoriteBase {
  id: string;
  title: string;
  channel?: string;
  addedAt: string;
  order: number;
}

export interface OnlineVideoFavorite extends FavoriteBase {
  kind: "video";
  /** O ID de 11 caracteres. */
  ytId: string;
  duration?: number | null;
}

export interface OnlineCollectionFavorite extends FavoriteBase {
  kind: YouTubeCollectionSource["kind"];
  /** Playlist: o `list=`. Canal: "UC…" ou "@nome". */
  ytId: string;
  thumbnail?: string | null;
  /** Playlist: o vídeo cuja capa a representa (o primeiro dela). */
  coverVideoId?: string;
}

export type OnlineFavorite = OnlineVideoFavorite | OnlineCollectionFavorite;

/** Um vídeo listado na aba — favorito solto ou de uma playlist/canal aberto. */
export interface OnlineEntry {
  id: string;
  title: string;
  duration: number | null;
  channel?: string;
}

/** A primeira página da última consulta de uma playlist/canal, pelo id do favorito. */
interface PageCache {
  id: string;
  entries: OnlineEntry[];
  hasMore: boolean;
  fetchedAt: string;
}

/** O que está aberto: os vídeos soltos, ou uma playlist/canal favorito. */
export const VIDEOS = "__videos__";

const TABLE = DB_TABLE.PRESENTATION_ONLINE;
const CACHE = DB_TABLE.PRESENTATION_ONLINE_CACHE;
const PAGE = 50;
/**
 * Depois disto a cópia guardada é mostrada, mas a lista é consultada de novo.
 * Folgado de propósito: cada consulta conta para o bloqueio "não é um robô" do
 * YouTube, e num culto a lista não muda — atualizar continua a um clique.
 */
const STALE_MS = 6 * 60 * 60 * 1000;

const favorites = ref<OnlineFavorite[]>([]);
let loaded: Promise<void> | null = null;

const openId = ref<string>(VIDEOS);
const entries = shallowRef<OnlineEntry[]>([]);
const hasMore = ref(false);
const loading = ref(false);
const error = ref<string | null>(null);
let generation = 0;

/** Lista de onde saiu o vídeo no ar: Anterior/Próximo andam por ela. */
const queue = shallowRef<{ entries: OnlineEntry[]; index: number } | null>(null);

const isCollection = (f: OnlineFavorite): f is OnlineCollectionFavorite => f.kind !== "video";

function ensureLoaded(): Promise<void> {
  loaded ??= $docs
    .getAll<OnlineFavorite>(TABLE)
    .then((docs) => {
      favorites.value = [...docs].sort((a, b) => a.order - b.order);
      if (openId.value === VIDEOS) entries.value = videoEntries();
    })
    .catch((e: unknown) => {
      loaded = null;
      Telemetry.captureException(e, { source: "presentation_mode.online.load" });
    });
  return loaded;
}

const videos = computed(() => favorites.value.filter((f): f is OnlineVideoFavorite => f.kind === "video"));
const collections = computed(() => favorites.value.filter(isCollection));
const openFavorite = computed(() => collections.value.find((f) => f.id === openId.value) ?? null);

function videoEntries(): OnlineEntry[] {
  return videos.value.map((f) => ({ id: f.ytId, title: f.title, duration: f.duration ?? null, channel: f.channel }));
}

function toEntries(list: YouTubeCollectionEntry[], channel?: string): OnlineEntry[] {
  return list.map((e) => ({ id: e.id, title: e.title, duration: e.duration, channel }));
}

function sourceOf(fav: OnlineCollectionFavorite): YouTubeCollectionSource {
  return { kind: fav.kind, id: fav.ytId };
}

function writeCache(id: string, list: OnlineEntry[], more: boolean): void {
  const page: PageCache = { id, entries: list.slice(0, PAGE), hasMore: more, fetchedAt: new Date().toISOString() };
  void $idb.put(CACHE, page).catch((e: unknown) => {
    Telemetry.captureException(e, { source: "presentation_mode.online.cache" });
  });
}

async function readCache(id: string): Promise<PageCache | null> {
  try {
    return (await $idb.get<PageCache>(CACHE, id)) ?? null;
  } catch {
    return null;
  }
}

export type AddResult = "added" | "exists" | "invalid" | "desktop_only" | "not_found";

/**
 * Favorita o que o link aponta. O título vem do YouTube na hora: oEmbed para
 * o vídeo, a primeira página da lista para playlist e canal.
 */
async function addFromUrl(url: string, lang: string): Promise<{ result: AddResult; favorite?: OnlineFavorite }> {
  await ensureLoaded();
  const source = youtubeSourceFromUrl(url.trim());
  if (!source) return { result: "invalid" };
  const existing = favorites.value.find((f) => f.kind === source.kind && f.ytId === source.id);
  if (existing) return { result: "exists", favorite: existing };

  const base = { id: newId(), addedAt: new Date().toISOString(), order: (favorites.value.at(-1)?.order ?? 0) + 1 };
  let favorite: OnlineFavorite;
  if (source.kind === "video") {
    const meta = await youtubeOembed(source.id);
    if (!meta) return { result: "not_found" };
    favorite = { ...base, kind: "video", ytId: source.id, title: meta.title || source.id, channel: meta.channel };
  } else {
    if (!collectionsAvailable()) return { result: "desktop_only" };
    try {
      // Uma consulta só: o título e a primeira página vêm juntos.
      const first = await listCollection(source, { start: 1, count: PAGE, lang });
      favorite = {
        ...base,
        kind: source.kind,
        ytId: source.id,
        title: first.title || source.id,
        channel: first.channel,
        thumbnail: first.thumbnail,
        coverVideoId: first.entries[0]?.id,
      };
      writeCache(favorite.id, toEntries(first.entries, first.channel), first.hasMore);
    } catch {
      return { result: "not_found" };
    }
  }
  favorites.value = [...favorites.value, favorite];
  await $docs.put(TABLE, favorite);
  if (openId.value === VIDEOS) entries.value = videoEntries();
  return { result: "added", favorite };
}

async function remove(id: string): Promise<void> {
  favorites.value = favorites.value.filter((f) => f.id !== id);
  await Promise.all([$docs.del(TABLE, id), $idb.del(CACHE, id).catch(() => {})]);
  if (openId.value === id) void open(VIDEOS);
  else if (openId.value === VIDEOS) entries.value = videoEntries();
}

/** Reordena as playlists e canais; só regrava os favoritos que mudaram de lugar. */
async function reorder(list: OnlineCollectionFavorite[]): Promise<void> {
  const next = [...videos.value, ...list].map((f, i) => ({ ...f, order: i + 1 }));
  const before = new Map(favorites.value.map((f) => [f.id, f.order]));
  favorites.value = next;
  await Promise.all(next.filter((f) => before.get(f.id) !== f.order).map((f) => $docs.put(TABLE, f)));
}

async function loadPage(fav: OnlineCollectionFavorite, start: number, lang: string, gen: number): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const page = await listCollection(sourceOf(fav), { start, count: PAGE, lang });
    if (gen !== generation) return;
    const fresh = toEntries(page.entries, page.channel || fav.channel);
    if (start === 1) {
      entries.value = fresh;
      writeCache(fav.id, fresh, page.hasMore);
    } else {
      const known = new Set(entries.value.map((e) => e.id));
      entries.value = [...entries.value, ...fresh.filter((e) => !known.has(e.id))];
    }
    hasMore.value = page.hasMore;
  } catch (e) {
    if (gen !== generation) return;
    const kind = (e as { kind?: string }).kind;
    error.value = kind === "unsupported" ? "desktop_only" : "load_failed";
    if (kind !== "network" && kind !== "unsupported") {
      Telemetry.captureException(e, { source: "presentation_mode.online.collection", kind });
    }
  } finally {
    if (gen === generation) loading.value = false;
  }
}

/**
 * Abre os vídeos soltos ou uma playlist/canal. A cópia guardada aparece na
 * hora; `refresh` (ou a cópia velha) consulta o YouTube de novo.
 */
async function open(id: string, lang = "pt", refresh = false): Promise<void> {
  await ensureLoaded();
  const gen = ++generation;
  // A consulta da lista anterior não volta a mexer no estado: quem abre agora é dono dele.
  loading.value = false;
  error.value = null;
  hasMore.value = false;
  const fav = collections.value.find((f) => f.id === id);
  if (!fav) {
    openId.value = VIDEOS;
    entries.value = videoEntries();
    return;
  }
  openId.value = id;
  entries.value = [];
  const cached = await readCache(id);
  if (gen !== generation) return;
  entries.value = cached?.entries ?? [];
  hasMore.value = cached?.hasMore ?? false;
  const stale = !cached || Date.now() - Date.parse(cached.fetchedAt) > STALE_MS;
  if (refresh || stale) await loadPage(fav, 1, lang, gen);
}

async function loadMore(lang: string): Promise<void> {
  const fav = openFavorite.value;
  if (!fav || loading.value || !hasMore.value) return;
  await loadPage(fav, entries.value.length + 1, lang, generation);
}

/** O vídeo foi ao ar a partir da lista aberta: ela vira a fila do Anterior/Próximo. */
function startQueue(videoId: string): void {
  const list = entries.value;
  const index = list.findIndex((e) => e.id === videoId);
  queue.value = index >= 0 ? { entries: list, index } : null;
}

function stepQueue(to: "first" | "prev" | "next" | "last"): OnlineEntry | null {
  const q = queue.value;
  if (!q) return null;
  const last = q.entries.length - 1;
  const index = to === "first" ? 0 : to === "last" ? last : to === "next" ? q.index + 1 : q.index - 1;
  if (index < 0 || index > last || index === q.index) return null;
  queue.value = { entries: q.entries, index };
  return q.entries[index];
}

export function useOnlineLibrary() {
  return {
    favorites,
    videos,
    collections,
    openId,
    openFavorite,
    entries,
    hasMore,
    loading,
    error,
    queue,
    supportsCollections: collectionsAvailable,
    ensureLoaded,
    addFromUrl,
    remove,
    reorder,
    open,
    loadMore,
    startQueue,
    stepQueue,
  };
}

/** Pergunta antes de tirar um favorito on-line da biblioteca. */
export function confirmRemoveFavorite(fav: OnlineFavorite): void {
  const key = (k: string) => `modules.presentation_mode.online.${k}`;
  $alert.yesno({ title: key("remove_title"), text: key(`remove_${fav.kind}`) }, (resp?: string) => {
    if (resp === "yes") void useOnlineLibrary().remove(fav.id);
  });
}
