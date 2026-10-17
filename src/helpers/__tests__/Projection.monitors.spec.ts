import { beforeEach, describe, expect, it, vi } from "vitest";
import { KEYS } from "@/constants/UserDataKeys";

const state = vi.hoisted(() => ({
  desktop: true,
  prefs: {} as Record<string, number | string | null>,
  resolved: {} as Record<string, number | null>,
  store: {} as Record<string, unknown>,
  setPreferred: vi.fn(),
}));

vi.mock("@/helpers/Platform", () => ({
  default: {
    get isDesktop() { return state.desktop; },
    get displays() {
      return state.desktop ? {
        getPreferred: async (feature: string) => {
          const id = state.resolved[feature];
          return id == null ? null : { id };
        },
        getPrefs: async () => state.prefs,
        getFeatureRole: async () => "projection",
        setPreferred: state.setPreferred,
      } : null;
    },
  },
}));
vi.mock("@/helpers/UserData", () => ({
  default: {
    get: (key: string, fallback: unknown) => state.store[key] ?? fallback,
    set: (key: string, value: unknown) => { state.store[key] = value; },
  },
}));
vi.mock("@/helpers/Telemetry", () => ({ default: {} }));
vi.mock("@/helpers/Snackbar", () => ({ default: {} }));
vi.mock("@/i18n", () => ({ i18nAtual: () => null }));

const { getPreferredMonitor, getFallbackFeature, isUsingFallback, setPreferredMonitor } = await import("@/helpers/Projection");

beforeEach(() => {
  state.desktop = true;
  state.prefs = {};
  state.resolved = { musicas: 2, message_board: 2 };
  state.store = {};
  state.setPreferred.mockReset();
});

describe("preferência de monitor apresentada no menu do utilitário", () => {
  it("marca Usar padrão mesmo quando o monitor herdado está conectado", async () => {
    expect(await getPreferredMonitor("message_board")).toBe(2);
    expect(await getPreferredMonitor("message_board", { explicit: true })).toBeNull();
    expect(await isUsingFallback("message_board")).toBe(true);
  });

  it("mostra a escolha individual sem confundi-la com o padrão", async () => {
    state.prefs.message_board = 3;
    state.resolved.message_board = 3;
    expect(await getPreferredMonitor("message_board")).toBe(3);
    expect(await getPreferredMonitor("message_board", { explicit: true })).toBe(3);
    expect(await isUsingFallback("message_board")).toBe(false);
  });

  it("não herda músicas quando o main informa que a escolha individual está indisponível", async () => {
    state.prefs.message_board = null;
    state.resolved.message_board = null;
    expect(await getPreferredMonitor("message_board")).toBeNull();
    expect(await isUsingFallback("message_board")).toBe(false);
  });

  it("envia escolhas diferentes para mesma janela e restauração do padrão", async () => {
    await setPreferredMonitor("message_board", null);
    await setPreferredMonitor("message_board", undefined);
    expect(state.setPreferred.mock.calls).toEqual([
      ["message_board", null], ["message_board", undefined],
    ]);
  });

  it("permite restaurar o padrão também no cronômetro de culto", () => {
    expect(getFallbackFeature("timer_worship")).toBe("musicas");
  });

  it("no navegador, mantém a escolha por utilitário e distingue mesma janela do padrão", async () => {
    state.desktop = false;
    await setPreferredMonitor("musicas", "screen-1");
    await setPreferredMonitor("message_board", "screen-2");
    expect(await getPreferredMonitor("message_board")).toBe("screen-2");
    expect(await getPreferredMonitor("musicas")).toBe("screen-1");
    await setPreferredMonitor("message_board", null);
    expect(await getPreferredMonitor("message_board")).toBeNull();
    expect(await isUsingFallback("message_board")).toBe(false);
    await setPreferredMonitor("message_board", undefined);
    expect(await getPreferredMonitor("message_board")).toBe("screen-1");
    expect(await isUsingFallback("message_board")).toBe(true);
    expect(state.store[KEYS.OPTIONS.DISPLAYS.PREFERRED]).toEqual({ musicas: "screen-1" });
  });
});
