/** @category helper-puro — Wrapper de BroadcastChannel + bus local in-window.
 * Para Vue, prefira useBroadcastListener/useBroadcastSender.
 *
 * Por que mantemos um fan-out local:
 *   `BroadcastChannel.postMessage()` NÃO entrega à própria janela. Como o
 *   ribbon e os módulos rodam na mesma janela do emissor, o fan-out local
 *   garante que listeners aqui vejam imediatamente o que acabou de ser
 *   despachado.
 *
 * Bridge para clients HTTP remotos (servidor embarcado em `/events`):
 *   - Em janelas Electron com `Platform.transmission` disponível, todo
 *     `send()` cujo tipo está em `STATEFUL_TYPES` é encaminhado ao main
 *     process via IPC. O main filtra para só aceitar da janela principal e
 *     redistribui via SSE.
 *   - No cliente HTTP remoto, o script injetado em `spa.js` recebe os
 *     eventos via `EventSource` e os enfileira em `window.__ljSseBuffer`
 *     (porque o bundle Vue ainda pode não ter terminado de carregar).
 *     Quando este módulo é importado, drena o buffer; daí em diante,
 *     entregamos via `CustomEvent("louvorja-sse")`.
 *
 * Cache de estado:
 *   Para os mesmos tipos relayáveis (estado de slide, versículo, módulo),
 *   guardamos o último payload recebido. Quando um listener registra via
 *   `listen()`, fazemos replay imediato. Sem isso, abrir `/musica?retorno`
 *   com música já tocando deixaria a tela em branco até a próxima troca
 *   de slide.
 */
import { BROADCAST_TYPE, BroadcastMessage } from "@/helpers/BroadcastTypes";
import Platform from "@/helpers/Platform";
import { readMusicPresentationPacket } from "@/presentation/MusicPresentationPacket";

const CHANNEL_NAME = "louvorja";

/**
 * Tipos que representam ESTADO contínuo e precisam de replay quando um
 * listener registra. O relay SSE usa o subconjunto `TRANSMISSION_TYPES`
 * abaixo; eventos transitórios in-app (hotkeys, ribbon actions, command
 * palette, requests) ficam fora de ambos.
 */
const STATEFUL_TYPES = new Set<string>([
  BROADCAST_TYPE.SLIDE_CHANGE,
  BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT,
  BROADCAST_TYPE.SLIDE_PROGRESS,
  BROADCAST_TYPE.SLIDES_DATA,
  BROADCAST_TYPE.MEDIA_CLOSE,
  BROADCAST_TYPE.BIBLE_VERSE,
  BROADCAST_TYPE.BIBLE_FORMAT_CHANGED,
  BROADCAST_TYPE.MODULE_PROJECTION_VALUE,
  BROADCAST_TYPE.MODULE_FORMAT_CHANGED,
  BROADCAST_TYPE.MESSAGE_BOARD,
  BROADCAST_TYPE.FILE_PROJECTION,
  BROADCAST_TYPE.ONLINE_VIDEO_PROJECTION,
  BROADCAST_TYPE.BACKGROUND_PROJECTION,
  BROADCAST_TYPE.ANNOUNCEMENTS_STATE,
  BROADCAST_TYPE.LIBRAS_TOGGLE,
]);

/**
 * Subconjunto que o servidor HTTP realmente relay-a para clientes SSE.
 *
 * Estado como progresso de slide, arquivo e wallpaper continua sendo
 * stateful para o BroadcastChannel local, mas não existe no contrato SSE
 * (`electron/main/httpServer/events.js`). Mantê-lo fora deste conjunto evita
 * um IPC por emissão apenas para o processo principal descartar a mensagem.
 */
