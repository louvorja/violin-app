import { ref, shallowRef, computed, onUnmounted } from "vue";
import $userdata from "@/helpers/UserData";
import $dev from "@/helpers/Dev";
import DateTime from "@/helpers/DateTime";
import { KEYS } from "@/constants/UserDataKeys";
import { MusicActionEnum } from "@/enums/MusicActionEnum";
import Media from "@/composables/useMedia";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import $broadcast from "@/helpers/Broadcast";
import type { Playlist, PlaylistSong } from "@/types/Music";
import { usePlaylists } from "./usePlaylists";
import Telemetry from "@/helpers/Telemetry";

const _isActive = ref(false);
const _currentPlaylistId = ref<string | null>(null);
const _currentIndex = ref(0);
const _playedSongs = ref<Set<number>>(new Set());
const _shuffleOrder = ref<number[]>([]);

const { playlists } = usePlaylists();

const _advanceLock = ref(false);
const _songAvailable = shallowRef<(_song: PlaylistSong) => boolean>(() => true);
/** Fila provisória, não salva: o "Tocar Todas" de uma lista toca por aqui. */
const _sequence = shallowRef<Playlist | null>(null);

const currentPlaylist = computed<Playlist | null>(() => {
  if (!_currentPlaylistId.value) return null;
  if (_sequence.value?.id === _currentPlaylistId.value) return _sequence.value;
  return playlists.value.find((p) => p.id === _currentPlaylistId.value) || null;
});

const availableSongs = computed(() =>
  (currentPlaylist.value?.songs || []).filter(_songAvailable.value)
);
const totalSongs = computed(() => availableSongs.value.length);
const playedCount = computed(() => {
  if (!currentPlaylist.value) return 0;
  return availableSongs.value.filter((s) => _playedSongs.value.has(s.id_music)).length;
});
const remainingCount = computed(() => totalSongs.value - playedCount.value);

function _durationToSec(d: number | string): number {
  return typeof d === "string" ? DateTime.toNumber(d) : Number(d) || 0;
}

const totalDuration = computed(() =>
  availableSongs.value.reduce((sum, s) => sum + _durationToSec(s.duration), 0)
);
const playedDuration = computed(() =>
  availableSongs.value
    .filter((s) => _playedSongs.value.has(s.id_music))
    .reduce((sum, s) => sum + _durationToSec(s.duration), 0)
);
const remainingDuration = computed(() => totalDuration.value - playedDuration.value);

const currentSong = computed<PlaylistSong | null>(() => {
  if (!currentPlaylist.value) return null;
  return currentPlaylist.value.songs[_currentIndex.value] || null;
});

// Aleatório e repetição são opções das playlists; a fila provisória vai do primeiro ao último.
function _getShuffleEnabled(): boolean {
  return !_sequence.value && !!$userdata.get(KEYS.MODULES.MUSICS.PLAYLIST_SHUFFLE, false);
}

function _getRepeatEnabled(): boolean {
  return !_sequence.value && !!$userdata.get(KEYS.MODULES.MUSICS.PLAYLIST_REPEAT, false);
}

