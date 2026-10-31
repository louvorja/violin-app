// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createPresenterOverlay } = require("../presenterOverlay.js");
const { isStateResponse } = require("../httpServer/presenterRoutes.js");

/** BrowserWindow de mentira: guarda o JavaScript que o overlay mandou rodar. */
function fakeWindow() {
  const calls = [];
  const wins = [];
  class FakeWin {
    constructor(opts) {
      this.opts = opts;
      this.destroyed = false;
      this.handlers = {};
      this.webContents = { executeJavaScript: (js) => (calls.push(js), Promise.resolve()) };
      wins.push(this);
    }
    setAlwaysOnTop() {}
    setIgnoreMouseEvents(v) {
      this.ignore = v;
    }
    setVisibleOnAllWorkspaces() {}
    on(ev, cb) {
      this.handlers[ev] = cb;
    }
    loadFile() {
      return Promise.resolve();
    }
    setBounds() {}
    showInactive() {
      this.shown = true;
    }
    moveTop() {}
    isDestroyed() {
      return this.destroyed;
    }
    close() {
      this.destroyed = true;
      this.handlers.closed?.();
    }
  }
  return { FakeWin, calls, wins };
}

const BOUNDS = { x: 1920, y: 0, width: 1920, height: 1080 };

describe("presenterOverlay", () => {
  it("abre a janela transparente e sem clique no monitor do PA ao usar o laser", async () => {
    const { FakeWin, calls, wins } = fakeWindow();
    const ov = createPresenterOverlay({ BrowserWindow: FakeWin, getBounds: () => BOUNDS });
    expect(await ov.laserMove(0.5, 0.25)).toBe(true);
    expect(wins).toHaveLength(1);
    expect(wins[0].opts).toMatchObject({ transparent: true, focusable: false, x: 1920 });
    expect(wins[0].ignore).toBe(true);
    expect(calls.some((js) => js.includes("ov.laser(0.5,0.25)"))).toBe(true);
  });

  it("recusa coordenada fora de 0–1 e sem monitor não abre nada", async () => {
    const { FakeWin, wins } = fakeWindow();
    const ov = createPresenterOverlay({ BrowserWindow: FakeWin, getBounds: () => null });
    expect(await ov.laserMove("x", 0.2)).toBe(false);
    await ov.laserMove(0.1, 0.2);
    expect(wins).toHaveLength(0);
  });

  it("limpa o traço vindo da rede: pontos presos a 0–1, cor válida e espessura limitada", () => {
    const ov = createPresenterOverlay({ BrowserWindow: class {}, getBounds: () => null });
    const s = ov._cleanStroke({ points: [[2, -1], ["a", 0.5], [0.3, 0.4]], color: "red;</script>", size: 999 });
    expect(s).toEqual({ points: [[1, 0], [0.3, 0.4]], color: "#ff4444", size: 40 });
    expect(ov._cleanStroke({ points: [] })).toBeNull();
    expect(ov._cleanStroke(null)).toBeNull();
  });

  it("desfazer, limpar e lousa branca mexem só nos traços guardados", async () => {
    const { FakeWin } = fakeWindow();
    const ov = createPresenterOverlay({ BrowserWindow: FakeWin, getBounds: () => BOUNDS });
    await ov.addStroke({ points: [[0.1, 0.1]], color: "#ffffff", size: 4 });
    await ov.addStroke({ points: [[0.2, 0.2]], color: "#ffffff", size: 4 });
    ov.undo();
    expect(ov.strokes()).toHaveLength(1);
    await ov.setBoard(true);
    expect(ov.state()).toMatchObject({ board: true, strokes: 0, open: true });
    ov.close();
    expect(ov.state()).toMatchObject({ board: false, strokes: 0, open: false });
  });

  it("fecha sozinha quando não sobra laser, desenho nem lousa", async () => {
    vi.useFakeTimers();
    try {
      const { FakeWin, wins } = fakeWindow();
      const ov = createPresenterOverlay({ BrowserWindow: FakeWin, getBounds: () => BOUNDS });
      await ov.laserMove(0.5, 0.5);
      ov.laserHide();
      vi.advanceTimersByTime(5000);
      expect(wins[0].destroyed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("presenterRoutes — contrato do estado", () => {
  it("aceita o estado do renderer e recusa o que foge do contrato", () => {
    const ok = { status: "ok", title: "Culto", page: 2, total: 40, aspect: 1.77, rev: "abc", native: false, black: false };
    expect(isStateResponse(ok)).toBe(true);
    expect(isStateResponse({ ...ok, total: -1 })).toBe(false);
    expect(isStateResponse({ ...ok, title: "x".repeat(501) })).toBe(false);
    expect(isStateResponse({ ...ok, page: 1.5 })).toBe(false);
  });
});
