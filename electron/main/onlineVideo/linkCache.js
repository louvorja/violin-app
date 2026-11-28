"use strict";

/**
 * Links de vídeo resolvidos antes do play (`prefetch`): a prévia, o "a seguir"
 * e o próximo da fila. Cada entrada serve uma vez — o `stream` que a usa abre
 * a sessão dela. Também guarda o bloqueio "não é um robô": durante a pausa,
 * nada de consultas adiantadas, que só piorariam o bloqueio.
 */

/** Quantos vídeos com links prontos ficam à espera. */
const MAX_ENTRIES = 6;
/** Links que vencem antes disto são resolvidos de novo: o vídeo precisa tocar até o fim. */
const MARGIN_MS = 30 * 60 * 1000;
/** Depois de um bloqueio, as consultas adiantadas param por este tempo. */
const BLOCKED_PAUSE_MS = 10 * 60 * 1000;

/** @param {{ now: () => number }} deps */
function createLinkCache({ now }) {
  /** @type {Map<string, { links: any, maxHeight: number }>} */
  const entries = new Map();
  let blockedUntil = 0;

  const usable = (hit, maxHeight) =>
    hit.maxHeight === maxHeight && (!hit.links.expiresAt || hit.links.expiresAt - now() > MARGIN_MS);

  return {
    /** Os links prontos para tocar `maxHeight`, uma vez só; null se não há ou não servem. */
    take(id, maxHeight) {
      const hit = entries.get(id);
      if (!hit) return null;
      entries.delete(id);
      return usable(hit, maxHeight) ? hit.links : null;
    },
    has(id, maxHeight) {
      const hit = entries.get(id);
      return !!hit && usable(hit, maxHeight);
    },
    put(id, links, maxHeight) {
      entries.delete(id);
      entries.set(id, { links, maxHeight });
      while (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value);
    },
    delete: (id) => entries.delete(id),
    clear: () => entries.clear(),
    noteBlocked() {
      blockedUntil = now() + BLOCKED_PAUSE_MS;
      entries.clear();
    },
    blocked: () => now() < blockedUntil,
  };
}

module.exports = { createLinkCache, MAX_ENTRIES, MARGIN_MS, BLOCKED_PAUSE_MS };
