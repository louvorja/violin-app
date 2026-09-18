"use strict";

/**
 * Servidor HTTP embarcado do LouvorJA (D5).
 *
 * Replica o servidor TIdHTTPServer de `fmTransmitir.pas` (Delphi) para que:
 *  - OBS / smartphones acessem `http://<ip>:7070/musica?transmissao` etc.
 *  - clients remotos chamem a API `/api/*` (controle remoto, hotkeys via HTTP)
 *  - o módulo `remote_control` continue funcionando como cliente
 *
 * Camadas (na ordem em que rodam por request):
 *   1. CORS — `Access-Control-*` em todas as respostas
 *   2. setupAuth — token via `?token=` (bypass para localhost)
 *   3. setupRoutes — `/api/*` e `/events` (SSE)
 *   4. spa.install — aliases Delphi + SPA estática/proxy ao Vite
 *
 * Porta default: 7070 (compatibilidade Delphi).
 * Token: gerado de 5 chars (A-Z0-9) e persistido em `userStore.config.httpServer.token`
 * para sobreviver entre boots — ligações antigas continuam válidas.
 */

const express = require("express");
const path = require("path");
const fs = require("fs-extra");
const net = require("net");
const { app: electronApp, BrowserWindow } = require("electron");

const paths = require("../paths.js");
const userStore = require("../userStore.js");
const jsonCache = require("../jsonCache.js");
const protocolModule = require("../protocol.js");
const devices = require("../devices.js");
const { setupAuth } = require("./auth.js");
const { setupRoutes } = require("./routes.js");
const events = require("./events.js");
const spa = require("./spa.js");

let _server = null;
let _port = 7070;
let _token = null;
let _mainWindow = null;
let _externalRoutesEnabled = true;
/** @type {Set<import('net').Socket>} */
const _sockets = new Set();

/** Caracteres usados para gerar o token. Mesma faixa do `geraToken` do Delphi. */
const TOKEN_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
function generateToken() {
  let out = "";
  for (let i = 0; i < 5; i++) {
    out += TOKEN_CHARS[Math.floor(Math.random() * TOKEN_CHARS.length)];
  }
  return out;
}

/**
 * Range de portas para o fallback quando a porta base está em uso.
 * Se a porta base (7070 ou salva) estiver ocupada, o servidor sorteia uma
 * porta aleatória neste range até achar uma livre (MAX_PORT_ATTEMPTS).
 */
const PORT_RANGE = { min: 7000, max: 9000 };
const MAX_PORT_ATTEMPTS = 100;

/**
 * Sorteia uma porta aleatória no range, ignorando as já tentadas.
 * @param {Set<number>} excluded Portas já tentadas
 * @returns {number}
 */
function _randomPort(excluded) {
  const { min, max } = PORT_RANGE;
  let port;
  do {
    port = min + Math.floor(Math.random() * (max - min + 1));
  } while (excluded.has(port));
  return port;
}

/**
 * Verifica se ALGUÉM já escuta na porta (IPv4 e/ou IPv6 loopback).
 *
 * Necessário porque `app.listen(port, "0.0.0.0")` só lança EADDRINUSE para
 * conflitos IPv4. Se outro processo (ex.: versão Delphi do LouvorJA) escuta
 * em IPv6 (`::1`/`[::]`), o bind IPv4 do Express "passa" sem erro e a janela
 * acaba carregando o servidor errado. Este probe de TCP detecta qualquer
 * listener na porta, independente da família de endereço.
 *
 * @param {number} port
 * @param {number} [timeoutMs] Em loopback uma porta ocupada recusa (RST) em
 *   poucos ms; o timeout só é pago quando algo intercepta o probe sem
 *   responder (firewall/antivírus de rede) — e isso pode se repetir a cada
 *   porta sorteada antes de a janela aparecer. 500ms nesse cenário chegava a
 *   somar segundos de boot; 200ms ainda é folgado para localhost.
 * @returns {Promise<{ inUse: boolean }>}
 */
function _probePort(port, timeoutMs = 200) {
  return new Promise((resolve) => {
    const hosts = ["127.0.0.1", "::1"];
    let remaining = hosts.length;
    let inUse = false;
    const done = (v) => {
      if (v) inUse = true;
      if (--remaining === 0) resolve({ inUse });
    };
    for (const host of hosts) {
      const sock = net.connect({ host, port, timeout: timeoutMs });
      sock.once("connect", () => { sock.destroy(); done(true); });
      sock.once("error", () => { sock.destroy(); done(false); });
      sock.once("timeout", () => { sock.destroy(); done(false); });
    }
  });
}

