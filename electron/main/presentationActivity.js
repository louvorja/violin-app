"use strict";

/**
 * Estado de apresentação para correlacionar incidentes de concorrência. Começa quando
 * uma janela de projeção é aberta, inclusive se o monitor some e a janela fica
 * temporariamente escondida. Visibilidade não é um sinal seguro de fim de culto.
 *
 * Fontes adicionais podem ser ligadas sem ensinar diagnósticos sobre BrowserWindow.
 * Este módulo não dispara I/O, timers nem telemetria por mudança.
 */
function createPresentationActivity() {
  const sources = new Set();
  const listeners = new Set();

  function isActive() {
    return sources.size > 0;
  }

  function setSource(source, enabled) {
    if (typeof source !== "string" || !/^[a-z_]{1,40}$/.test(source)) {
      throw new TypeError("Fonte de apresentação inválida");
    }
    const previous = isActive();
    if (enabled === true) sources.add(source);
    else sources.delete(source);
    const active = isActive();
    if (active !== previous) {
      for (const listener of listeners) {
        try { listener(active); } catch (_) { /* observers cannot break presentation state */ }
      }
    }
    return active;
  }

  function subscribe(listener) {
    if (typeof listener !== "function") throw new TypeError("Observer inválido");
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function snapshot() {
    return { active: isActive(), sources: [...sources].sort() };
  }

  return { isActive, setSource, snapshot, subscribe };
}

module.exports = { createPresentationActivity };
