import { computed, ref } from "vue";
import $database from "@/helpers/Database";
import Telemetry from "@/helpers/Telemetry";
import { youtubeThumb } from "@/helpers/OnlineVideo";

/**
 * A coletânea online do módulo Vídeos On-line vista do Modo apresentação.
 *
 * O catálogo é o mesmo `${locale}_collections_online` usado pelo módulo:
 * canais, playlists e vídeos. Aqui ele só é lido — organizar continua lá.
 */

export interface OnlineCatalogChannel {
  channel_id: string;
  title: string;
  custom_url?: string;
  default_image?: string;
  default_image_base64?: string;
}

export interface OnlineCatalogPlaylist {
  playlist_id: string;
  channel_id: string;
  title: string;
  default_image?: string;
  default_image_base64?: string;
}

export interface OnlineCatalogVideo {
  video_id: string;
  playlist_id: string;
  title: string;
  sequence?: number;
  default_image?: string;
  default_image_base64?: string;
}

export interface OnlineCatalogData {
  channels: OnlineCatalogChannel[];
  playlists: OnlineCatalogPlaylist[];
  videos: OnlineCatalogVideo[];
}

const _channels = ref<OnlineCatalogChannel[]>([]);
const _playlists = ref<OnlineCatalogPlaylist[]>([]);
const _videos = ref<OnlineCatalogVideo[]>([]);
const _loading = ref(false);
const _loaded = ref(false);
const _error = ref(false);
let _locale = "";

const byTitle = (a: { title: string }, b: { title: string }) => a.title.localeCompare(b.title);

function uniqueVideos(list: OnlineCatalogVideo[]): OnlineCatalogVideo[] {
  const seen = new Set<string>();
  return [...list]
    .filter((video) => {
      if (!video?.video_id || seen.has(video.video_id)) return false;
      seen.add(video.video_id);
      return true;
    })
    .sort(byTitle);
}

async function load(locale: string, force = false): Promise<void> {
  if (_loading.value) return;
  if (!force && _loaded.value && _locale === locale) return;
  _loading.value = true;
  _error.value = false;
  try {
    const data = await $database.get<OnlineCatalogData>(`${locale}_collections_online`, {
      silent: true,
    });
    if (!data) {
      _channels.value = [];
      _playlists.value = [];
      _videos.value = [];
      _loaded.value = false;
      _error.value = true;
      return;
    }
    _channels.value = [...(data.channels ?? [])]
      .filter((channel) => !!channel?.channel_id)
      .sort(byTitle);
    _playlists.value = [...(data.playlists ?? [])]
      .filter((playlist) => !!playlist?.playlist_id)
      .sort(byTitle);
    _videos.value = [...(data.videos ?? [])]
      .filter((video) => !!video?.video_id)
      .sort(byTitle);
    _locale = locale;
    _loaded.value = true;
  } catch (error) {
    _error.value = true;
    Telemetry.captureException(error, { source: "presentation_mode.online_catalog.load" });
  } finally {
    _loading.value = false;
  }
}

export function useOnlineCatalog() {
  const channelById = computed(
    () => new Map(_channels.value.map((channel) => [channel.channel_id, channel]))
  );
  const playlistById = computed(
    () => new Map(_playlists.value.map((playlist) => [playlist.playlist_id, playlist]))
  );

  const playlistsByChannel = computed(() => {
    const map = new Map<string, OnlineCatalogPlaylist[]>();
    for (const playlist of _playlists.value) {
      const list = map.get(playlist.channel_id) ?? [];
      list.push(playlist);
      map.set(playlist.channel_id, list);
    }
    for (const list of map.values()) list.sort(byTitle);
    return map;
  });

  const videosByPlaylist = computed(() => {
    const map = new Map<string, OnlineCatalogVideo[]>();
    for (const video of _videos.value) {
      const list = map.get(video.playlist_id) ?? [];
      list.push(video);
      map.set(video.playlist_id, list);
    }
    for (const list of map.values()) list.sort(byTitle);
    return map;
  });

  /** Canais achatam as playlists: cada vídeo aparece uma vez na grade do canal. */
  const videosByChannel = computed(() => {
    const map = new Map<string, OnlineCatalogVideo[]>();
    for (const channel of _channels.value) {
      const seen = new Set<string>();
      const list: OnlineCatalogVideo[] = [];
      for (const playlist of playlistsByChannel.value.get(channel.channel_id) ?? []) {
        for (const video of videosByPlaylist.value.get(playlist.playlist_id) ?? []) {
          if (seen.has(video.video_id)) continue;
          seen.add(video.video_id);
          list.push(video);
        }
      }
      map.set(channel.channel_id, list.sort(byTitle));
    }
    return map;
  });

  const allVideos = computed(() => uniqueVideos(_videos.value));

  const channelTitleOfVideo = (video: OnlineCatalogVideo): string => {
    const playlist = playlistById.value.get(video.playlist_id);
    return playlist ? channelById.value.get(playlist.channel_id)?.title ?? "" : "";
  };

  const playlistsOfChannel = (channelId: string): OnlineCatalogPlaylist[] =>
    playlistsByChannel.value.get(channelId) ?? [];

  const videosOfPlaylist = (playlistId: string): OnlineCatalogVideo[] =>
    videosByPlaylist.value.get(playlistId) ?? [];

  const videosOfChannel = (channelId: string): OnlineCatalogVideo[] =>
    videosByChannel.value.get(channelId) ?? [];

  /** Primeiro vídeo da playlist pela ordem original (capa do card). */
  const firstVideoIdOfPlaylist = (playlistId: string): string => {
    const list = [...(videosByPlaylist.value.get(playlistId) ?? [])].sort(
      (a, b) => (a.sequence ?? 0) - (b.sequence ?? 0)
    );
    return list[0]?.video_id ?? "";
  };

  const playlistThumb = (playlist: OnlineCatalogPlaylist): string => {
    const direct = playlist.default_image_base64 || playlist.default_image || "";
    if (/^(data:image\/|https?:\/\/|blob:)/i.test(direct)) return direct;
    const first = firstVideoIdOfPlaylist(playlist.playlist_id);
    return first ? youtubeThumb(first) : "";
  };

  return {
    channels: _channels,
    playlists: _playlists,
    videos: _videos,
    loading: _loading,
    loaded: _loaded,
    error: _error,
    channelById,
    playlistById,
    playlistsByChannel,
    videosByPlaylist,
    videosByChannel,
    allVideos,
    channelTitleOfVideo,
    playlistsOfChannel,
    videosOfPlaylist,
    videosOfChannel,
    firstVideoIdOfPlaylist,
    playlistThumb,
    load,
    youtubeThumb,
  };
}