/**
 * Lê o token persistido em `userStore.config.httpServer.token`.
 * Se não existir (ou for inválido), gera um novo e persiste.
 */
function _loadOrCreateToken() {
  let token = null;
  try {
    const cfg = userStore.read("config") || {};
    token = cfg.httpServer && typeof cfg.httpServer.token === "string"
      ? cfg.httpServer.token.trim()
      : null;
  } catch (_) { /* userStore indisponível — usa token efêmero */ }

  if (!token || token.length < 4) {
    token = generateToken();
    try {
      const cfg = userStore.read("config") || {};
      cfg.httpServer = { ...(cfg.httpServer || {}), token };
      userStore.write("config", cfg);
    } catch (_) { /* segue com token em memória */ }
  }
  return token;
}

/** Persiste a porta usada quando o servidor sobe. */
function _persistPort(port) {
  try {
    const cfg = userStore.read("config") || {};
    cfg.httpServer = { ...(cfg.httpServer || {}), port };
    userStore.write("config", cfg);
  } catch (_) { /* noop */ }
}

/** Em dev, app.isPackaged é false. Útil para escolher entre estático e proxy. */
function _isDev() {
  if (process.env.ELECTRON_DEV === "1") return true;
  if (electronApp && typeof electronApp.isPackaged === "boolean") return !electronApp.isPackaged;
  return false;
}

/**
 * Inicia o servidor HTTP embarcado.
 * Idempotente: se já estiver rodando, devolve o status atual sem reiniciar.
 *
 * @param {{ port?: number, mainWindow?: Electron.BrowserWindow }} opts
 * @returns {Promise<{ port: number, token: string }>}
 */
