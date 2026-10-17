"use strict";

/**
 * Middleware que serve a SPA Vue pelo servidor HTTP embarcado.
 *
 * Em produção: serve `dist/` estaticamente; qualquer rota desconhecida cai
 *   no `index.html` (history fallback) com injeção de um <script> bridge SSE
 *   no <head>.
 * Em dev: faz proxy transparente para o Vite dev server (5002), exceto
 *   para `/api/*` e `/events`. O HTML retornado também recebe a injeção.
 *
 * Hash routing forçado:
 *   O build do desktop usa `base: "./"` (Vite) — funciona em `file://` mas
 *   quebra em rotas profundas servidas via HTTP (ex: `/obs/bible` faria o
 *   browser resolver `./assets/...` como `/obs/assets/...`). Para evitar
 *   reconstruir o bundle, o script injetado seta `window.LJ_HASH_ROUTING=true`
 *   e o router (src/router/index.js) cai em `createWebHashHistory`. Todas as
 *   rotas SPA viram fragments (`/#/obs`, `/#/projection/return`, ...) que
 *   sempre carregam de `/`.
 */

const path = require("path");
const fs = require("fs-extra");
const http = require("http");
const express = require("express");

const DEV_VITE_HOST = "localhost";
const DEV_VITE_PORT = 5002;

// Rotas servidas pela SPA — qualquer coisa fora daqui (/api, /events) é
// tratada por outros middlewares antes deste.
const SPA_ROUTES = new Set([
  "/obs",
  "/obs/bible",
  "/projection",
  "/projection/return",
  "/projection/bible",
  "/projection/bible/return",
  "/projection/module",
  "/projection/file",
  "/projection/file/return",
  "/clock",
  "/operator",
  "/remote",
]);

function _isLocalhost(ip) {
  return (
    ip === "127.0.0.1" ||
    ip === "::1" ||
    ip === "::ffff:127.0.0.1" ||
    ip === "localhost"
  );
}

/**
 * O HTML produzido pelo Vite no target desktop traz uma `<meta>` CSP
 * restritiva (script-src 'self' file: louvorja:) — apropriada para a janela
 * Electron carregada via `file://` ou `louvorja://`, mas bloqueia o script
 * inline que injetamos para o bridge SSE quando o mesmo bundle é servido
 * via HTTP. As janelas Electron continuam protegidas pelo CSP via header
 * (vide `main.cjs` → `session.webRequest.onHeadersReceived`); aqui
 * removemos a meta-tag só do HTML que vai pra clients remotos.
 */
