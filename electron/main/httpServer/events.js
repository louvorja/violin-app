"use strict";

/**
 * Bridge SSE para clients de transmissão (OBS, celular, navegador remoto).
 *
 * Por que SSE e não BroadcastChannel:
 *  BroadcastChannel("louvorja") cruza BrowserWindows do Electron, mas NÃO
 *  cruza origens HTTP nem máquinas. Quando OBS Browser Source ou um
 *  smartphone abre `http://192.168.x.x:7070/musica?transmissao`, eles
 *  estão num browser totalmente isolado do app desktop. Precisam receber
 *  o estado por outro caminho.
 *
 * Modelo:
 *  1. Renderer principal emite `slide_change` no BroadcastChannel.
 *  2. `Broadcast.ts` (renderer) faz `transmission.broadcast(msg)` via IPC.
 *  3. `main.cjs` chama `events.publish(msg)` aqui.
 *  4. Este módulo:
 *     - guarda o último estado de cada tipo (replay no connect)
 *     - traduz URLs `louvorja://` → HTTPS (clients remotos não conhecem o
 *       protocolo customizado)
 *     - faz fan-out para todos os Response SSE conectados
 *  5. O cliente remoto roda um pequeno script (injetado em `spa.js`) que
 *     abre `EventSource("/events?token=...")` e re-emite cada msg via
 *     CustomEvent("louvorja-sse"). `Broadcast.ts` ouve esse evento e o
 *     entrega aos listeners locais — exatamente como se viesse do BC.
 *
 * Filtro de tipos: só relayamos eventos relevantes para projeção/captura
 * (slide, bíblia, projeção genérica de módulo). Eventos in-app (hotkeys,
 * ribbon actions, command palette) ficam fora.
 */

const REMOTE_RELAY_TYPES = new Set([
  "slide_change",
  "slides_data",
  "media_close",
  "bible_verse",
  "bible_format_changed",
  "module_projection_value",
  "module_format_changed",
  "message_board",
  "chat_message",
]);

const MAX_CLIENT_QUEUE = 32;
const MAX_CACHED_STATES = 64;
const MODULE_STATE_TYPES = new Set(["module_projection_value", "module_format_changed"]);

function stateKey(msg) {
  const moduleId = msg.payload?.module;
  if (
    MODULE_STATE_TYPES.has(msg.type) &&
    typeof moduleId === "string" &&
    /^[a-zA-Z0-9_-]{1,64}$/.test(moduleId)
  ) {
    return `${msg.type}:${moduleId}`;
  }
  return msg.type;
}

// Estados contínuos podem usar "latest value wins" enquanto um socket está
// sob backpressure. `media_close` é uma barreira terminal e `chat_message`
// representa mensagens distintas, portanto não entram nessa coalescência.
const COALESCIBLE_TYPES = new Set(
  [...REMOTE_RELAY_TYPES].filter((type) => type !== "media_close" && type !== "chat_message")
);
const TERMINAL_TYPES = new Set(["media_close"]);

/**
 * @typedef {{ type: string, key: string, data: string, terminal: boolean, coalescible: boolean }} PendingEvent
 * @typedef {{
 *   res: import('http').ServerResponse,
 *   id: number,
 *   blocked: boolean,
 *   closed: boolean,
 *   queue: PendingEvent[],
 *   cleanup?: () => void,
 * }} SseClient
 */

/** @type {Set<SseClient>} */
const _clients = new Set();

/** Último estado por tipo e, nos eventos multiplexados, por módulo. */
const _lastByType = new Map();

let _nextId = 1;

let _getRemoteConfig = () => ({ filesUrl: "", databaseUrl: "" });

/**
 * Configura provedor de URLs remotas. Chamado uma vez ao iniciar o servidor.
 * @param {() => { filesUrl?: string, databaseUrl?: string }} fn
 */
function setRemoteConfigProvider(fn) {
  if (typeof fn === "function") _getRemoteConfig = fn;
}

