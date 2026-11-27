"use strict";

const os = require("node:os");

const MAX_PRE_SCRIPT_MS = 600_000;

/**
 * Marcos da abertura do processo principal, em ms desde a criação do processo.
 * O relógio da janela só começa na navegação: sem isto, a espera entre o clique
 * no ícone e a janela existir não aparece em medição nenhuma.
 */
function createBootTimeline({ processInfo = process, osInfo = os, now = Date.now } = {}) {
  const loadedAt = now();
  let createdAt = null;
  try {
    createdAt = processInfo.getCreationTime?.() ?? null;
  } catch {
    /* indisponível nesta plataforma: conta a partir do script */
  }
  // Relógio do sistema acertado durante a abertura dá um intervalo absurdo.
  const fromProcess =
    Number.isFinite(createdAt) &&
    createdAt > 0 &&
    createdAt <= loadedAt &&
    loadedAt - createdAt < MAX_PRE_SCRIPT_MS;
  const origin = fromProcess ? Math.round(createdAt) : loadedAt;
  const marks = {};
  const system = {};
  try {
    system.system_uptime_s = Math.round(osInfo.uptime());
    system.system_free_memory_mb = Math.round(osInfo.freemem() / 1_048_576);
  } catch {
    /* sem leitura do sistema: os marcos seguem valendo */
  }
  let delivered = false;

  return {
    /** Só a primeira ocorrência conta: recriar a janela não é abertura. */
    mark(name) {
      if (!(name in marks)) marks[name] = Math.max(0, Math.round(now() - origin));
    },
    /** Entregue uma vez: recarregar a janela não repete a medição da abertura. */
    take() {
      if (delivered) return null;
      delivered = true;
      return {
        origin,
        origin_source: fromProcess ? "process" : "script",
        marks: { ...marks },
        ...system,
      };
    },
  };
}

module.exports = Object.assign(createBootTimeline(), { createBootTimeline });
