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

  function isActive() {
    return sources.size > 0;
  }

  function setSource(source, enabled) {
    if (typeof source !== "string" || !/^[a-z_]{1,40}$/.test(source)) {
      throw new TypeError("Fonte de apresentação inválida");
    }
    if (enabled === true) sources.add(source);
    else sources.delete(source);
    return isActive();
  }

  function snapshot() {
    return { active: isActive(), sources: [...sources].sort() };
  }

  return { isActive, setSource, snapshot };
}

module.exports = { createPresentationActivity };
