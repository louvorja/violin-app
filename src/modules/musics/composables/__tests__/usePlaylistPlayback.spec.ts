import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { KEYS } from "@/constants/UserDataKeys";
import type { Playlist } from "@/types/Music";

const open = vi.fn();
const close = vi.fn();
let mediaClosed: () => void = () => {};
let playlists: Playlist[] = [];
let preferences: Record<string, boolean> = {};
vi.mock("@/composables/useMedia", () => ({
  default: {
    open: (...args: unknown[]) => open(...args),
    close: (...args: unknown[]) => close(...args),
    registerPlaylistEndHandler: vi.fn(),
    unregisterPlaylistEndHandler: vi.fn(),
    registerPlaylistCloseHandler: (handler: () => void) => (mediaClosed = handler),
    unregisterPlaylistCloseHandler: vi.fn(),
    getActivePlaybackId: () => "playback",
  },
}));
vi.mock("../usePlaylists", () => ({
  usePlaylists: () => ({
    playlists: {
      get value() {
        return playlists;
      },
    },
  }),
}));
vi.mock("@/helpers/UserData", () => ({
  default: { get: (key: string, fallback: unknown) => preferences[key] ?? fallback },
}));
vi.mock("@/helpers/Broadcast", () => ({ default: { listen: vi.fn() } }));
vi.mock("@/helpers/Dev", () => ({ default: { write: vi.fn() } }));
vi.mock("@/helpers/Telemetry", () => ({ default: { track: vi.fn() } }));

const { usePlaylistPlayback } = await import("../usePlaylistPlayback");
const playback = usePlaylistPlayback();
const playlist: Playlist = {
  id: "list",
  name: "Culto",
  createdAt: "",
  updatedAt: "",
  songs: [1, 2, 3, 4].map((id_music) => ({
    id_music,
    name: `Música ${id_music}`,
    duration: 120,
    has_instrumental_music: true,
  })),
};

beforeEach(() => {
  vi.useFakeTimers();
  mediaClosed();
  playlists = [playlist];
  preferences = {};
  open.mockClear();
  close.mockClear();
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("playlist com álbuns desativados", () => {
  it("pula as músicas ocultas no início, próximo e anterior, sem alterar a lista salva", () => {
    playback.playPlaylist(playlist, 0, (song) => song.id_music % 2 === 0);
    expect(open).toHaveBeenLastCalledWith({ id_music: 2, mode: "audio" });
    expect(playback.totalSongs.value).toBe(2);
    expect(playback.totalDuration.value).toBe(240);
    playback.playNext();
    expect(open).toHaveBeenLastCalledWith({ id_music: 4, mode: "audio" });
    playback.playPrev();
    expect(open).toHaveBeenLastCalledWith({ id_music: 2, mode: "audio" });
    expect(playlist.songs.map((song) => song.id_music)).toEqual([1, 2, 3, 4]);
  });

  it("repetição e ordem aleatória usam somente músicas disponíveis", () => {
    preferences[KEYS.MODULES.MUSICS.PLAYLIST_SHUFFLE] = true;
    preferences[KEYS.MODULES.MUSICS.PLAYLIST_REPEAT] = true;
    playback.playPlaylist(playlist, 0, (song) => song.id_music === 2);
    playback.playNext();
    playback.playNext();
    expect(open.mock.calls.map(([song]) => song.id_music)).toEqual([2, 2, 2]);
  });

  it("reconsulta a disponibilidade entre músicas e para quando nenhuma permanece ativa", () => {
    const blocked = new Set([1, 3]);
    playback.playPlaylist(playlist, 0, (song) => !blocked.has(song.id_music));
    blocked.add(4);
    playback.playNext();
    expect(open).toHaveBeenCalledTimes(1);
    expect(playback.isActive.value).toBe(false);
    playback.playPlaylist(playlist, 0, () => false);
    expect(open).toHaveBeenCalledTimes(1);
  });
});

describe("fechar a música (#54)", () => {
  it("a playlist só acaba quando a música fecha de fato, e não pede o fechamento por conta própria", () => {
    playback.playPlaylist(playlist);
    expect(playback.isActive.value).toBe(true);
    expect(close).not.toHaveBeenCalled();

    mediaClosed();

    expect(playback.isActive.value).toBe(false);
    expect(playback.currentPlaylist.value).toBeNull();
    expect(close).not.toHaveBeenCalled();
  });
});
