import { beforeEach, describe, expect, it, vi } from "vitest";
import WebDisplays from "@/helpers/projection/WebDisplays";

/** Uma tela como a Window Management API a reporta. */
function screenDetailed(over: Record<string, unknown> = {}) {
  return {
    left: 0, top: 0, width: 1512, height: 982,
    availLeft: 0, availTop: 25, availWidth: 1512, availHeight: 957,
    isPrimary: true, isInternal: true,
    label: "Built-in Retina Display", devicePixelRatio: 2,
    addEventListener: vi.fn(),
    ...over,
  };
}

const PROJECTOR = screenDetailed({
  left: 1512, top: 0, width: 1920, height: 1080,
  availLeft: 1512, availTop: 0, availWidth: 1920, availHeight: 1080,
  isPrimary: false, isInternal: false, label: "BenQ MX532", devicePixelRatio: 1,
});

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("detecção de suporte", () => {
  it("reconhece navegador sem a API", () => {
    vi.stubGlobal("window", { screen: { width: 1512, height: 982 } });
    expect(WebDisplays.isSupported()).toBe(false);
  });

  it("reconhece navegador com a API", () => {
    vi.stubGlobal("window", { getScreenDetails: () => Promise.resolve({}) });
    expect(WebDisplays.isSupported()).toBe(true);
  });

  it("detecta mais de uma tela sem precisar de permissão", () => {
    vi.stubGlobal("window", { screen: { isExtended: true } });
    expect(WebDisplays.isExtended()).toBe(true);
  });
});

describe("permissionState", () => {
  it("responde unsupported quando a API não existe", async () => {
    vi.stubGlobal("window", {});
    expect(await WebDisplays.permissionState()).toBe("unsupported");
  });

  it("sobrevive ao nome de permissão desconhecido", async () => {
    // Consultar um nome que o navegador não conhece lança TypeError; sem o
    // try/catch a tela de Opções quebrava inteira.
    vi.stubGlobal("window", { getScreenDetails: () => Promise.resolve({}) });
    vi.stubGlobal("navigator", {
      permissions: {
        query: () => {
          throw new TypeError("unknown permission name");
        },
      },
    });
    expect(await WebDisplays.permissionState()).toBe("prompt");
  });

  it("reporta o estado concedido", async () => {
    vi.stubGlobal("window", { getScreenDetails: () => Promise.resolve({}) });
    vi.stubGlobal("navigator", {
      permissions: { query: async () => ({ state: "granted" }) },
    });
    expect(await WebDisplays.permissionState()).toBe("granted");
  });
});

describe("listScreens", () => {
  it("sem permissão, conta apenas a tela atual", () => {
    vi.stubGlobal("window", {
      screen: { width: 1512, height: 982, availWidth: 1512, availHeight: 957 },
      devicePixelRatio: 2,
    });
    const screens = WebDisplays.listScreens();
    expect(screens).toHaveLength(1);
    expect(screens[0].primary).toBe(true);
  });
});

describe("identityOf", () => {
  it("converte a tela no mesmo fingerprint usado no desktop", () => {
    vi.stubGlobal("window", { screen: {} });
    const screen = {
      id: "screen-1",
      label: PROJECTOR.label,
      bounds: { x: 1512, y: 0, width: 1920, height: 1080 },
      avail: { x: 1512, y: 0, width: 1920, height: 1080 },
      primary: false,
      internal: false,
      scaleFactor: 1,
      index: 1,
    };
    const identity = WebDisplays.identityOf(screen);
    expect(identity.label).toBe("BenQ MX532");
    expect(identity.px).toEqual({ w: 1920, h: 1080 });
    expect(identity.internal).toBe(false);
  });

  it("marca a origem como web e zera o que o navegador não informa", () => {
    // Sem isso, um fingerprint do navegador poderia ser comparado com um do
    // Electron — e as unidades de px e posição não são equivalentes.
    vi.stubGlobal("window", { screen: {} });
    const identity = WebDisplays.identityOf({
      id: "screen-0", label: "", bounds: { x: 0, y: 0, width: 1512, height: 982 },
      avail: { x: 0, y: 0, width: 1512, height: 957 },
      primary: true, internal: true, scaleFactor: 2, index: 0,
    });
    expect(identity.source).toBe("web");
    expect(identity.nativeId).toBeNull();
    expect(identity.rotation).toBeNull();
  });
});

describe("aviso de mudança de telas", () => {
  it("avisa ao conectar/desconectar monitor e respeita o cleanup", () => {
    // Regressão: o composable só reagia ao evento `focus` da janela, então
    // conectar um projetor não atualizava nada até recarregar a página.
    // `window.screen` emite `change` mesmo sem a permissão concedida.
    const handlers: Record<string, (() => void)[]> = {};
    vi.stubGlobal("window", {
      screen: {
        isExtended: false,
        addEventListener: (evt: string, cb: () => void) => {
          (handlers[evt] ||= []).push(cb);
        },
      },
    });

    const recebidos: string[] = [];
    const unQuebrado = WebDisplays.onChange(() => {
      throw new Error("listener com defeito");
    });
    const unBom = WebDisplays.onChange(() => recebidos.push("ok"));

    const disparar = () => handlers.change.forEach((h) => h());

    disparar();
    // Um listener com defeito não pode impedir os outros de serem avisados.
    expect(recebidos).toEqual(["ok"]);

    unQuebrado();
    unBom();
    disparar();
    expect(recebidos).toEqual(["ok"]);
  });
});
