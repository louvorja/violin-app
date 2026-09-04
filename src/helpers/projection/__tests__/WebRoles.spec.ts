import { beforeEach, describe, expect, it, vi } from "vitest";

const store: Record<string, unknown> = {};

vi.mock("@/helpers/UserData", () => ({
  default: {
    get: (key: string, fallback: unknown) => (key in store ? store[key] : fallback),
    set: (key: string, value: unknown) => {
      store[key] = value;
    },
  },
}));

const SCREENS = [
  {
    id: "screen-0", label: "Tela Retina Integrada",
    bounds: { x: 0, y: 0, width: 1470, height: 918 },
    avail: { x: 0, y: 25, width: 1470, height: 893 },
    primary: true, internal: true, scaleFactor: 2, index: 0,
  },
  {
    id: "screen-1", label: "Apple TVJ (AirPlay)",
    bounds: { x: 1470, y: 0, width: 1920, height: 1080 },
    avail: { x: 1470, y: 0, width: 1920, height: 1080 },
    primary: false, internal: false, scaleFactor: 1, index: 1,
  },
];

let screens = SCREENS;

vi.mock("@/helpers/projection/WebDisplays", async () => {
  const { identityFromDisplay } = await import("@/helpers/MonitorIdentity");
  return {
    default: {
      listScreens: () => screens,
      identityOf: (s: (typeof SCREENS)[number]) => ({
        ...identityFromDisplay(
          { id: null, label: s.label, bounds: s.bounds, scaleFactor: s.scaleFactor,
            internal: s.internal, primary: s.primary },
          s.index
        ),
        source: "web", nativeId: null, rotation: null,
      }),
    },
  };
});

const WebRoles = (await import("@/helpers/projection/WebRoles")).default;

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  screens = SCREENS;
});

describe("setRole", () => {
  it("atribui um monitor ao papel e o mantém", () => {
    // Regressão: o id da tela no navegador é "screen-N"; convertê-lo para
    // número dava NaN e a escolha era descartada — o select desselecionava.
    WebRoles.setRole("projection", "screen-1");
    expect(WebRoles.screenForRole("projection")?.label).toBe("Apple TVJ (AirPlay)");
  });

  it("persiste a identidade, não o índice da tela", () => {
    WebRoles.setRole("projection", "screen-1");
    const salvo = WebRoles.rolesSummary().find((r) => r.role === "projection");
    expect(salvo?.status).toBe("resolved");
    expect(salvo?.displayId).toBe("screen-1");
  });

  it("reconhece o monitor mesmo se ele mudar de posição na lista", () => {
    WebRoles.setRole("projection", "screen-1");
    // Mesmo aparelho, agora reportado primeiro pelo navegador.
    screens = [
      { ...SCREENS[1], id: "screen-0", index: 0 },
      { ...SCREENS[0], id: "screen-1", index: 1 },
    ];
    expect(WebRoles.screenForRole("projection")?.label).toBe("Apple TVJ (AirPlay)");
  });

  it("marca como pendente quando o monitor foi desconectado", () => {
    WebRoles.setRole("projection", "screen-1");
    screens = [SCREENS[0]];
    const estado = WebRoles.rolesSummary().find((r) => r.role === "projection");
    expect(estado?.status).toBe("pending");
    expect(estado?.displayId).toBeNull();
  });

  it("ignora id de tela inexistente sem apagar a escolha anterior", () => {
    WebRoles.setRole("projection", "screen-1");
    WebRoles.setRole("projection", "screen-99");
    expect(WebRoles.screenForRole("projection")?.label).toBe("Apple TVJ (AirPlay)");
  });

  it("limpa o papel com null", () => {
    WebRoles.setRole("projection", "screen-1");
    WebRoles.setRole("projection", null);
    expect(WebRoles.screenForRole("projection")).toBeNull();
  });
});