const TRANSMISSION_TYPES = new Set<string>([
  BROADCAST_TYPE.SLIDE_CHANGE,
  BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT,
  BROADCAST_TYPE.SLIDES_DATA,
  BROADCAST_TYPE.MEDIA_CLOSE,
  BROADCAST_TYPE.BIBLE_VERSE,
  BROADCAST_TYPE.BIBLE_FORMAT_CHANGED,
  BROADCAST_TYPE.MODULE_PROJECTION_VALUE,
  BROADCAST_TYPE.MODULE_FORMAT_CHANGED,
  BROADCAST_TYPE.MESSAGE_BOARD,
]);

let channel: BroadcastChannel | null = null;
const _localListeners = new Set<(msg: BroadcastMessage) => void>();
const _lastByType = new Map<string, Map<string, BroadcastMessage>>();

export interface BroadcastListenOptions {
  /** Repassa o último estado conhecido ao registrar o listener. */
  replay?: boolean;
}

/** Synchronous enqueue status, not an acknowledgement that a remote frame painted. */
export interface BroadcastSendResult {
  crossWindow: boolean;
  remoteRelay: "sent" | "failed" | "unavailable" | "not_required";
}

function _cacheKey(msg: BroadcastMessage): string {
  return (msg.payload as Record<string, unknown> | undefined)?.module
    ? String((msg.payload as Record<string, unknown>).module)
    : "__default__";
}

function _deliverLocal(msg: BroadcastMessage): void {
  if (msg && typeof msg.type === "string") {
    // `media_close` invalida o estado de slide acumulado — listeners que
    // registrarem depois (ex: OBS recarregado em outra máquina) não devem
    // receber replay da música anterior. O evento em si é transitório.
    if (msg.type === "media_close") {
      _lastByType.delete("slide_change");
      _lastByType.delete(BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT);
      _lastByType.delete("slide_progress");
      _lastByType.delete("slides_data");
      _lastByType.delete("file_projection");
      _lastByType.delete("online_video_projection");
      _lastByType.delete("background_projection");
    } else if (msg.type === BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT) {
      const packet = readMusicPresentationPacket(msg.payload);
      if (packet) {
        // The canonical active song supersedes any cached editor slide.
        // Keep SLIDES_DATA: it remains the current song's auxiliary metadata.
        if (packet.snapshot.active) _lastByType.delete(BROADCAST_TYPE.SLIDE_CHANGE);
        const key = _cacheKey(msg);
        let inner = _lastByType.get(msg.type);
        if (!inner) {
          inner = new Map<string, BroadcastMessage>();
          _lastByType.set(msg.type, inner);
        }
        inner.set(key, msg);
      }
    } else if (msg.type === BROADCAST_TYPE.SLIDE_CHANGE &&
        (msg.payload as Record<string, unknown> | null)?.presentation_session === undefined &&
        (msg.payload as Record<string, unknown> | null)?.presentation_revision === undefined) {
      // An unversioned editor/other-source slide owns the stage now. A new
      // receiver must not replay the previous music deck alongside it.
      _lastByType.delete(BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT);
      _lastByType.delete(BROADCAST_TYPE.SLIDES_DATA);
      _lastByType.delete(BROADCAST_TYPE.SLIDE_PROGRESS);
      _lastByType.set(msg.type, new Map([["__default__", msg]]));
    } else if (STATEFUL_TYPES.has(msg.type)) {
      const key = _cacheKey(msg);
      let inner = _lastByType.get(msg.type);
      if (!inner) {
        inner = new Map<string, BroadcastMessage>();
        _lastByType.set(msg.type, inner);
      }
      inner.set(key, msg);
    }
  }
  for (const cb of _localListeners) {
    try {
      cb(msg);
    } catch {
      /* noop */
    }
  }
}