/**
 * Reescreve URLs `louvorja://` em qualquer string para HTTPS público.
 * Mantém o resto do payload intacto.
 */
function _rewriteCustomProtocol(value) {
  if (value == null) return value;

  if (typeof value === "string") {
    if (value.indexOf("louvorja://") === -1) return value;
    const cfg = _getRemoteConfig() || {};
    return value
      .replace(/louvorja:\/\/files(\/?)/g, (cfg.filesUrl || "") + "$1")
      .replace(/louvorja:\/\/json_db(\/?)/g, (cfg.databaseUrl || "") + "$1")
      // Outros hosts customizados — degrade para o filesUrl.
      .replace(/louvorja:\/\/[^/]+/g, cfg.filesUrl || "");
  }

  if (Array.isArray(value)) {
    return value.map(_rewriteCustomProtocol);
  }

  if (typeof value === "object") {
    const out = {};
    for (const k of Object.keys(value)) {
      out[k] = _rewriteCustomProtocol(value[k]);
    }
    return out;
  }

  return value;
}

/**
 * Handler do endpoint GET /events. Mantém a conexão aberta e empurra
 * mensagens conforme `publish()` for chamado.
 */
function handler(req, res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  const id = _nextId++;
  /** @type {SseClient} */
  const client = { res, id, blocked: false, closed: false, queue: [] };
  _clients.add(client);

  let ka = null;
  const onDrain = () => _flushClient(client);

  const cleanup = () => {
    if (client.closed) return;
    client.closed = true;
    if (ka) clearInterval(ka);
    ka = null;
    client.queue.length = 0;
    _clients.delete(client);
    try { res.off?.("drain", onDrain); } catch { /* noop */ }
    try { res.off?.("close", cleanup); } catch { /* noop */ }
    try { res.off?.("error", cleanup); } catch { /* noop */ }
    try { req.off?.("close", cleanup); } catch { /* noop */ }
    try { req.off?.("error", cleanup); } catch { /* noop */ }
    try { res.end(); } catch { /* noop */ }
  };
  client.cleanup = cleanup;

  res.on?.("drain", onDrain);
  res.on?.("close", cleanup);
  res.on?.("error", cleanup);
  req.on("close", cleanup);
  req.on("error", cleanup);

  // Comentário inicial força o navegador a entregar os headers + abrir o stream.
  if (!_writeRaw(client, ":ok\n\n")) return;

  // Replay do último estado conhecido para que clients que conectarem
  // depois do início da música/versículo já apareçam com o conteúdo certo.
  for (const { type, payload } of _lastByType.values()) {
    _writeEvent(client, { type, payload: _rewriteCustomProtocol(payload) });
  }
  if (client.closed) return;

  // Keepalive — alguns proxies derrubam conexões inativas em 30-60s.
  ka = setInterval(() => {
    // Não aumente a fila de um socket que já sinalizou backpressure; os dados
    // pendentes e o próprio buffer TCP mantêm a conexão ocupada.
    if (!client.blocked && client.queue.length === 0) {
      _writeRaw(client, ":keepalive\n\n");
    }
  }, 25000);
  ka.unref?.();
}

function _writeRaw(client, data) {
  if (client.closed) return false;
  try {
    if (client.res.write(data) === false) client.blocked = true;
    return true;
  } catch {
    client.cleanup?.();
    return false;
  }
}

function _flushClient(client) {
  if (client.closed) return;
  client.blocked = false;
  while (!client.blocked && client.queue.length > 0) {
    // `write() === false` ainda aceita este chunk; só os seguintes aguardam
    // `drain`, portanto removemos antes de escrever para não duplicá-lo.
    const event = client.queue.shift();
    if (!_writeRaw(client, event.data)) return;
  }
}

