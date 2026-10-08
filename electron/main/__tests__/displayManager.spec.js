// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "module";
import { EventEmitter } from "events";

/**
 * Contrato do displayManager: UM listener, debounce, e o broadcast que o
 * renderer (e o aviso da Shell) consomem.
 *
 * `displayManager.js` é CommonJS e faz `require("electron")` na carga. Numa
 * suíte Vitest esse `require` resolve o pacote de verdade (que em Node é só o
 * caminho do binário), então `vi.mock("electron")` não o alcança — o mesmo
 * achado de `onlineVideoHttpsRange.spec.js`. A técnica aqui é injetar os
 * módulos no `require.cache` ANTES de carregar o alvo: mesmo caminho absoluto,
 * mesmo cache, e o displayManager carrega com as dependências que o teste quer.
 */
const require = createRequire(import.meta.url);

let screen = null;
let logs = [];
let broadcasts = [];
let monitors = [];
let reconcileImpl = () => ({ shown: [], hidden: [] });
let reconcileChamadas = 0;

function injetar(specifier, exports) {
  const id = require.resolve(specifier);
  require.cache[id] = { id, filename: id, loaded: true, exports };
}

/** Recarrega o módulo alvo com as dependências injetadas do teste. */
function carregar() {
  delete require.cache[require.resolve("../displayManager.js")];
  injetar("electron", {
    screen,
    BrowserWindow: { getAllWindows: () => [{ id: 1 }] },
  });
  injetar("../displays.js", {
    connected: () => monitors,
    list: () => monitors,
    resolveFeature: () => ({ display: { id: 1 }, status: "resolved", reason: null, role: null }),
  });
  injetar("../monitorConfig.js", {
    reconcile: () => ({ changed: false, promoted: [] }),
  });
  injetar("../windowFactory.js", {
    reconcile: () => {
      reconcileChamadas += 1;
      return reconcileImpl();
    },
  });
  injetar("../safeWebContents.js", {
    safeSend: (_win, channel, payload) => broadcasts.push({ channel, ...payload }),
  });
  return require("../displayManager.js");
}

const BRIDGE = { getUserData: () => ({}), saveUserData: () => {} };

let dm = null;
let spyLog = null;

const texto = () => logs.join("\n");
const ultimo = () => broadcasts[broadcasts.length - 1];

/** Emite e espera a janela de debounce fechar. */
async function ciclo(...eventos) {
  for (const e of eventos) screen.emit(e);
  await vi.advanceTimersByTimeAsync(dm.DEBOUNCE_MS);
}

beforeEach(() => {
  screen = new EventEmitter();
  logs = [];
  broadcasts = [];
  monitors = [{ id: 1, bounds: { x: 0, y: 0 } }];
  reconcileImpl = () => ({ shown: [], hidden: [] });
  reconcileChamadas = 0;

  vi.useFakeTimers();
  spyLog = vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args.join(" ")));

  dm = carregar();
  dm.init(BRIDGE);
});

afterEach(() => {
  dm?.dispose();
  spyLog?.mockRestore();
  vi.useRealTimers();
  for (const spec of [
    "electron",
    "../displays.js",
    "../monitorConfig.js",
    "../windowFactory.js",
    "../safeWebContents.js",
    "../displayManager.js",
  ]) {
    try {
      delete require.cache[require.resolve(spec)];
    } catch {
      /* módulo que não resolveu — nada a limpar */
    }
  }
});

describe("displayManager", () => {
  it("agrupa a rajada de eventos do `screen` num ciclo só", async () => {
    await ciclo("display-added", "display-metrics-changed", "display-removed");

    expect(reconcileChamadas).toBe(1);
    expect(broadcasts).toHaveLength(1);
  });

  it("repassa as janelas ocultas e restauradas para os renderers", async () => {
    reconcileImpl = () => ({ shown: ["site"], hidden: ["retorno"] });

    await ciclo("display-metrics-changed");

    expect(ultimo().channel).toBe("displays:changed");
    expect(ultimo().hidden).toEqual(["retorno"]);
    expect(ultimo().shown).toEqual(["site"]);
    expect(ultimo().displays).toBe(monitors);
  });

  it("o resumo do log só aparece quando há algo novo a dizer", async () => {
    await ciclo("display-metrics-changed");
    const resumos = () => logs.filter((l) => l.includes("Mudança detectada")).length;
    expect(resumos()).toBe(1);

    /* Mesma situação de novo → o aviso ficaria empurrando o log de verdade. */
    await ciclo("display-metrics-changed");
    expect(resumos()).toBe(1);

    reconcileImpl = () => ({ shown: ["site"], hidden: [] });
    await ciclo("display-removed");
    expect(resumos()).toBe(2);
    expect(texto()).toContain("janelas restauradas: site");
  });

  it("dispose cancela o ciclo pendente e tira os listeners", async () => {
    dm.dispose();
    logs.length = 0;
    broadcasts.length = 0;
    reconcileChamadas = 0;

    await ciclo("display-metrics-changed");

    expect(reconcileChamadas).toBe(0);
    expect(broadcasts).toHaveLength(0);
  });
});
