import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Na paleta (Ctrl+K), executar uma música faz o mesmo que o primeiro botão da
 * linha: o cantado. Antes, Favoritos e Recentes abriam só a letra, e a música
 * do acervo sem playback abria sem a voz.
 */

const executeMusic = vi.fn(async () => {});

vi.mock("@/helpers/MusicExecution", () => ({
  executeMusic: (...args: unknown[]) => executeMusic(...(args as [])),
}));
vi.mock("@/helpers/AppData", () => ({
  default: { get: (_k: string, fallback?: unknown) => fallback },
}));
vi.mock("@/helpers/UserData", () => ({
  default: { get: (_k: string, fallback?: unknown) => fallback },
}));
vi.mock("@/helpers/Modules", () => ({ default: {} }));
vi.mock("@/composables/useMedia", () => ({ default: { open: vi.fn() } }));
vi.mock("@/helpers/Platform", () => ({ default: { isRemote: false, isDesktop: false } }));
vi.mock("@/helpers/CustomMusicCatalog", () => ({
  loadCustomMusicCatalog: async () => [
    {
      id_music: -2,
      custom_song_id: "minha-musica",
      name: "Minha Música",
      custom_collection_names: [],
    },
  ],
}));

const registry = await import("@/helpers/CommandRegistry");

const catalogo = [
  {
    id_music: 12,
    name: "Vinde, Povo do Senhor",
    has_instrumental_music: 1,
    albums_names: "Hinário",
  },
  { id_music: 900, name: "Só Cantado", has_instrumental_music: 0, albums_names: "Coletânea" },
];

const userdata = {
  get: (key: string, fallback?: unknown) => {
    if (key === "favorites")
      return [{ id_music: 900, name: "Só Cantado", has_instrumental_music: false }];
    if (key === "history")
      return [{ id_music: 12, name: "Vinde, Povo do Senhor", has_instrumental_music: true }];
    return fallback;
  },
};
const database = {
  get: async (name: string) => (name.endsWith("_musics") ? catalogo : []),
};

type Command = { id: string; run: () => unknown };

async function command(id: string): Promise<Command> {
  const all = (await registry.getAll(database, userdata, (k: string) => k)) as Command[];
  const found = all.find((c) => c.id === id);
  if (!found) throw new Error(`comando ${id} não encontrado`);
  return found;
}

beforeEach(() => executeMusic.mockClear());

describe("paleta: executar música pelo mesmo caminho dos botões da linha", () => {
  it("Recentes tocam o cantado, não só a letra", async () => {
    await (await command("hist:12")).run();
    expect(executeMusic).toHaveBeenCalledWith({ id_music: 12 });
  });

  it("Favoritos tocam o cantado, não só a letra", async () => {
    await (await command("fav:900")).run();
    expect(executeMusic).toHaveBeenCalledWith({ id_music: 900 });
  });

  it("música do acervo sem playback toca com a voz", async () => {
    await (await command("music:900")).run();
    expect(executeMusic).toHaveBeenCalledWith({ id_music: 900 });
  });

  it("música do acervo com playback continua no cantado", async () => {
    await (await command("music:12")).run();
    expect(executeMusic).toHaveBeenCalledWith({ id_music: 12 });
  });

  it("música personalizada vai pelo mesmo caminho, com o UUID", async () => {
    await (await command("custom-music:minha-musica")).run();
    expect(executeMusic).toHaveBeenCalledWith({ id_music: -2, custom_song_id: "minha-musica" });
  });
});