function _stripCspMeta(html) {
  return html.replace(
    /<meta\s+http-equiv=["']Content-Security-Policy["'][^>]*>/gi,
    ""
  );
}

function _injectBridge(html, token, initialHash) {
  if (html.includes("window.LJ_SSE_BRIDGE_INJECTED")) return html;
  const cleaned = _stripCspMeta(html);
  const bridge = _bridgeScript(token, initialHash);
  const baseTag = '<base href="/">';
  const headContent = baseTag + bridge;
  if (cleaned.includes("<head>")) {
    return cleaned.replace("<head>", "<head>" + headContent);
  }
  return headContent + cleaned;
}

function _pathToHash(pathname) {
  const map = {
    "/obs": "/obs",
    "/obs/bible": "/obs/bible",
    "/relogio": "/clock",
    "/projecao": "/projection",
    "/remote": "/remote",
    "/projection/return": "/projection/return",
    "/projection/bible/return": "/projection/bible/return",
    "/projection": "/projection",
    "/projection/bible": "/projection/bible",
    "/projection/module": "/projection/module",
    "/projection/file": "/projection/file",
    "/projection/file/return": "/projection/file/return",
    "/clock": "/clock",
    "/operator": "/operator",
  };
  return map[pathname] || null;
}

function _isAllowedSpaPath(pathname) {
  return SPA_ROUTES.has(pathname);
}

function _initialRouteScript(initialHash) {
  const hashJson = JSON.stringify(initialHash || "");
  return `window.LJ_HASH_ROUTING=true;try{var hash=${hashJson};if(!window.location.hash&&hash){window.location.hash="#"+hash;}}catch(e){}`;
}

function _allowHttpRoot(getUserData) {
  try {
    const userData = typeof getUserData === "function" ? (getUserData() || {}) : {};
    return userData?.options?.dev?.allow_http_root === true;
  } catch {
    return false;
  }
}

/**
 * Script injetado no HTML retornado para clients HTTP. Roda ANTES da app
 * Vue carregar — assim o router já pega `LJ_HASH_ROUTING=true` no boot.
 */
function _bridgeScript(token, initialHash) {
  const tokenJson = JSON.stringify(token || "");
  const initialRouteScript = _initialRouteScript(initialHash);
  // Bridge cliente: abre EventSource, mantém um BUFFER de mensagens recebidas
  // antes do bundle Vue carregar (race condition real — o replay do último
  // estado vem assim que conectamos, e o usuário pode estar com música
  // tocando há horas). O Broadcast.ts drena esse buffer no module-load.
  return `<script>(function(){
  if (window.LJ_SSE_BRIDGE_INJECTED) return;
  window.LJ_SSE_BRIDGE_INJECTED = true;
  ${initialRouteScript}
  window.LJ_REMOTE_CLIENT = true;
  window.__ljSseBuffer = window.__ljSseBuffer || [];
  window.__ljSseDrained = false;
  var token = ${tokenJson};
  function tokenFromUrl() {
    try {
      var u = new URL(window.location.href);
      return u.searchParams.get('token') || '';
    } catch (e) { return ''; }
  }
  let url = '/events';
  const t = tokenFromUrl() || token;
  if (t) url += '?token=' + encodeURIComponent(t);
  function deliver(msg) {
    if (!msg || typeof msg.type !== 'string') return;
    if (window.__ljSseDrained) {
      try {
        window.dispatchEvent(new CustomEvent('louvorja-sse', { detail: msg }));
      } catch (_) { /* noop */ }
    } else {
      window.__ljSseBuffer.push(msg);
    }
  }
  // Reconexão: o EventSource só se refaz sozinho em erro de REDE. Em erro de
  // HTTP (401 depois de um token trocado, 403 de device sem permissão, 404 do
  // gate de rotas externas) a especificação manda falhar a conexão em
  // PERMANENTE — readyState CLOSED, sem nova tentativa. A página continuava
  // funcionando porque todo o resto do controle remoto é fetch avulso, mas a
  // aba Slides é push puro: sem music_presentation_snapshot não há sessão, e
  // sem sessão todo comando é descartado. Pior, nada disso aparecia em lugar
  // nenhum. Recriar a conexão é o que devolve a página.
  var attempt = 0;
  var retry = null;
  function markState(state) {
    try { window.__ljSSEState = state; } catch (_) { /* noop */ }
  }
  function scheduleReconnect() {
    const wait = Math.min(1000 * Math.pow(2, attempt), 15000);
    attempt++;
    if (retry) clearTimeout(retry);
    retry = setTimeout(function() { attach(); }, wait);
  }
  function attach() {
    let es;
    try {
      es = new EventSource(url);
    } catch (_) {
      scheduleReconnect();
      return;
    }
    markState('connecting');
    es.onopen = function() {
      attempt = 0;
      markState('open');
    };
    es.onmessage = function(e) {
      if (!e || !e.data) return;
      try { deliver(JSON.parse(e.data)); } catch (_) { /* noop */ }
    };
    es.onerror = function() {
      // O estado vem antes do close: depois de fechar, readyState já é CLOSED
      // e não distinguiríamos erro de rede de falha permanente.
      var state = es.readyState;
      markState(state === 2 ? 'closed' : 'connecting');
      try { es.close(); } catch (_) { /* noop */ }
      // CONNECTING (0) ou OPEN (1): a reconexão é do próprio EventSource.
      if (state === 2) scheduleReconnect();
    };
    window.__ljSSE = es;
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attach);
  } else {
    attach();
  }
})();</script>`;
}

/**
 * Cria o handler que entrega `index.html` a partir do dist/, com a injeção
 * do bridge SSE. Lê o HTML uma vez e cacheia (em prod o build não muda
 * durante runtime).
 */
function _createStaticIndexHandler(distDir, getToken) {
  let _cached = null;
  return (req, res) => {
    try {
      if (_cached === null) {
        _cached = fs.readFileSync(path.join(distDir, "index.html"), "utf8");
      }
      // Todo cliente HTTP precisa do SSE, inclusive OBS/navegador em localhost:
      // ele não compartilha o BroadcastChannel da origem louvorja://app usada
      // pelas janelas nativas. O bridge preserva o hash antes de iniciar o Vue.
      const initialHash = _pathToHash(req.path);
      const token = typeof getToken === "function" ? getToken() : null;
      const html = _injectBridge(_cached, token, initialHash);
      res.set("Content-Type", "text/html; charset=utf-8");
      res.set("Cache-Control", "no-cache");
      res.send(html);
    } catch (e) {
      res.status(500).send("SPA index missing: " + e.message);
    }
  };
}

/**
 * Proxy simples para o Vite dev server. Reescreve a resposta HTML para
 * injetar o bridge — outras respostas (JS/CSS/assets) passam intactas.
 */
function _createDevProxyHandler(getToken) {
  return (req, res) => {
    const opts = {
      hostname: DEV_VITE_HOST,
      port: DEV_VITE_PORT,
      path: req.originalUrl || req.url,
      method: req.method,
      headers: { ...req.headers, host: `${DEV_VITE_HOST}:${DEV_VITE_PORT}` },
    };
    const proxyReq = http.request(opts, (proxyRes) => {
      const ct = proxyRes.headers["content-type"] || "";
      const isHtml = ct.includes("text/html");
      const headers = { ...proxyRes.headers };
      // Reescrita do HTML quebra Content-Length original.
      if (isHtml) delete headers["content-length"];
      res.writeHead(proxyRes.statusCode || 502, headers);

      if (isHtml) {
        const chunks = [];
        proxyRes.on("data", (c) => chunks.push(c));
        proxyRes.on("end", () => {
          const html = Buffer.concat(chunks).toString("utf8");
          res.end(_injectBridge(html, typeof getToken === "function" ? getToken() : null, _pathToHash(req.path)));
        });
      } else {
        proxyRes.pipe(res);
      }
    });
    proxyReq.on("error", (e) => {
      res
        .status(502)
        .send(`Vite dev server indisponível em http://${DEV_VITE_HOST}:${DEV_VITE_PORT}: ${e.message}`);
    });
    if (req.readable) req.pipe(proxyReq);
    else proxyReq.end();
  };
}

/**
 * Aliases compatíveis com o servidor HTTP do Delphi.
 *
 * No Delphi, OBS e celular acessavam:
 *   /musica?transmissao  → página de captura de slide para OBS
 *   /musica?retorno      → stage display (atual + próximo)
 *   /biblia?transmissao  → captura de versículo para OBS
 *
 * Mantemos os mesmos paths para que tutoriais antigos continuem válidos.
 * Cada um redireciona para a rota Vue correspondente em hash form (porque
 * o bundle tem `base: "./"` e rotas profundas quebrariam asset paths).
 */
function _setupAliases(app) {
  app.get("/musica", (req, res) => {
    if (Object.prototype.hasOwnProperty.call(req.query, "transmissao")) {
      return res.redirect(302, "/obs" + _carryToken(req));
    }
    if (Object.prototype.hasOwnProperty.call(req.query, "retorno")) {
      return res.redirect(302, "/projection/return" + _carryToken(req));
    }
    return res
      .status(404)
      .send("Use /musica?transmissao (OBS) ou /musica?retorno.");
  });

  app.get("/relogio", (req, res) => {
    return res.redirect(302, "/clock" + _carryToken(req));
  });

  app.get("/projecao", (req, res) => {
    return res.redirect(302, "/projection" + _carryToken(req));
  });

  app.get("/biblia", (req, res) => {
    if (Object.prototype.hasOwnProperty.call(req.query, "transmissao")) {
      return res.redirect(302, "/obs/bible" + _carryToken(req));
    }
    if (Object.prototype.hasOwnProperty.call(req.query, "retorno")) {
      return res.redirect(302, "/projection/bible/return" + _carryToken(req));
    }
    return res
      .status(404)
      .send("Use /biblia?transmissao (OBS) ou /biblia?retorno.");
  });

  app.get("/controle", (req, res) => {
    return res.redirect(302, "/remote" + _carryToken(req));
  });
}

function _carryToken(req) {
  const t = req.query && req.query.token;
  return t ? "?token=" + encodeURIComponent(String(t)) : "";
}

/**
 * Monta o SPA estático (dist) no app Express.
 * @param {{ distDir: string, getToken: () => string|null, apenasRemotos?: boolean }} opts
 */
function _setupStaticSpa(app, { distDir, getToken, apenasRemotos = false }) {
  const deveServir = (req) => {
    if (!apenasRemotos) return true;
    const ip = req.ip || req.socket?.remoteAddress || "";
    return !_isLocalhost(ip);
  };

  app.use((req, res, next) => {
    if (!deveServir(req)) return next();
    return express.static(distDir, {
      index: false,
      setHeaders(res, file) {
        if (/\.[a-f0-9]{8,}\.(js|css|woff2?)$/i.test(file)) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        }
      },
    })(req, res, next);
  });

  const indexHandler = _createStaticIndexHandler(distDir, getToken);

  for (const route of SPA_ROUTES) {
    app.get(route, (req, res, next) => (deveServir(req) ? indexHandler(req, res) : next()));
  }

  app.use((req, res, next) => {
    if (!deveServir(req)) return next();
    if (req.method !== "GET") return next();
    if (req.path.startsWith("/api/") || req.path === "/events") return next();
    if (req.path === "/") {
      return indexHandler(req, res);
    }
    if (!_isAllowedSpaPath(req.path)) {
      return res.status(404).send("Rota não encontrada.");
    }
    return indexHandler(req, res);
  });
}

