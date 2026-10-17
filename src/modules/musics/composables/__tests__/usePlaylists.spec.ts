import { beforeEach, describe, expect, it, vi } from "vitest";
import { DB_TABLE } from "@/constants/DbTables";
import { KEYS } from "@/constants/UserDataKeys";
import type { Playlist, PlaylistSong } from "@/types/Music";

const mocks = vi.hoisted(() => {
  const documents = new Map<string, Playlist>();
  return {
    documents,
    getAll: vi.fn(async () => [...documents.values()].map((playlist) => structuredClone(playlist))),
    put: vi.fn(async (_table: string, playlist: Playlist) => {
      documents.set(playlist.id, structuredClone(playlist));
    }),
    del: vi.fn(),
    getPreference: vi.fn(() => null),
    setPreference: vi.fn(),
  };
});

vi.mock("@/helpers/DocStore", () => ({
  default: { getAll: mocks.getAll, put: mocks.put, del: mocks.del },
}));
vi.mock("@/helpers/UserData", () => ({
  default: { get: mocks.getPreference, set: mocks.setPreference },
}));
vi.mock("@/helpers/Dev", () => ({ default: { write: vi.fn() } }));
vi.mock("@/helpers/Telemetry", () => ({ default: { track: vi.fn(), histogram: vi.fn() } }));

const song: PlaylistSong = {
  id_music: 42,
  name: "Vem, Espírito Santo",
  duration: 185,
  has_instrumental_music: true,
};
const existing: Playlist = {
  id: "saved",
  name: "Culto salvo",
  songs: [{ ...song, id_music: 7 }],
  createdAt: "2026-10-01T12:00:00.000Z",
  updatedAt: "2026-10-01T12:00:00.000Z",
};

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.documents.clear();
  mocks.documents.set(existing.id, structuredClone(existing));
});

describe("usePlaylists com funções destruturadas", () => {
  it("importa JSON exportado, elimina músicas repetidas e preserva o conteúdo após hidratar novamente", async () => {
    const { usePlaylists } = await import("../usePlaylists");
    const { hydrate, importPlaylist, playlists, selectPlaylist, selectedPlaylist } = usePlaylists();
    await hydrate();
    selectPlaylist(existing.id);

    const data: unknown = JSON.parse(
      JSON.stringify({ ...existing, name: "Culto importado", songs: [song, song] })
    );
    const imported = await importPlaylist(data);

    expect(imported).toMatchObject({ name: "Culto importado", songs: [song] });
    expect(imported?.id).not.toBe(existing.id);
    expect(playlists.value).toHaveLength(2);
    expect(selectedPlaylist.value).toEqual(existing);
    expect(mocks.put).toHaveBeenLastCalledWith(DB_TABLE.MUSICS_PLAYLISTS, imported);
    expect(mocks.documents.get(existing.id)).toEqual(existing);

    vi.resetModules();
    const restored = (await import("../usePlaylists")).usePlaylists();
    await restored.hydrate();
    expect(restored.playlists.value).toEqual([existing, imported]);
  });

  it("adiciona à playlist selecionada por função destruturada e persiste sem duplicar", async () => {
    const { usePlaylists } = await import("../usePlaylists");
    const { hydrate, selectPlaylist, addSongToSelected, selectedPlaylist } = usePlaylists();
    await hydrate();

    await addSongToSelected(song);
    expect(mocks.put).not.toHaveBeenCalled();

    selectPlaylist(existing.id);
    await addSongToSelected(song);
    await addSongToSelected(song);

    expect(selectedPlaylist.value?.songs).toEqual([...existing.songs, song]);
    expect(mocks.documents.get(existing.id)?.songs).toEqual([...existing.songs, song]);
    expect(mocks.setPreference).toHaveBeenCalledWith(
      KEYS.MODULES.MUSICS.SELECTED_PLAYLIST,
      existing.id
    );
  });

  it("mantém a compatibilidade com identificadores e durações numéricas em strings", async () => {
    const { importPlaylist } = (await import("../usePlaylists")).usePlaylists();
    const imported = await importPlaylist({
      songs: [{ ...song, id_music: "42", duration: "185" }],
    });

    expect(imported).toMatchObject({ name: "Playlist importada", songs: [song] });
  });

  it("permite importar uma playlist vazia", async () => {
    const { importPlaylist } = (await import("../usePlaylists")).usePlaylists();
    const imported = await importPlaylist({ name: "Vazia", songs: [] });

    expect(imported).toMatchObject({ name: "Vazia", songs: [] });
    expect(mocks.documents.get(imported!.id)).toEqual(imported);
  });

  it.each([
    null,
    [],
    {},
    { songs: null },
    { songs: [null] },
    { songs: ["música"] },
    { songs: [[]] },
    { songs: [{ ...song, id_music: 0 }] },
    { songs: [{ ...song, id_music: -1 }] },
    { songs: [{ ...song, id_music: 1.5 }] },
    { songs: [{ ...song, id_music: "inválido" }] },
    { songs: [{ ...song, name: {} }] },
    { songs: [{ ...song, duration: -1 }] },
    { songs: [{ ...song, duration: "Infinity" }] },
    { songs: [{ ...song, has_instrumental_music: "false" }] },
    { songs: [song, null] },
  ])("rejeita entrada inválida sem alterar ou gravar playlists: %j", async (data) => {
    const { hydrate, importPlaylist, playlists } = (await import("../usePlaylists")).usePlaylists();
    await hydrate();

    await expect(importPlaylist(data)).resolves.toBeNull();

    expect(playlists.value).toEqual([existing]);
    expect([...mocks.documents.values()]).toEqual([existing]);
    expect(mocks.put).not.toHaveBeenCalled();
  });
});
