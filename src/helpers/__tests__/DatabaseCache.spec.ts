import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  isDesktop: false,
  online: true,
  invalidateAll: vi.fn(async () => {}),
  success: vi.fn(),
  warning: vi.fn(),
}));

vi.mock("@/helpers/Database", () => ({ default: { invalidateAll: state.invalidateAll } }));
vi.mock("@/helpers/Platform", () => ({
  default: {
    get isDesktop() {
      return state.isDesktop;
    },
  },
}));
vi.mock("@/helpers/AppData", () => ({ default: { get: () => state.online } }));
vi.mock("@/helpers/Snackbar", () => ({
  default: { success: state.success, warning: state.warning },
}));
vi.mock("@/i18n", () => ({ i18nAtual: () => ({ global: { t: (key: string) => key } }) }));

import { clearDatabaseCache } from "../DatabaseCache";

describe("clearDatabaseCache — o mesmo limpar em todo lugar", () => {
  beforeEach(() => {
    state.isDesktop = false;
    state.online = true;
    state.invalidateAll.mockClear();
    state.success.mockClear();
    state.warning.mockClear();
  });

  it("com internet limpa e avisa", async () => {
    expect(await clearDatabaseCache()).toBe(true);
    expect(state.invalidateAll).toHaveBeenCalledOnce();
    expect(state.success).toHaveBeenCalledWith("options.updates.cache_cleared", expect.anything());
  });

  it("na web sem internet recusa: o catálogo sumiria até a conexão voltar", async () => {
    state.online = false;
    expect(await clearDatabaseCache()).toBe(false);
    expect(state.invalidateAll).not.toHaveBeenCalled();
    expect(state.warning).toHaveBeenCalledWith(
      "options.storage.clear_cache_offline",
      expect.anything()
    );
  });

  it("no desktop sem internet limpa: o main guarda a cópia expirada como reserva", async () => {
    state.isDesktop = true;
    state.online = false;
    expect(await clearDatabaseCache()).toBe(true);
    expect(state.invalidateAll).toHaveBeenCalledOnce();
  });

  it("quem mostra a confirmação na própria tela pede para não repetir o aviso", async () => {
    expect(await clearDatabaseCache({ notify: false })).toBe(true);
    expect(state.success).not.toHaveBeenCalled();
  });
});
