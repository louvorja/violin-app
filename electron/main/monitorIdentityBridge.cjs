"use strict";

const { pathToFileURL } = require("node:url");
const path = require("node:path");

/**
 * monitorIdentityBridge.cjs — Ponte do main process (CommonJS) para os módulos
 * de monitor, que são ESM: o algoritmo de identidade e o mapa feature→papel.
 *
 * O algoritmo precisa ser ESM porque o renderer e o web/PWA o importam direto,
 * e o Vite não converte CommonJS de arquivos do projeto em desenvolvimento.
 * Manter cópias CommonJS separadas significaria duas versões divergindo em
 * silêncio — justamente no que decide em qual monitor a projeção aparece.
 * Então o main carrega os mesmos arquivos, uma vez, no boot.
 */

let _identity = null;
let _roles = null;

/** file:// absoluto — um especificador relativo falha ao resolver dentro do vm context dos testes. */
function _importLocal(filename) {
  return import(pathToFileURL(path.join(__dirname, filename)).href);
}

/** Carrega os módulos. Chamar uma vez, antes de abrir qualquer janela. */
async function init() {
  if (!_identity) _identity = await _importLocal("monitorIdentity.mjs");
  if (!_roles) _roles = await _importLocal("displayRoles.mjs");
  return { identity: _identity, roles: _roles };
}

function _require(mod, nome) {
  if (!mod) throw new Error(`[${nome}] Use init() antes de resolver monitores.`);
  return mod;
}

/** Algoritmo de identidade. Lança se `init()` ainda não rodou. */
function get() {
  return _require(_identity, "monitorIdentity");
}

/** Mapa feature→papel. Lança se `init()` ainda não rodou. */
function roles() {
  return _require(_roles, "displayRoles");
}

/** True quando já está pronto para uso. */
function isReady() {
  return _identity != null && _roles != null;
}

module.exports = { init, get, roles, isReady };
