// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { register } = require("../httpServer/presenterRoutes.js");

/** Express de mentira: guarda os handlers e chama um por vez. */
function fakeApp() {
  const routes = {};
  const add = (method) => (p, h) => (routes[`${method} ${p}`] = h);
  return { routes, get: add("GET"), post: add("POST") };
}

function fakeRes() {
  const res = { statusCode: 200, body: undefined, headersSent: false };
  res.status = (c) => ((res.statusCode = c), res);
  res.json = (b) => ((res.body = b), (res.headersSent = true), res);
  res.set = () => res;
  res.send = (b) => ((res.body = b), (res.headersSent = true), res);
  return res;
}

function fakeOverlay({ display = true } = {}) {
  return {
    hasDisplay: () => display,
    state: () => ({ laser: false, board: false, strokes: 0, open: false, display }),
    setAspect: vi.fn(),
    clear: vi.fn(),
    laserMove: vi.fn(async (x, y) => x >= 0 && x <= 1 && y >= 0 && y <= 1),
    laserHide: vi.fn(),
    addStroke: vi.fn(async () => true),
    undo: vi.fn(),
    setBoard: vi.fn(async () => {}),
    close: vi.fn(),
    strokes: () => [],
  };
}

function setup({ permission = true, overlay = fakeOverlay(), renderer } = {}) {
  const app = fakeApp();
  const sent = [];
  const win = { id: 1 };
  register(app, {
    getValidMainWindow: () => win,
    requestRenderer: renderer ?? vi.fn(async () => ({ status: "ok" })),
    sendRendererError: (res) => res.status(504).json({ error: "timeout" }),
    hasDevicePermission: () => permission,
    getOverlay: () => overlay,
  });
  // safeSend fala com a janela; aqui basta saber que foi chamado.
  win.isDestroyed = () => false;
  win.webContents = { isDestroyed: () => false, send: (ch, data) => sent.push({ ch, data }) };
  const call = async (key, body = {}, params = {}, query = {}) => {
    const res = fakeRes();
    await app.routes[key]({ body, params, query, headers: {} }, res);
    return res;
  };
  return { call, sent, overlay };
}