function _generateShuffleOrder(length: number): number[] {
  const order = Array.from({ length }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

function _playSongAt(index: number): void {
  const playlist = currentPlaylist.value;
  if (!playlist || index < 0 || index >= playlist.songs.length) {
    _stopInternal();
    return;
  }
  _currentIndex.value = index;
  const song = playlist.songs[index];
  _advanceLock.value = true;
  $dev.write("playlist:play", { index, name: song.name });

  Media.open({ id_music: song.id_music, mode: MusicActionEnum.AUDIO });
  Telemetry.track("music_playlist_play", {
    playlist_id: _currentPlaylistId.value,
    index,
    id_music: song.id_music,
    name: song.name,
    playback_id: Media.getActivePlaybackId(),
  });

  _playedSongs.value = new Set([..._playedSongs.value, song.id_music]);
  setTimeout(() => {
    _advanceLock.value = false;
  }, 800);
}

function _stopInternal(): void {
  if (_isActive.value)
    Telemetry.track("music_playlist_stopped", {
      playlist_id: _currentPlaylistId.value,
      index: _currentIndex.value,
      played_count: _playedSongs.value.size,
    });
  _isActive.value = false;
  _currentPlaylistId.value = null;
  _currentIndex.value = 0;
  _playedSongs.value = new Set();
  _shuffleOrder.value = [];
  _songAvailable.value = () => true;
  _sequence.value = null;
}

/** Outra música, arquivo ou vídeo assumiu o player: a fila acaba e não volta sozinha. */
function _onPlaybackStarted(idMusic: unknown): void {
  if (!_isActive.value || Number(idMusic) === currentSong.value?.id_music) return;
  $dev.write("playlist:interrupted", { id_music: idMusic });
  _stopInternal();
}

function _nextIndex(): number | null {
  const playlist = currentPlaylist.value;
  if (!playlist) return null;
  const len = playlist.songs.length;
  const eligible = playlist.songs
    .map((song, index) => (_songAvailable.value(song) ? index : -1))
    .filter((index) => index >= 0);
  if (!eligible.length) return null;

  if (_getShuffleEnabled()) {
    const playedAll = eligible.every((index) =>
      _playedSongs.value.has(playlist.songs[index].id_music)
    );
    if (playedAll) {
      if (_getRepeatEnabled()) {
        _playedSongs.value = new Set();
        _shuffleOrder.value = _generateShuffleOrder(len);
        return _shuffleOrder.value.find((index) => eligible.includes(index)) ?? null;
      }
      return null;
    }
    const remaining = _shuffleOrder.value.filter(
      (i) => eligible.includes(i) && !_playedSongs.value.has(playlist.songs[i].id_music)
    );
    if (remaining.length > 0) return remaining[0];
    _shuffleOrder.value = _generateShuffleOrder(len);
    return (
      _shuffleOrder.value.find(
        (i) => eligible.includes(i) && !_playedSongs.value.has(playlist.songs[i].id_music)
      ) ?? null
    );
  }

  const nextIdx = eligible.find((index) => index > _currentIndex.value);
  if (nextIdx == null) {
    if (_getRepeatEnabled()) {
      _playedSongs.value = new Set();
      return eligible[0];
    }
    return null;
  }
  return nextIdx;
}

function _onSongEnded(): boolean {
  if (!_isActive.value) return false;
  if (_advanceLock.value) return true;
  const playlist = currentPlaylist.value;
  Telemetry.track("music_playlist_song_ended", {
    playlist_id: _currentPlaylistId.value,
    index: _currentIndex.value,
    id_music: playlist?.songs[_currentIndex.value]?.id_music,
    playback_id: Media.getActivePlaybackId(),
  });
  if (!playlist) {
    _stopInternal();
    return true;
  }

  const nextIdx = _nextIndex();
  if (nextIdx === null) {
    $dev.write("playlist:ended", { name: playlist.name });
    _stopInternal();
    Media.close(true);
    return true;
  }
  $dev.write("playlist:song_ended", { index: _currentIndex.value });
  _playSongAt(nextIdx);
  return true;
}

function playNext(): void {
  const playlist = currentPlaylist.value;
  if (!playlist) {
    _stopInternal();
    return;
  }

  const nextIdx = _nextIndex();
  if (nextIdx === null) {
    $dev.write("playlist:ended", { name: playlist.name });
    _stopInternal();
    return;
  }
  _playSongAt(nextIdx);
}

function playPrev(): void {
  if (_getShuffleEnabled()) {
    const playlist = currentPlaylist.value;
    if (!playlist) return;
    const played = [..._playedSongs.value].filter(
      (id) =>
        id !== currentSong.value?.id_music &&
        playlist.songs.some((song) => song.id_music === id && _songAvailable.value(song))
    );
    const prevId = played.at(-1);
    const idx = playlist.songs.findIndex((s) => s.id_music === prevId && _songAvailable.value(s));
    if (idx >= 0) _playSongAt(idx);
    return;
  }
  const songs = currentPlaylist.value?.songs || [];
  for (let index = _currentIndex.value - 1; index >= 0; index--) {
    if (_songAvailable.value(songs[index])) {
      _playSongAt(index);
      return;
    }
  }
}

function playPlaylist(
  playlist: Playlist,
  startIndex = 0,
  isAvailable: (_song: PlaylistSong) => boolean = () => true
): void {
  if (_sequence.value?.id !== playlist.id) _sequence.value = null;
  _songAvailable.value = isAvailable;
  const eligible = playlist.songs
    .map((song, index) => (isAvailable(song) ? index : -1))
    .filter((index) => index >= 0);
  if (!eligible.length) {
    _stopInternal();
    return;
  }
  _isActive.value = true;
  _currentPlaylistId.value = playlist.id;
  _currentIndex.value = startIndex;
  _playedSongs.value = new Set();

  if (_getShuffleEnabled()) {
    _shuffleOrder.value = _generateShuffleOrder(playlist.songs.length);
    const firstIdx = _shuffleOrder.value.find((index) => eligible.includes(index))!;
    $dev.write("playlist:start", { name: playlist.name, shuffle: true, startIndex: firstIdx });
    _playSongAt(firstIdx);
  } else {
    _shuffleOrder.value = [];
    $dev.write("playlist:start", { name: playlist.name, startIndex });
    _playSongAt(eligible.find((index) => index >= startIndex) ?? eligible[0]);
  }
}

Media.registerPlaylistEndHandler(_onSongEnded);
Media.registerPlaylistCloseHandler(_stopInternal);
Media.registerPlaylistPlaybackHandler(_onPlaybackStarted);

$broadcast.listen((msg) => {
  if (msg.type === BROADCAST_TYPE.MEDIA_PREV_MUSIC && _isActive.value) playPrev();
  if (msg.type === BROADCAST_TYPE.MEDIA_NEXT_MUSIC && _isActive.value) playNext();
});

onUnmounted(() => {
  Media.unregisterPlaylistEndHandler();
  Media.unregisterPlaylistCloseHandler();
  Media.unregisterPlaylistPlaybackHandler();
});

export function usePlaylistPlayback() {
  return {
    isActive: _isActive,
    currentPlaylistId: _currentPlaylistId,
    currentIndex: _currentIndex,
    currentPlaylist,
    totalSongs,
    playedCount,
    remainingCount,
    totalDuration,
    playedDuration,
    remainingDuration,
    currentSong,
    playedSongs: _playedSongs,

    playPlaylist,

    /** Toca a lista do primeiro ao último item, sem salvá-la como playlist. */
    playSequence(name: string, songs: PlaylistSong[]): void {
      const now = new Date().toISOString();
      const sequence = { id: `sequence:${name}`, name, songs, createdAt: now, updatedAt: now };
      _sequence.value = sequence;
      playPlaylist(sequence);
    },

    playNext,
    playPrev,
  };
}
