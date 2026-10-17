"use strict";

/**
 * callbackServer.js — Onde o Canva devolve o código de autorização.
 *
 * Servidor HTTP minúsculo, só em `127.0.0.1`, que existe enquanto o usuário
 * está na tela de consentimento do Canva. A porta precisa ser FIXA e igual à
 * registrada em "Outside Canva → Redirect URLs" no portal — por isso 5530
 * (mesma faixa do FreeShow), e não uma porta efêmera.
 *
 * A página devolvida é estática e em PT: o navegador fica dois segundos numa
 * tela neutra e pode ser fechado à mão. Nenhum dado do app é servido por aqui.
 */

const http = require("http");

const HOST = "127.0.0.1";
const PORT = 5530;
const PATH = "/auth/canva";
const DEFAULT_TIMEOUT_MS = 120_000;

/** `function` é içada no load — dá para montar a const a partir dela. */
function redirectUri(port) {
  return `http://${HOST}:${port}${PATH}`;
}

/** A que vai no portal: porta fixa, porque é ela que o Canva devolve. */
const REDIRECT_URI = redirectUri(PORT);

let _server = null;
/*
 * O fluxo que está esperando o retorno. `stop()` precisa dele: fechar só o
 * socket deixaria a promise pendurada e o timer correndo, e a rejeição
 * chegaria minutos depois — como um `unhandled rejection` em cima de outro
 * teste ou de uma nova tentativa de conexão.
 */
let _abortPending = null;

function _page(titulo, texto) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<title>${titulo}</title></head>
<body style="font-family:system-ui,sans-serif;background:#111;color:#eee;display:flex;
align-items:center;justify-content:center;height:100vh;margin:0">
<div style="max-width:32rem;padding:2rem;text-align:center">
<h1 style="font-size:1.25rem;font-weight:600;margin:0 0 .75rem">${titulo}</h1>
<p style="line-height:1.5;margin:0;opacity:.8">${texto}</p>
</div></body></html>`;
}

/**
 * Sobe o servidor e resolve quando o Canva redirecionar de volta.
 *
 * - `ok` com `{ code, state }` quando o usuário autorizou;
 * - `EADDRINUSE` se a porta estiver ocupada;
 * - `timeout` após `timeoutMs`;
 * - rejeição quando o Canva devolve `error` ou um callback incompleto.
 *
 * `onListening(port)` roda DEPOIS do bind — é onde o chamador abre o navegador,
 * com o redirectUri exato da porta que ficou de pé (testes usam porta 0). O
 * redirect nunca pode chegar a um servidor que ainda não responde.
 *
 * O servidor é derrubado em TODOS os caminhos — uma porta presa depois de um
 * erro impediria a próxima tentativa de conectar.
 *
 * @param {{timeoutMs?: number, port?: number,
 *          onListening?: (port: number) => (Promise<void> | void)}} [opts]
 * @returns {Promise<{ok: true, code: string, state: string}>}
 */
function start(opts = {}) {
  const port = opts.port ?? PORT;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const onListening = opts.onListening;

  if (_server) {
    const busy = new Error("Já há um retorno do Canva em andamento.");
    busy.code = "EALREADY";
    return Promise.reject(busy);
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    /** Cancela o fluxo daqui de dentro — usado por `done` e por `stop`. */
    let abortar = null;

    /* Fecha em TODOS os caminhos: uma porta presa impediria a próxima tentativa. */
    const teardown = () => {
      clearTimeout(timer);
      try {
        /*
         * `close()` num servidor que nunca chegou a escutar emite `error`
         * (ERR_SERVER_NOT_RUNNING). O `once` de listen já consumiu o seu —
         * sem este mudo, o segundo erro seria não-tratado.
         */
        server.on("error", () => {});
        server.close();
        server.closeAllConnections?.();
      } catch (_) {
        /* já fechado */
      }
      if (_server === server) _server = null;
      if (_abortPending === abortar) _abortPending = null;
      abortar = null;
    };

    const done = (fn, arg) => {
      if (settled) return;
      settled = true;
      teardown();
      fn(arg);
    };

    abortar = (err) => done(reject, err);
    _abortPending = abortar;

    const timer = setTimeout(() => {
      const timeout = new Error("Tempo esgotado esperando o retorno do Canva.");
      timeout.code = "timeout";
      done(reject, timeout);
    }, timeoutMs);

    const server = http.createServer((req, res) => {
      let url;
      try {
        url = new URL(req.url || "/", `http://${HOST}:${port}`);
      } catch (_) {
        res.writeHead(400).end();
        return;
      }

      if (url.pathname !== PATH) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
        return;
      }

      const error = url.searchParams.get("error");
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");

      res
        .writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
        .end(
          error
            ? _page("Não foi possível conectar", "Feche esta aba e tente novamente no LouvorJA.")
            : _page("Canva conectado", "Pode fechar esta aba e voltar ao LouvorJA.")
        );

      if (error) {
        const detail = url.searchParams.get("error_description");
        const falha = new Error(detail ? `${error}: ${detail}` : String(error));
        falha.code = "authorization_denied";
        done(reject, falha);
        return;
      }
      if (!code || !state) {
        const incompleto = new Error("O retorno do Canva veio sem code/state.");
        incompleto.code = "malformed_callback";
        done(reject, incompleto);
        return;
      }
      done(resolve, { ok: true, code, state });
    });

    server.once("error", (err) => done(reject, err));
    /* Marcado ANTES do listen: dois `start()` seguidos não podem dividir a porta. */
    _server = server;
    server.listen(port, HOST, () => {
      const bound = (server.address() && server.address().port) || port;
      if (!onListening) return;
      Promise.resolve()
        .then(() => onListening(bound))
        .catch((err) => done(reject, err));
    });
  });
}

/**
 * Cancela o retorno em andamento e fecha o servidor.
 *
 * Além do socket, aborta a promise do `start()`: sem isso ela ficaria pendurada
 * até o timeout, e o timer dispararia em cima de quem já tinha seguido em frente.
 * Seguro de chamar de qualquer estado, inclusive sem fluxo aberto.
 */
function stop() {
  const pendente = _abortPending;
  _abortPending = null;
  const server = _server;
  _server = null;
  if (server) {
    try {
      server.on("error", () => {});
      server.close();
      server.closeAllConnections?.();
    } catch (_) {
      /* já fechado */
    }
  }
  if (!pendente) return;
  const cancelado = new Error("Retorno do Canva cancelado.");
  cancelado.code = "aborted";
  pendente(cancelado);
}

function busy() {
  return _server !== null;
}

module.exports = {
  start,
  stop,
  busy,
  redirectUri,
  HOST,
  PORT,
  PATH,
  REDIRECT_URI,
  DEFAULT_TIMEOUT_MS,
};