function _makeRoom(client, incoming) {
  while (client.queue.length >= MAX_CLIENT_QUEUE) {
    // Estados intermediários e chat antigo cedem lugar primeiro. Barreiras
    // terminais permanecem na fila até serem aceitas pelo socket.
    const disposable = client.queue.findIndex(
      (event) => !event.terminal && !event.coalescible
    );
    const removable = disposable >= 0
      ? disposable
      : client.queue.findIndex((event) => !event.terminal);
    if (removable >= 0) {
      client.queue.splice(removable, 1);
      continue;
    }

    // Hoje há uma única barreira (`media_close`). Repetições são idempotentes:
    // preservar a mais nova mantém o estado final sem crescimento ilimitado.
    if (incoming.terminal) {
      const duplicate = client.queue.findIndex((event) => event.type === incoming.type);
      if (duplicate >= 0) {
        client.queue.splice(duplicate, 1);
        continue;
      }
    }
    return false;
  }
  return true;
}

function _enqueueEvent(client, event) {
  if (client.closed) return;

  if (event.type === "media_close") {
    // Um close pendente torna snapshots antigos de música obsoletos. Se uma
    // nova música chegar depois, ela será enfileirada depois da barreira.
    client.queue = client.queue.filter(
      (pending) => pending.type !== "slide_change" && pending.type !== "slides_data"
    );
  }

  if (event.coalescible || event.terminal) {
    const previous = client.queue.findIndex((pending) => pending.key === event.key);
    if (previous >= 0) client.queue.splice(previous, 1);
  }

  if (!_makeRoom(client, event)) return;
  client.queue.push(event);
}

function _writeEvent(client, msg) {
  let data;
  try {
    data = "data: " + JSON.stringify(msg) + "\n\n";
  } catch {
    return;
  }

  const event = {
    type: msg.type,
    key: stateKey(msg),
    data,
    terminal: TERMINAL_TYPES.has(msg.type),
    coalescible: COALESCIBLE_TYPES.has(msg.type),
  };

  if (!client.blocked && client.queue.length === 0) {
    _writeRaw(client, data);
    return;
  }

  _enqueueEvent(client, event);
  if (!client.blocked) _flushClient(client);
}

/**
 * Publica uma mensagem para todos os clients SSE conectados.
 * No-op se o tipo não é relayável ou se não há clients.
 *
 * @param {{ type: string, payload: unknown }} msg
 */
function publish(msg) {
  if (!msg || typeof msg.type !== "string") return;
  if (!REMOTE_RELAY_TYPES.has(msg.type)) return;

  // `media_close` invalida o estado de slide/letra — qualquer client que
  // conectar DEPOIS do close não deve receber replay da música anterior.
  // Limpamos o cache antes de propagar; o evento em si é transitório e
  // por isso não fica em `_lastByType`.
  if (msg.type === "media_close") {
    _lastByType.delete("slide_change");
    _lastByType.delete("slides_data");
  } else {
    const key = stateKey(msg);
    _lastByType.delete(key);
    _lastByType.set(key, { type: msg.type, payload: msg.payload });
    while (_lastByType.size > MAX_CACHED_STATES) {
      _lastByType.delete(_lastByType.keys().next().value);
    }
  }

  if (_clients.size === 0) return;

  const out = { type: msg.type, payload: _rewriteCustomProtocol(msg.payload) };
  for (const c of _clients) _writeEvent(c, out);
}

/** Fecha todas as conexões SSE. Chamado quando o servidor para. */
function closeAll() {
  for (const c of [..._clients]) c.cleanup?.();
  _lastByType.clear();
}

function status() {
  let queued = 0;
  let blocked = 0;
  for (const client of _clients) {
    queued += client.queue.length;
    if (client.blocked) blocked++;
  }
  return {
    clients: _clients.size,
    lastTypes: [...new Set([..._lastByType.values()].map((event) => event.type))],
    queued,
    blocked,
  };
}

module.exports = {
  handler,
  publish,
  closeAll,
  status,
  setRemoteConfigProvider,
  REMOTE_RELAY_TYPES,
  MAX_CLIENT_QUEUE,
};