async function start({ port, mainWindow } = {}) {
  // Sempre atualiza _mainWindow se fornecido (chamado no boot e re-start).
  if (mainWindow) _mainWindow = mainWindow;
  if (_server) return Promise.resolve({ port: _port, token: _token });

  // Resolve a porta: param > userStore > 7070.
  if (typeof port === "number" && port > 0) {
    _port = port;
  } else {
    try {
      const cfg = userStore.read("config") || {};
      _port = (cfg.httpServer && cfg.httpServer.port) || 7070;
    } catch (_) {
      _port = 7070;
    }
  }
  _token = _loadOrCreateToken();
  // Não descarta uma janela já registrada quando o caller não passa uma
  // (ex.: renderer reinicia o servidor sem conhecer a janela).
  if (mainWindow) _mainWindow = mainWindow;
  else if (_mainWindow && _mainWindow.isDestroyed()) _mainWindow = null;

  // Configura events.js para reescrever louvorja://* nos payloads SSE
  // usando as URLs HTTPS reais (clients remotos não conhecem o protocolo).
  events.setRemoteConfigProvider(() => protocolModule.getRemoteConfig());

  const app = express();
  app.disable("x-powered-by");
  app.use(express.json()); // Permite ler JSON no body (necessário para body.token)

  // Rastreia sockets ativos para destruí-los no stop()
  app.use((req, res, next) => {
    _sockets.add(req.socket);
    res.on("finish", () => _sockets.delete(req.socket));
    next();
  });

  // Log global de todos os requests (diagnóstico)
  app.use((req, res, next) => {
    const ip = req.ip || req.socket?.remoteAddress || "";
    if (!ip.includes("127.0.0.1") && !ip.includes("::1")) {
      console.log(`[httpServer] ${req.method} ${req.originalUrl} from ${ip}`);
    }
    next();
  });

  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Api-Token, X-Token, X-Device-Id, X-Device-Token");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });

  /**
   * Gate de rotas externas.
   *
   * Quando _externalRoutesEnabled é false, apenas requests originados de
   * localhost (127.0.0.1, ::1) podem acessar SSE, API, aliases Delphi e
   * arquivos legacy. Requests de IPs remotos recebem 404.
   *
   * A SPA (servir o app Vue para janelas Electron) permanece acessível
   * de qualquer origem porque as janelas internas precisam da origem HTTP
   * para YouTube IFrame API e BroadcastChannel.
   */
  const EXTERNAL_PREFIXES = ['/events', '/api', '/legacy'];
  const EXTERNAL_PATHS = new Set(['/musica', '/biblia', '/controle', '/remote', '/relogio', '/projecao']);
  // /api/register-device é acessado por devices novos (não autenticados) — nunca bloquear.
  const EXTERNAL_EXEMPT = new Set(['/api/register-device']);

  function _isLocalhost(ip) {
    return (
      ip === "127.0.0.1" ||
      ip === "::1" ||
      ip === "::ffff:127.0.0.1" ||
      ip === "localhost"
    );
  }

  app.use((req, res, next) => {
    if (_externalRoutesEnabled) return next();
    const p = req.path;
    // Exceções nunca são bloqueadas (register-device precisa acessível de qualquer IP).
    if (EXTERNAL_EXEMPT.has(p)) return next();
    if (
      EXTERNAL_PREFIXES.some(pref => p.startsWith(pref)) ||
      EXTERNAL_PATHS.has(p)
    ) {
      const ip = req.ip || req.socket?.remoteAddress || "";
      if (!_isLocalhost(ip)) {
        console.log(`[httpServer] Gate bloqueou: ${req.method} ${p} de ${ip}`);
        return res.status(404).json({
          error: 'Rotas externas desabilitadas. Acesse via localhost.',
        });
      }
    }
    next();
  });

  // ─── Registro de dispositivos (ANTES do auth — device ainda não tem permissões) ───
  app.post("/api/register-device", (req, res) => {
    console.log(`[httpServer] POST /api/register-device body=`, JSON.stringify(req.body), `ip=${req.ip}`);
    const { token, name, model, platform, fingerprint } = req.body || {};
    if (!token || typeof token !== "string" || token.length < 8) {
      console.warn(`[httpServer] POST /api/register-device: token inválido (${typeof token}, len=${token?.length})`);
      return res.status(400).json({ status: "error", message: "Token inválido" });
    }
    if (!fingerprint || typeof fingerprint !== "string") {
      console.warn(`[httpServer] POST /api/register-device: fingerprint obrigatório`);
      return res.status(400).json({ status: "error", message: "Fingerprint obrigatório" });
    }
    const validPlatforms = ["android", "ios", "web"];
    const devPlatform = validPlatforms.includes(platform) ? platform : "web";
    const device = devices.addPending({ token, name: name || "Dispositivo", model: model || "", platform: devPlatform, fingerprint });
    console.log(`[httpServer] Device registrado: ${device.name} (${device.platform}) model=${device.model} id=${device.id.slice(0, 8)} token=${device.token.slice(0, 8)}...`);

    // Foca a janela principal para que o operador veja o diálogo de aprovação
    const windows = BrowserWindow.getAllWindows().filter((w) => w && !w.isDestroyed());
    if (windows.length) {
      // Prioriza a janela principal (Shell)
      const mainWin = windows.find((w) => !w.isDestroyed() && !w.isMinimized());
      if (mainWin) {
        try { mainWin.focus(); } catch (_) { /* noop */ }
      } else if (windows.length > 0) {
        try { windows[0].show(); windows[0].focus(); } catch (_) { /* noop */ }
      }
      const currentList = devices.list();
      for (const w of windows) {
        try {
          w.webContents.send("devices:pending", device);
          w.webContents.send("devices:changed", currentList);
        } catch (e) {
          console.error("[httpServer] Falha ao enviar devices:pending:", e?.message || e);
        }
      }
      console.log(`[httpServer] devices:pending enviado para ${windows.length} janela(s)`);
    } else {
      console.warn("[httpServer] Nenhuma janela disponível — device registrado mas diálogo não abriu");
    }
    res.json({ status: "pending", message: "Aguardando aprovação do host", device });
  });

  // Token resolvido a cada request — `resetToken()` muda `_token` em
  // memória e o middleware passa a validar o novo automaticamente.
  app.use(setupAuth(
    () => _token,
    (token) => devices.findByToken(token),
    (id) => devices.findById(id),
    () => devices.isOnlyAuthorized(),
    // Device pareado mas ainda sem permissões pode conferir a conexão.
    { allowUnapprovedPaths: ["/api/ping"] },
  ));

  // SSE — clients remotos (OBS/celular) recebem slide_change, bible_verse,
  // module_projection_value etc. Auth já passou (token query ou localhost).
  app.get("/events", events.handler);

  setupRoutes(app, {
    getMainWindow: () => _mainWindow,
    getUserData: () => getUserData(),
    jsonCache,
    getDatabaseUrl: () => protocolModule.getRemoteConfig().databaseUrl,
    getApiToken: () => protocolModule.getRemoteConfig().apiToken,
  });

  // Arquivos legacy do Delphi (`userData/server/*`) — opcional, mantém
  // compatibilidade com instalações antigas que ainda apontem para esse path.
  const legacyDir = path.join(paths.userData(), "server");
  fs.ensureDirSync(legacyDir);
  app.use("/legacy", express.static(legacyDir));

  // SPA + aliases Delphi (/musica?transmissao, /biblia?transmissao, ...).
  spa.install(app, {
    isDev: _isDev(),
    distDir: paths.webBuild(),
    getToken: () => _token,
    getUserData: () => getUserData(),
    // Em dev, `LJ_SERVE_DIST=1` faz os clients REMOTOS (celular, OBS) receberem
    // o bundle de produção; localhost continua no Vite (HMR).
    serveDistToRemote: process.env.LJ_SERVE_DIST === "1",
  });

  return new Promise((resolve, reject) => {
    const tried = new Set();
    const tryPort = (port) => {
      if (tried.size >= MAX_PORT_ATTEMPTS) {
        const err = new Error("Nenhuma porta disponível no range configurado");
        err.portExhausted = true;
        return reject(err);
      }
      tried.add(port);
      const server = app.listen(port, "0.0.0.0", () => {
        _server = server;
        _port = port;
        _persistPort(port);
        console.log(`[httpServer] Rodando em http://0.0.0.0:${_port} (token: ${_token})`);
        // Pede à janela principal que reemita o estado atual (slide, versículo,
        // valores de módulos). Sem isso, ligar o servidor com música já tocando
        // deixaria o cliente SSE conectado mas sem nada para renderizar — os
        // emissores só publicam ao MUDAR de slide/versículo.
        try {
          if (_mainWindow && !_mainWindow.isDestroyed()) {
            _mainWindow.webContents.send("transmission:request-state");
          }
        } catch (_) { /* noop */ }
        resolve({ port, token: _token });
      });
      server.on("error", (err) => {
        if (err.code === "EADDRINUSE") {
          try { server.close(); } catch (_) { /* noop */ }
          console.warn(`[httpServer] Porta ${port} em uso, tentando porta aleatória...`);
          tryPort(_randomPort(tried));
        } else {
          _server = null;
          reject(err);
        }
      });
    };
    // Probe antes de escolher: detecta qualquer listener na porta (IPv4/IPv6),
    // incluindo o servidor da versão Delphi que o EADDRINUSE IPv4 não pega.
    _probePort(_port).then((probe) => {
      if (probe.inUse) {
        console.warn(`[httpServer] Porta base ${_port} ocupada (probe) — sorteando outra...`);
        tryPort(_randomPort(tried));
      } else {
        // Tenta primeiro a porta base (7070 ou salva); se ocupada, sorteia no range.
        tryPort(_port);
      }
    });
  });
}