// Inicialização eager (top-level) — precisa rodar ANTES do primeiro
// `listen()`/`send()` para que mensagens entregues pelo bridge SSE durante
// o boot não sejam perdidas. Idempotente: módulos importados duas vezes
// não duplicam listeners.
function _initOnce(): void {
  if (typeof window === "undefined") return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  if (w.__ljBroadcastInit) return;
  w.__ljBroadcastInit = true;

  // Listener para mensagens SSE encaminhadas pelo bridge — estabelecido
  // antes de qualquer `dispatch`, não tem race.
  window.addEventListener("louvorja-sse", (e: Event) => {
    const detail = (e as CustomEvent).detail as BroadcastMessage | undefined;
    if (detail && typeof detail.type === "string") _deliverLocal(detail);
  });

  // Drena o buffer acumulado pelo bridge antes do bundle Vue carregar.
  // A partir daqui, o bridge passa a entregar via CustomEvent direto.
  const buf = (w.__ljSseBuffer as BroadcastMessage[] | undefined) || [];
  for (const msg of buf) _deliverLocal(msg);
  w.__ljSseBuffer = [];
  w.__ljSseDrained = true;
}

function getChannel(): BroadcastChannel {
  if (!channel) {
    const opened = new BroadcastChannel(CHANNEL_NAME);
    opened.addEventListener("message", (e: MessageEvent<BroadcastMessage>) => {
      // Mensagens vindas de OUTRAS janelas chegam aqui — repassa pros listeners locais.
      _deliverLocal(e.data);
    });
    channel = opened;
  }
  return channel;
}

_initOnce();

export default {
  send(type: string, payload: unknown = {}): BroadcastSendResult {
    const msg: BroadcastMessage = { type, payload } as BroadcastMessage;
    let crossWindow = false;
    try {
      getChannel().postMessage(msg);
      crossWindow = true;
    } catch {
      // Local delivery still works; a canonical producer must see the failed
      // cross-window enqueue so it can retry and emit one bounded incident.
    }
    // Entrega local — outras janelas Electron recebem via BroadcastChannel acima.
    _deliverLocal(msg);

    // Encaminhamento para clients SSE remotos. O main process filtra para
    // só aceitar da janela principal — nas janelas auxiliares isso vira
    // no-op silencioso e nada é duplicado.
    let remoteRelay: BroadcastSendResult["remoteRelay"] = "not_required";
    if (TRANSMISSION_TYPES.has(type)) {
      if (Platform.isDesktop) remoteRelay = "unavailable";
      const t = Platform.transmission;
      if (t && typeof t.broadcast === "function") {
        try {
          t.broadcast(msg);
          remoteRelay = "sent";
        } catch {
          remoteRelay = "failed";
        }
      }
    }
    return { crossWindow, remoteRelay };
  },

  listen(
    callback: (msg: BroadcastMessage) => void,
    options: BroadcastListenOptions = {}
  ): () => void {
    try { getChannel(); } catch { /* local-only until the next send retries */ }
    _localListeners.add(callback);

    // Replay do último estado conhecido — listeners que registram depois
    // do boot (ex: Obs.vue montado num browser que abriu com música já
    // tocando) precisam ver o estado atual sem esperar a próxima emissão.
    // O cache é aninhado (tipo → module_id → mensagem) para suportar
    // múltiplos módulos emitindo o mesmo tipo (ex: MODULE_PROJECTION_VALUE).
    if (options.replay !== false) {
      for (const inner of _lastByType.values()) {
        for (const msg of inner.values()) {
          try {
            callback(msg);
          } catch {
            /* noop */
          }
        }
      }
    }

    return () => {
      _localListeners.delete(callback);
    };
  },

  /**
   * Retorna o último payload de um tipo stateful recebido NESTA janela.
   * Se `module` for fornecido, busca o valor específico daquele módulo
   * (útil para tipos como MODULE_PROJECTION_VALUE compartilhados por
   * múltiplos módulos).
   */
  getLastPayload(type: string, module?: string): any | null {
    if (module) {
      return _lastByType.get(type)?.get(module)?.payload || null;
    }
    return _lastByType.get(type)?.get("__default__")?.payload || null;
  },
};
