"use strict";

/**
 * Aba Apresentação do controle remoto: o celular vê o slide no ar e as
 * miniaturas, vai a qualquer slide, aponta com o laser e desenha na lousa.
 *
 * - Estado, miniaturas e navegação vêm do renderer (o PDF no ar do modo
 *   apresentação), pelo mesmo `requestRenderer` das outras abas.
 * - Laser e lousa não passam pelo renderer: vão direto para a janela
 *   transparente sobre o telão (`presenterOverlay.js`), para o ponto seguir o
 *   dedo sem atraso.
 *
 * Permissão: a mesma das setas do Apresentador (`keyboard`) — quem já passa
 * os slides pelo celular pode também apontar e desenhar.
 */

const { safeSend } = require("../safeWebContents.js");

const NAV_ACTIONS = new Set(["next", "prev", "first", "last", "goto", "black"]);
const SLIDE_MAX_BYTES = 4 * 1024 * 1024;
const DATA_URL_RE = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/=]+)$/;

function isPlainObject(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function isStateResponse(p) {
  return (
    isPlainObject(p) &&
    p.status === "ok" &&
    typeof p.title === "string" &&
    p.title.length <= 500 &&
    Number.isInteger(p.page) &&
    Number.isInteger(p.total) &&
    p.total >= 0 &&
    p.total <= 10_000 &&
    typeof p.aspect === "number" &&
    typeof p.rev === "string" &&
    p.rev.length <= 64
  );
}

function isSlideResponse(p) {
  return isPlainObject(p) && (p.status === "error" || (p.status === "ok" && typeof p.image === "string"));
}

function register(app, { getValidMainWindow, requestRenderer, sendRendererError, hasDevicePermission, getOverlay }) {
  function allowed(req, res) {
    if (hasDevicePermission(req, "keyboard")) return true;
    res.status(403).json({ error: "Device sem permissão de teclas de atalho" });
    return false;
  }

  function mainWindowOr503(res) {
    const win = getValidMainWindow();
    if (!win) res.status(503).json({ error: "Janela principal não disponível" });
    return win;
  }

  // GET /api/presenter/state — o que está no ar e a página
  app.get("/api/presenter/state", async (req, res) => {
    if (!allowed(req, res)) return;
    const win = mainWindowOr503(res);
    if (!win) return;
    try {
      const data = await requestRenderer(win, res, "http:presenter", { action: "state" }, {
        prefix: "presenter",
        timeoutMs: 3_000,
        maxPayloadBytes: 8_192,
        validatePayload: isStateResponse,
      });
      const overlay = getOverlay();
      if (overlay) overlay.setAspect(data.aspect);
      if (!res.headersSent) res.json({ ...data, overlay: overlay ? overlay.state() : null });
    } catch (error) {
      sendRendererError(res, error, "Timeout ao ler a apresentação");
    }
  });

  // GET /api/presenter/slide/:n?w=960 — imagem de uma página do PDF no ar
  app.get("/api/presenter/slide/:n", async (req, res) => {
    if (!allowed(req, res)) return;
    const page = Number.parseInt(req.params.n, 10);
    if (!Number.isInteger(page) || page < 1 || page > 10_000) {
      return res.status(400).json({ error: "página inválida" });
    }
    const width = Math.min(1600, Math.max(160, Number.parseInt(String(req.query.w || "320"), 10) || 320));
    const win = mainWindowOr503(res);
    if (!win) return;
    try {
      const data = await requestRenderer(win, res, "http:presenter", { action: "slide", page, width }, {
        prefix: "presenter",
        timeoutMs: 8_000,
        maxPayloadBytes: SLIDE_MAX_BYTES,
        validatePayload: isSlideResponse,
      });
      if (res.headersSent) return;
      const m = data.status === "ok" ? DATA_URL_RE.exec(data.image) : null;
      if (!m) return res.status(404).json({ error: "slide indisponível" });
      res.set("Content-Type", `image/${m[1]}`);
      res.set("Cache-Control", "private, max-age=600");
      res.send(Buffer.from(m[2], "base64"));
    } catch (error) {
      sendRendererError(res, error, "Timeout ao desenhar o slide");
    }
  });

  // POST /api/presenter/nav — { action: next|prev|first|last|goto|black, page? }
  app.post("/api/presenter/nav", (req, res) => {
    if (!allowed(req, res)) return;
    const action = req.body && req.body.action;
    if (!NAV_ACTIONS.has(action)) {
      return res.status(400).json({ error: "action inválida", valid: [...NAV_ACTIONS] });
    }
    const page = Number.parseInt(req.body.page, 10);
    if (action === "goto" && (!Number.isInteger(page) || page < 1)) {
      return res.status(400).json({ error: "page é obrigatória para goto" });
    }
    const win = mainWindowOr503(res);
    if (!win) return;
    // Trocou de slide: o desenho era do slide anterior (na lousa branca, fica).
    const overlay = getOverlay();
    if (overlay && action !== "black" && !overlay.state().board) overlay.clear();
    safeSend(win, "http:presenter", { action: "nav", nav: action, ...(action === "goto" ? { page } : {}) });
    res.json({ status: "ok" });
  });

  // POST /api/presenter/zoom — { scale, x, y } amplia em volta do ponto; { fit: true } volta
  app.post("/api/presenter/zoom", async (req, res) => {
    if (!allowed(req, res)) return;
    const body = req.body || {};
    const win = mainWindowOr503(res);
    if (!win) return;
    const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : undefined);
    const payload =
      body.fit === true
        ? { action: "zoom", fit: true }
        : { action: "zoom", scale: num(body.scale), x: num(body.x), y: num(body.y) };
    try {
      const data = await requestRenderer(win, res, "http:presenter", payload, {
        prefix: "presenter",
        timeoutMs: 3_000,
        maxPayloadBytes: 1_024,
        validatePayload: (p) => isPlainObject(p) && p.status === "ok",
      });
      if (!res.headersSent) res.json({ status: "ok", zoom: data.zoom || null });
    } catch (error) {
      sendRendererError(res, error, "Timeout ao ampliar");
    }
  });

  // POST /api/presenter/laser — { x, y } (0–1) ou { hide: true }
  app.post("/api/presenter/laser", async (req, res) => {
    if (!allowed(req, res)) return;
    const overlay = getOverlay();
    if (!overlay) return res.status(503).json({ error: "Telão indisponível" });
    const body = req.body || {};
    if (body.hide === true) {
      overlay.laserHide();
      return res.json({ status: "ok" });
    }
    if (!overlay.hasDisplay()) return res.status(409).json({ error: "no_display" });
    const ok = await overlay.laserMove(body.x, body.y);
    if (!ok) return res.status(400).json({ error: "x e y de 0 a 1" });
    res.json({ status: "ok" });
  });

  // GET/POST /api/presenter/draw — traços da lousa
  app.get("/api/presenter/draw", (req, res) => {
    if (!allowed(req, res)) return;
    const overlay = getOverlay();
    res.json({ strokes: overlay ? overlay.strokes() : [], board: overlay ? overlay.state().board : false });
  });

  app.post("/api/presenter/draw", async (req, res) => {
    if (!allowed(req, res)) return;
    const overlay = getOverlay();
    if (!overlay) return res.status(503).json({ error: "Telão indisponível" });
    const body = req.body || {};
    // Sem monitor de projeção, o traço não teria onde aparecer.
    if ((body.op === "stroke" || (body.op === "board" && body.on === true)) && !overlay.hasDisplay()) {
      return res.status(409).json({ error: "no_display" });
    }
    switch (body.op) {
      case "stroke":
        if (!(await overlay.addStroke(body.stroke))) return res.status(400).json({ error: "traço inválido" });
        break;
      case "undo":
        overlay.undo();
        break;
      case "clear":
        overlay.clear();
        break;
      case "board":
        await overlay.setBoard(body.on === true);
        break;
      case "close":
        overlay.close();
        break;
      default:
        return res.status(400).json({ error: "op inválida" });
    }
    res.json({ status: "ok", ...overlay.state() });
  });
}

module.exports = { register, isStateResponse, isSlideResponse };