/** Para o servidor HTTP. No-op se já parado. */
function stop() {
  return new Promise((resolve) => {
    events.closeAll();

    if (!_server) return resolve();

    // Destroi sockets ativos para evitar que server.close() trave
    // com conexões SSE ou keep-alive
    for (const socket of _sockets) {
      socket.destroy();
    }
    _sockets.clear();

    _server.close(() => {
      _server = null;
      // A referência da janela é mantida: o `closed` da janela principal
      // (main.cjs) é quem zera quando ela realmente é destruída.
      // O token permanece em memória/userStore — startup futuro reaproveita.
      console.log("[httpServer] Parado.");
      resolve();
    });
  });
}

/**
 * Reset do token. UI pode chamar via `httpServer:resetToken` para revogar
 * acessos antigos.
 */
function resetToken() {
  _token = generateToken();
  try {
    const cfg = userStore.read("config") || {};
    cfg.httpServer = { ...(cfg.httpServer || {}), token: _token };
    userStore.write("config", cfg);
  } catch (_) { /* noop */ }
  return _token;
}

/**
 * Define se as rotas externas (SSE, API, aliases Delphi) estão ativas.
 *
 * Quando desativadas, apenas requests de localhost podem acessá-las.
 * A SPA (app Vue para janelas Electron) sempre funciona de qualquer
 * origem — necessária para YouTube IFrame API e BroadcastChannel.
 *
 * @param {boolean} enabled
 */
function setExternalRoutesEnabled(enabled) {
  _externalRoutesEnabled = !!enabled;
}

function getExternalRoutesEnabled() {
  return _externalRoutesEnabled;
}

function status() {
  return {
    running: !!_server,
    port: _server ? _port : null,
    token: _token,
    externalRoutesEnabled: _externalRoutesEnabled,
    sse: events.status(),
  };
}

function setMainWindow(win) {
  _mainWindow = win;
}

/**
 * Encaminha uma mensagem do BroadcastChannel local para os clients SSE.
 * Chamado pelo IPC `transmission:broadcast` em `main.cjs` quando a janela
 * principal emite eventos relevantes para captura remota.
 */
function publish(msg) {
  events.publish(msg);
}

function getUserData() {
  return userStore.read("user_data") || {};
}

module.exports = {
  start,
  stop,
  status,
  generateToken,
  resetToken,
  setMainWindow,
  publish,
  getUserData,
  setExternalRoutesEnabled,
  getExternalRoutesEnabled,
};
