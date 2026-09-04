"use strict";

/**
 * monitorIdentityBridge.cjs — Ponte do main process (CommonJS) para o
 * algoritmo de identidade, que é ESM.
 *
 * O algoritmo precisa ser ESM porque o renderer e o web/PWA o importam direto,
 * e o Vite não converte CommonJS de arquivos do projeto em desenvolvimento.
 * Manter uma cópia CommonJS separada significaria dois algoritmos divergindo
 * em silêncio — justamente no cálculo que decide em qual monitor a projeção
 * aparece. Então o main carrega o mesmo arquivo, uma vez, no boot.
 */

let _module = null;

/** Carrega o algoritmo. Chamar uma vez, antes de abrir qualquer janela. */
async function init() {
  if (_module) return _module;
  _module = await import("./monitorIdentity.mjs");
  return _module;
}

/** Módulo carregado. Lança se `init()` ainda não rodou. */
function get() {
  if (!_module) {
    throw new Error("[monitorIdentity] Use init() antes de resolver monitores.");
  }
  return _module;
}

/** True quando já está pronto para uso. */
function isReady() {
  return _module != null;
}

module.exports = { init, get, isReady };
