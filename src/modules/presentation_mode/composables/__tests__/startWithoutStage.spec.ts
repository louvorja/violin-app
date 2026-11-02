import { beforeEach, describe, expect, it, vi } from "vitest";

const openMediaWindow = vi.hoisted(() => vi.fn(async (_kind: string, _media: string, _opts?: unknown) => {}));
const stageScreen = vi.hoisted(() => ({ value: null as unknown }));
const appdata = vi.hoisted(() => new Map<string, unknown>());

vi.mock("@/helpers/Broadcast", () => ({ default: { send: vi.fn(), listen: vi.fn() } }));
vi.mock("@/helpers/Platform", () => ({ default: { isDesktop: false } }));
vi.mock("@/helpers/Telemetry", () => ({ default: { track: vi.fn(), captureException: vi.fn() } }));
vi.mock("@/helpers/ProjectionWindows", () => ({
  closeProjectionWindows: vi.fn(),
  controlPresentationScreens: vi.fn(),
  keepPresentationScreens: vi.fn(),
  openMediaWindow,
}));
vi.mock("@/helpers/Projection", () => ({ close: vi.fn() }));
vi.mock("@/composables/useProjectionShutdown", () => ({ closingOnPurpose: vi.fn() }));
// Nenhuma janela aberta: tudo o que Iniciar liga precisa ser aberto.
vi.mock("@/helpers/projection/webWindow", () => ({ isWebWindowOpen: () => false }));
vi.mock("@/helpers/projection/WebRoles", () => ({
  default: { screenForRole: (role: string) => (role === "stage" ? stageScreen.value : { id: "screen-1" }) },
}));
vi.mock("@/helpers/AppData", () => ({
  default: {
    get: (k: string, f?: unknown) => (appdata.has(k) ? appdata.get(k) : f),
    set: (k: string, v: unknown) => appdata.set(k, v),
  },
}));
vi.mock("@/composables/useDisplays", () => ({ useDisplays: () => ({}) }));
vi.mock("../useLiveContent", () => ({ useLiveContent: () => ({ current: { value: "music" } }) }));

const { KEYS } = await import("@/constants/UserDataKeys");
const { screenOn, startOutputs, stopOutputs, setScreen, showOnReturn } = await import("../useOutputs");

function opened(kind: string): boolean {
  return openMediaWindow.mock.calls.some(([k]) => k === kind);
}

beforeEach(async () => {
  stageScreen.value = null;
  await stopOutputs();
  openMediaWindow.mockClear();
});

describe("Iniciar com o retorno em Nenhum", () => {
  it("abre só a tela principal: o retorno não cai no monitor do operador", async () => {
    await startOutputs();

    expect(opened("projection")).toBe(true);
    expect(opened("return")).toBe(false);
    expect(screenOn.value).toEqual({ main: true, stage: false });
    // Tudo o que dá para ligar já está no ar.
    expect(appdata.get(KEYS.MODULES.PRESENTATION_MODE.CAN_START)).toBe(false);
  });

  it("com monitor no retorno, liga as duas telas", async () => {
    stageScreen.value = { id: "screen-2" };

    await startOutputs();

    expect(opened("projection")).toBe(true);
    expect(opened("return")).toBe(true);
    expect(screenOn.value).toEqual({ main: true, stage: true });
  });

  it("o liga/desliga do retorno não liga sem monitor", async () => {
    await setScreen("stage", true);

    expect(opened("return")).toBe(false);
    expect(screenOn.value.stage).toBe(false);
  });

  it("mandar algo só ao retorno não abre janela sem monitor", async () => {
    await showOnReturn({ type: "image", url: "louvorja://local/recado.jpg", title: "Recado", path: "/x/recado.jpg" });

    expect(opened("return")).toBe(false);
    await showOnReturn(null);
  });
});
