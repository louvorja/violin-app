import { beforeEach, describe, expect, it, vi } from "vitest";

const state = {};
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
vi.mock("@/helpers/UserData", () => ({ default: { get: () => [], set: () => {} } }));
vi.mock("@/helpers/Dev", () => ({ default: { write: () => {} } }));
vi.mock("@/helpers/Telemetry", () => ({
  default: { track: () => {}, markStart: () => {}, markCancel: () => {} },
}));

const Modules = (await import("../Modules.js")).default;

beforeEach(() => {
  state.modules = {
    musics: { id: "musics", show: true },
    hymnal: { id: "hymnal", show: true },
    collections: { id: "collections", show: false },
    album: { id: "album", show: true, popup: true },
  };
  state.active_module = "musics";
});

describe("⌘W / Ctrl+W fecha abas como no Chrome", () => {
  it("fecha a aba à vista e passa para outra aberta", () => {
    expect(Modules.closeActiveTab()).toBe(true);
    expect(state.modules.musics.show).toBe(false);
    expect(state.active_module).not.toBe("musics");
    expect(state.modules.hymnal.show).toBe(true);
  });

  it("vai fechando até não sobrar aba; aí devolve false para fechar a janela", () => {
    expect(Modules.closeActiveTab()).toBe(true);
    expect(Modules.closeActiveTab()).toBe(true);
    expect(state.modules.hymnal.show).toBe(false);
    // O álbum é diálogo (popup), não aba: não conta.
    expect(Modules.closeActiveTab()).toBe(false);
    expect(state.modules.album.show).toBe(true);
  });
});