/**
 * Instala o middleware SPA no app Express.
 *
 * @param {import('express').Application} app
 * @param {{ isDev: boolean, distDir: string, getToken: () => string|null, getUserData?: () => Record<string, unknown>, serveDistToRemote?: boolean }} opts
 */
function install(app, { isDev, distDir, getToken, getUserData, serveDistToRemote = false }) {
  // Consulte o snapshot vivo antes do proxy ou do dist, em todos os modos.
  // Assim a opção vale na próxima requisição, sem reiniciar o servidor.
  app.use((req, res, next) => {
    if (req.path === "/" && !_allowHttpRoot(getUserData)) {
      return res.status(404).send("A rota raiz do servidor HTTP está desativada.");
    }
    return next();
  });
  _setupAliases(app);

  if (isDev) {
    const proxy = _createDevProxyHandler(getToken);
    if (serveDistToRemote) {
      if (fs.existsSync(path.join(distDir, "index.html"))) {
        _setupStaticSpa(app, { distDir, getToken, apenasRemotos: true });
        console.log("[httpServer] LJ_SERVE_DIST=1: clients remotos usam o dist; localhost segue no Vite.");
      } else {
        console.warn(`[httpServer] LJ_SERVE_DIST=1 ignorado: ${path.join(distDir, "index.html")} não existe (rode o build).`);
      }
    }
    // Tudo que não bater em /api ou /events vai pro proxy. As rotas SPA
    // são entregues como o index.html injetado, e os assets do Vite ficam
    // disponíveis em /src/, /node_modules/, /@vite/, /@id/ etc.
    // O proxy encaminha tudo ao Vite — não há necessidade de filtrar paths,
    // pois o Vite só serve recursos do app. Clients remotos precisam
    // acessar /@vite/client, /src/main.js, etc. para o Vue montar.
    app.use((req, res, next) => {
      if (req.path.startsWith("/api/") || req.path === "/events") return next();
      return proxy(req, res);
    });
    return;
  }

  // Produção: estáticos do dist + fallback para index.html.
  _setupStaticSpa(app, { distDir, getToken, apenasRemotos: false });
}

module.exports = { install, SPA_ROUTES };
