import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { nextTick } from "vue";

const local: Record<string, unknown> = {};
const onDisk = new Set<string>();

vi.mock("@/helpers/Database", () => ({
  default: { getLocal: vi.fn(async (key: string) => local[key] ?? null) },
}));
vi.mock("@/helpers/Platform", () => ({
  default: {
    storage: {
      checkLocal: vi.fn(async (paths: string[]) =>
        Object.fromEntries(paths.map((p) => [p, onDisk.has(p) ? "own" : false]))
      ),
    },
  },
}));
vi.mock("@/helpers/MediaUrl", () => ({
  resolveMediaReference: (url: string | null | undefined) =>
    url ? { url: `https://files.test${url}`, relativePath: url } : null,
}));

import $appdata from "@/helpers/AppData";
import { KEYS } from "@/constants/UserDataKeys";
import { useOfflineLibrary, _resetOfflineLibrary } from "../useOfflineLibrary";

async function settle() {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
    await nextTick();
  }
}

// Um Pinia só, como no app: o estado de conexão é lido de um store único.
setActivePinia(createPinia());

/**
 * Offline, a lista só serve se cada item mostrado toca. Uma música conta como
 * baixada quando o áudio cantado está no aparelho; um álbum aparece quando ao
 * menos uma das suas músicas está.
 */
describe("useOfflineLibrary", () => {
  beforeEach(() => {
    $appdata.set(KEYS.SHELL.IS_ONLINE, true);
    _resetOfflineLibrary();
    for (const k of Object.keys(local)) delete local[k];
    onDisk.clear();
    local.pt_musics = [
      { id_music: 1, albums: [{ id_album: 10 }] },
      { id_music: 2, albums: [{ id_album: 10 }] },
      { id_music: 3, albums: [{ id_album: 20 }] },
    ];
    local.pt_doxology_albums = [{ id_album: 30 }];
    local.album_30 = { musics: [{ id_music: 4 }] };
    for (const id of [1, 2, 3, 4]) local[`music_${id}`] = { url_music: `/musics/pt/${id}.mp3` };
    onDisk.add("/musics/pt/1.mp3");
    onDisk.add("/musics/pt/4.mp3");
  });

  it("online não filtra nada", async () => {
    $appdata.set(KEYS.SHELL.IS_ONLINE, true);
    const lib = useOfflineLibrary(() => "pt");
    await settle();
    expect(lib.active.value).toBe(false);
    expect(lib.hasMusic(3)).toBe(true);
  });

  it("offline mostra só o que tem áudio no aparelho, e os álbuns delas", async () => {
    $appdata.set(KEYS.SHELL.IS_ONLINE, false);
    const lib = useOfflineLibrary(() => "pt");
    await vi.waitFor(() => expect(lib.active.value).toBe(true));
    expect([1, 2, 3, 4].filter((id) => lib.hasMusic(id))).toEqual([1, 4]);
    expect([10, 20, 30].filter((id) => lib.hasAlbum(id))).toEqual([10, 30]);
  });

  it("a volta da internet desliga o filtro", async () => {
    $appdata.set(KEYS.SHELL.IS_ONLINE, false);
    const lib = useOfflineLibrary(() => "pt");
    await vi.waitFor(() => expect(lib.active.value).toBe(true));
    $appdata.set(KEYS.SHELL.IS_ONLINE, true);
    await settle();
    expect(lib.active.value).toBe(false);
    expect(lib.hasMusic(3)).toBe(true);
  });

  it("sem catálogo no aparelho não filtra (a lista mostra o próprio aviso)", async () => {
    delete local.pt_musics;
    $appdata.set(KEYS.SHELL.IS_ONLINE, false);
    const lib = useOfflineLibrary(() => "pt");
    await settle();
    expect(lib.active.value).toBe(false);
    expect(lib.offline.value).toBe(true);
  });
});
