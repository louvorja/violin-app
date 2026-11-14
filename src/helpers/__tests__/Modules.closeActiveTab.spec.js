import { beforeEach, describe, expect, it, vi } from "vitest";

const state = {};
const prefs = {};
vi.mock("@/helpers/AppData", () => ({
  default: {
    get: (key, fallback) => {
      const value = key.split(".").reduce((node, part) => node?.[part], state);
      return value === undefined ? fallback : value;
    },
    set: (key, value) => {
      const parts = key.split(".");
      const last = parts.pop();
      const node = parts.reduce((acc, part) => (acc[part] ??= {}), state);
      node[last] = value;
    },
    exists: (key) => key.split(".").reduce((node, part) => node?.[part], state) !== undefined,
  },
}));
vi.mock("@/helpers/UserData", () => ({
  default: {
    get: (key, fallback) =>
      key in prefs ? (Array.isArray(prefs[key]) ? [...prefs[key]] : prefs[key]) : fallback,
    set: (key, value) => {
      prefs[key] = [...value];
    },
  },
}));
vi.mock("@/helpers/Dev", () => ({ default: { write: () => {} } }));
vi.mock("@/helpers/Telemetry", () => ({
  default: { track: () => {}, markStart: () => {}, markCancel: () => {} },
}));

const { KEYS } = await import("@/constants/UserDataKeys");
const Modules = (await import("../Modules.js")).default;

const tabIds = () => Modules.tabs().map((m) => m.id);

beforeEach(() => {
  // Ordem de registro alfabética, como a do import.meta.glob dos manifestos.
  state.modules = {
    album: { id: "album", show: true, popup: true },
    bible: { id: "bible", show: true },
    collections: { id: "collections", show: false },
    hymnal: { id: "hymnal", show: true },
    musics: { id: "musics", show: true },
  };
  // Ordem da barra, já reordenada pelo operador.
  prefs[KEYS.MODULES.OPEN_ORDER] = ["hymnal", "musics", "bible"];
  state.active_module = "musics";
});

describe("abas na ordem da barra", () => {
  it("seguem a ordem arrastada, não a de registro, e deixam de fora os diálogos", () => {
    expect(tabIds()).toEqual(["hymnal", "musics", "bible"]);
  });
});

describe("⌘W / Ctrl+W fecha abas como no Chrome", () => {
  it("fecha a aba à vista, e não a última registrada", () => {
    expect(Modules.closeActiveTab()).toBe(true);
    expect(state.modules.musics.show).toBe(false);
    expect(state.modules.bible.show).toBe(true);
    expect(state.modules.hymnal.show).toBe(true);
  });

  it("passa para a aba da direita; fechando a última, para a da esquerda", () => {
    Modules.closeActiveTab();
    expect(state.active_module).toBe("bible");
    Modules.closeActiveTab();
    expect(state.active_module).toBe("hymnal");
  });

  it("vai fechando até não sobrar aba; aí devolve false para fechar a janela", () => {
    expect(Modules.closeActiveTab()).toBe(true);
    expect(Modules.closeActiveTab()).toBe(true);
    expect(Modules.closeActiveTab()).toBe(true);
    expect(tabIds()).toEqual([]);
    // O álbum é diálogo (popup), não aba: não conta.
    expect(Modules.closeActiveTab()).toBe(false);
    expect(state.modules.album.show).toBe(true);
  });

  it.each([
    ["música aberta no player", () => (state.modules.media = { id: "media", is_playing: true })],
    ["player visível", () => (state.modules.media = { id: "media", show: true })],
    ["som de fundo tocando", () => (prefs["modules.background_sound.is_playing"] = true)],
  ])("sem aba e com %s, não pede para fechar a janela", (_caso, noAr) => {
    state.modules = { media: { id: "media", show: false } };
    state.active_module = null;
    noAr();
    expect(Modules.closeActiveTab()).toBe(true);
    delete prefs["modules.background_sound.is_playing"];
  });

  it("na tela inicial, com abas na barra e nenhuma à vista, não fecha nenhuma", () => {
    state.active_module = null;
    expect(Modules.closeActiveTab()).toBe(true);
    expect(tabIds()).toEqual(["hymnal", "musics", "bible"]);
  });
});

describe("Ctrl+Tab percorre a barra", () => {
  it("avança e volta na ordem da barra, dando a volta nas pontas", () => {
    Modules.cycleTab(1);
    expect(state.active_module).toBe("bible");
    Modules.cycleTab(1);
    expect(state.active_module).toBe("hymnal");
    Modules.cycleTab(-1);
    expect(state.active_module).toBe("bible");
  });

  it("acompanha a barra depois de reordenada", () => {
    prefs[KEYS.MODULES.OPEN_ORDER] = ["musics", "bible", "hymnal"];
    Modules.cycleTab(1);
    expect(state.active_module).toBe("bible");
  });
});
