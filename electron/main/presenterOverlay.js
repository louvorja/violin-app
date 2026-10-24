"use strict";

/**
 * Laser e lousa do controle remoto — por cima do telão.
 *
 * Uma janela transparente, sem foco e que deixa o clique passar, fica sobre o
 * monitor do PA só enquanto alguém usa o laser ou a lousa. Ela não sabe nada
 * do que está projetado por baixo (música, PDF, o PowerPoint com animações):
 * por isso funciona com qualquer conteúdo e não mexe nas janelas de projeção.
 *
 * As coordenadas vêm do celular de 0 a 1, relativas à área do slide; a área
 * é o slide encaixado na tela pela proporção (`aspect`) do que está no ar.
 * Mesmo modelo do SlideFlow.
 */

const path = require("path");

const MAX_STROKES = 400;
const MAX_POINTS = 4000;
const COLOR_RE = /^#[0-9a-f]{6}$/i;
/** Sem laser, sem desenho e sem lousa branca, a janela sai depois deste tempo. */
const CLOSE_IDLE_MS = 4000;

function createPresenterOverlay({ BrowserWindow, getBounds, log = () => {} }) {
  let win = null;
  let ready = null;
  let board = false;
  let laser = false;
  let aspect = 16 / 9;
  let strokes = [];
  let closeTimer = null;

  function alive() {
    return !!win && !win.isDestroyed();
  }

  function call(fn, ...args) {
    if (!alive()) return;
    const js = `window.ov && window.ov.${fn}(${args.map((a) => JSON.stringify(a)).join(",")})`;
    win.webContents.executeJavaScript(js).catch(() => {});
  }

  async function ensure() {
    clearTimeout(closeTimer);
    if (alive()) {
      // O PowerPoint em tela cheia também fica no topo: quem chegou por último vence.
      win.moveTop();
      return ready;
    }
    const b = getBounds();
    if (!b) return null;
    win = new BrowserWindow({
      x: b.x,
      y: b.y,
      width: b.width,
      height: b.height,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      focusable: false,
      skipTaskbar: true,
      hasShadow: false,
      alwaysOnTop: true,
      show: false,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
    });
    win.setAlwaysOnTop(true, "screen-saver");
    win.setIgnoreMouseEvents(true);
    if (typeof win.setVisibleOnAllWorkspaces === "function") {
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    }
    win.on("closed", () => {
      win = null;
      ready = null;
    });
    const w = win;
    ready = w
      .loadFile(path.join(__dirname, "presenterOverlay.html"))
      .then(() => {
        if (w.isDestroyed()) return null;
        w.setBounds(b);
        w.showInactive();
        call("setAspect", aspect);
        call("setBoard", board);
        call("sync", strokes);
        return w;
      })
      .catch((e) => {
        log("[presenterOverlay] não abriu:", e && e.message);
        return null;
      });
    return ready;
  }

  /** Fecha quando não sobra nada à vista. */
  function idle() {
    clearTimeout(closeTimer);
    if (laser || board || strokes.length) return;
    closeTimer = setTimeout(() => {
      if (!laser && !board && !strokes.length && alive()) win.close();
    }, CLOSE_IDLE_MS);
  }

  function clamp01(v) {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : null;
  }

  /** Traço vindo da rede: só pontos válidos, cor #rrggbb e espessura razoável. */
  function cleanStroke(raw) {
    if (!raw || typeof raw !== "object" || !Array.isArray(raw.points)) return null;
    const points = [];
    for (const p of raw.points.slice(0, MAX_POINTS)) {
      if (!Array.isArray(p)) continue;
      const x = clamp01(p[0]);
      const y = clamp01(p[1]);
      if (x !== null && y !== null) points.push([x, y]);
    }
    if (!points.length) return null;
    const size = Number(raw.size);
    return {
      points,
      color: typeof raw.color === "string" && COLOR_RE.test(raw.color) ? raw.color : "#ff4444",
      size: Number.isFinite(size) ? Math.min(40, Math.max(1, size)) : 4,
    };
  }

  return {
    state() {
      return { laser, board, strokes: strokes.length, open: alive() };
    },
    strokes() {
      return strokes;
    },
    setAspect(a) {
      const n = Number(a);
      if (!Number.isFinite(n) || n < 0.2 || n > 5 || Math.abs(n - aspect) < 0.001) return;
      aspect = n;
      call("setAspect", aspect);
    },
    async laserMove(x, y) {
      const nx = clamp01(x);
      const ny = clamp01(y);
      if (nx === null || ny === null) return false;
      laser = true;
      if (!alive()) await ensure();
      call("laser", nx, ny);
      return true;
    },
    laserHide() {
      laser = false;
      call("laserHide");
      idle();
    },
    async addStroke(raw) {
      const s = cleanStroke(raw);
      if (!s) return false;
      strokes.push(s);
      if (strokes.length > MAX_STROKES) strokes = strokes.slice(-MAX_STROKES);
      if (!alive()) await ensure();
      call("stroke", s);
      return true;
    },
    undo() {
      strokes.pop();
      call("sync", strokes);
      idle();
    },
    clear() {
      strokes = [];
      call("sync", strokes);
      idle();
    },
    async setBoard(on) {
      board = !!on;
      if (board) {
        strokes = [];
        await ensure();
      }
      call("setBoard", board);
      call("sync", strokes);
      idle();
    },
    /** Monitor do PA mudou: a janela vai junto. */
    reposition() {
      const b = getBounds();
      if (alive() && b) win.setBounds(b);
    },
    close() {
      clearTimeout(closeTimer);
      laser = false;
      board = false;
      strokes = [];
      if (alive()) win.close();
    },
    _cleanStroke: cleanStroke,
  };
}

module.exports = { createPresenterOverlay };