describe("presenterRoutes", () => {
  it("sem a permissão de teclas, nada passa", async () => {
    const { call } = setup({ permission: false });
    for (const key of ["GET /api/presenter/state", "POST /api/presenter/nav", "POST /api/presenter/laser", "POST /api/presenter/draw", "POST /api/presenter/zoom"]) {
      expect((await call(key, { action: "next" })).statusCode).toBe(403);
    }
  });

  it("navegação só aceita as ações conhecidas e exige página no goto", async () => {
    const { call } = setup();
    expect((await call("POST /api/presenter/nav", { action: "apagar" })).statusCode).toBe(400);
    expect((await call("POST /api/presenter/nav", { action: "goto" })).statusCode).toBe(400);
    expect((await call("POST /api/presenter/nav", { action: "goto", page: 3 })).statusCode).toBe(200);
  });

  it("trocar de slide limpa o desenho, menos com a lousa branca ou na tela preta", async () => {
    const overlay = fakeOverlay();
    const { call } = setup({ overlay });
    await call("POST /api/presenter/nav", { action: "next" });
    expect(overlay.clear).toHaveBeenCalledTimes(1);
    await call("POST /api/presenter/nav", { action: "black" });
    expect(overlay.clear).toHaveBeenCalledTimes(1);
  });

  it("sem telão, laser e traço respondem 409 em vez de falhar calados", async () => {
    const { call } = setup({ overlay: fakeOverlay({ display: false }) });
    expect((await call("POST /api/presenter/laser", { x: 0.5, y: 0.5 })).statusCode).toBe(409);
    expect((await call("POST /api/presenter/draw", { op: "stroke", stroke: { points: [[0, 0]] } })).statusCode).toBe(409);
    expect((await call("POST /api/presenter/draw", { op: "board", on: true })).statusCode).toBe(409);
    // Esconder o laser e limpar continuam valendo.
    expect((await call("POST /api/presenter/laser", { hide: true })).statusCode).toBe(200);
    expect((await call("POST /api/presenter/draw", { op: "clear" })).statusCode).toBe(200);
  });

  it("laser fora de 0–1 é recusado", async () => {
    const { call } = setup();
    expect((await call("POST /api/presenter/laser", { x: 2, y: 0.5 })).statusCode).toBe(400);
  });

  it("slide com número inválido é recusado sem perguntar ao renderer", async () => {
    const renderer = vi.fn();
    const { call } = setup({ renderer });
    expect((await call("GET /api/presenter/slide/:n", {}, { n: "0" })).statusCode).toBe(400);
    expect((await call("GET /api/presenter/slide/:n", {}, { n: "abc" })).statusCode).toBe(400);
    expect(renderer).not.toHaveBeenCalled();
  });

  it("zoom repassa só números ao renderer", async () => {
    const renderer = vi.fn(async () => ({ status: "ok", zoom: { scale: 2, cx: 0.4, cy: 0.5 } }));
    const { call } = setup({ renderer });
    const res = await call("POST /api/presenter/zoom", { scale: "2", x: "0.3", y: "abc" });
    expect(renderer.mock.calls[0][3]).toEqual({ action: "zoom", scale: 2, x: 0.3, y: undefined });
    expect(res.body).toEqual({ status: "ok", zoom: { scale: 2, cx: 0.4, cy: 0.5 } });
  });

  it("abrir arquivo exige um id e devolve 404 quando o PC não acha", async () => {
    const renderer = vi.fn(async () => ({ status: "error", error: "not_found" }));
    const { call } = setup({ renderer });
    expect((await call("POST /api/presenter/open", {})).statusCode).toBe(400);
    expect((await call("POST /api/presenter/open", { id: "x".repeat(300) })).statusCode).toBe(400);
    expect(renderer).not.toHaveBeenCalled();
    expect((await call("POST /api/presenter/open", { id: "file_1" })).statusCode).toBe(404);
    expect(renderer.mock.calls[0][3]).toEqual({ action: "open", id: "file_1" });
  });

  it("animações e telão só aceitam on true/false", async () => {
    const renderer = vi.fn(async () => ({ status: "ok" }));
    const { call } = setup({ renderer });
    expect((await call("POST /api/presenter/native", { on: "sim" })).statusCode).toBe(400);
    expect((await call("POST /api/presenter/screen", {})).statusCode).toBe(400);
    expect((await call("POST /api/presenter/native", { on: true })).statusCode).toBe(200);
    expect((await call("POST /api/presenter/screen", { on: false })).statusCode).toBe(200);
    expect(renderer.mock.calls.map((c) => c[3])).toEqual([
      { action: "native", on: true },
      { action: "screen", on: false },
    ]);
  });

  it("PowerPoint que não abriu volta 409 para o celular avisar", async () => {
    const { call } = setup({ renderer: vi.fn(async () => ({ status: "error", error: "native_failed" })) });
    const res = await call("POST /api/presenter/native", { on: true });
    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ error: "native_failed" });
  });

  it("lista da Biblioteca só passa com o formato esperado", () => {
    const { isFilesResponse } = require("../httpServer/presenterRoutes.js");
    expect(isFilesResponse({ status: "ok", items: [{ id: "a", name: "Culto", kind: "pptx" }] })).toBe(true);
    expect(isFilesResponse({ status: "ok", items: [{ id: "a", name: "Culto", kind: "exe" }] })).toBe(false);
    expect(isFilesResponse({ status: "ok", items: [{ id: 1, name: "Culto", kind: "pdf" }] })).toBe(false);
  });

  it("Iniciar e Parar pedem ao PC o mesmo Iniciar/Parar do módulo", async () => {
    const renderer = vi.fn(async () => ({ status: "ok" }));
    const { call } = setup({ renderer });
    expect((await call("POST /api/presenter/start")).statusCode).toBe(200);
    expect((await call("POST /api/presenter/stop")).statusCode).toBe(200);
    expect(renderer.mock.calls.map((c) => c[3])).toEqual([{ action: "start" }, { action: "stop" }]);
  });

  it("sem a permissão de teclas, Iniciar, Parar e a imagem no ar não passam", async () => {
    const renderer = vi.fn();
    const { call } = setup({ permission: false, renderer });
    for (const key of ["POST /api/presenter/start", "POST /api/presenter/stop", "GET /api/presenter/live-image"]) {
      expect((await call(key)).statusCode).toBe(403);
    }
    expect(renderer).not.toHaveBeenCalled();
  });

  it("imagem no ar: devolve os bytes, e 404 quando o PC não tem imagem", async () => {
    const png = "data:image/jpeg;base64," + Buffer.from("jpg").toString("base64");
    const renderer = vi.fn(async () => ({ status: "ok", image: png }));
    const ok = setup({ renderer });
    const res = await ok.call("GET /api/presenter/live-image", {}, {}, { w: "99999" });
    expect(res.statusCode).toBe(200);
    expect(Buffer.isBuffer(res.body)).toBe(true);
    // A largura pedida é limitada antes de chegar ao renderer.
    expect(renderer.mock.calls[0][3]).toEqual({ action: "live-image", width: 1600 });
    const none = setup({ renderer: vi.fn(async () => ({ status: "error" })) });
    expect((await none.call("GET /api/presenter/live-image")).statusCode).toBe(404);
  });

  it("estado com o que está no ar além do PDF passa; texto grande demais não", () => {
    const { isStateResponse } = require("../httpServer/presenterRoutes.js");
    const base = { status: "ok", title: "Vinde", page: 0, total: 0, aspect: 1.77, rev: "" };
    const live = { text: "Vinde, povo do Senhor", page: 2, total: 14, image: "" };
    expect(isStateResponse(base)).toBe(true);
    expect(isStateResponse({ ...base, live })).toBe(true);
    expect(isStateResponse({ ...base, live: { ...live, text: "x".repeat(1_501) } })).toBe(false);
    expect(isStateResponse({ ...base, live: { ...live, image: 5 } })).toBe(false);
  });
});
