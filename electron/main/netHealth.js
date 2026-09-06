"use strict";

/**
 * netHealth — o processo principal também sabe se a rede caiu, e sabe melhor
 * que o renderer: é ele quem busca o catálogo, a mídia e os arquivos, com
 * requisições que acontecem o tempo todo sem ninguém pedir.
 *
 * Máquina de estados pura, sem `electron` e sem I/O. Quem difunde é o main.cjs.
 */

/** Falhas seguidas antes de declarar que caiu. Uma só pode ser um arquivo grande. */
const FALHAS_PARA_OFFLINE = 2;

let _online = true;
let _falhas = 0;
let _desdeQuando = null;
const _ouvintes = new Set();

/**
 * Registra o desfecho de uma ida à rede.
 *
 * Qualquer resposta HTTP conta como online, inclusive 500: o servidor foi
 * alcançado, e o problema é dele, não do caminho até ele.
 *
 * @param {boolean} ok
 * @param {string} [source]  quem reportou, para diagnóstico
 * @returns {boolean} o estado depois do registro
 */
function report(ok, source = "main") {
  if (ok) {
    _falhas = 0;
    _definir(true, source);
    return _online;
  }
  _falhas += 1;
  if (_falhas >= FALHAS_PARA_OFFLINE) _definir(false, source);
  return _online;
}

function _definir(online, source) {
  if (_online === online) return;
  _online = online;
  _desdeQuando = online ? null : Date.now();
  console.info(`[netHealth] ${online ? "online" : "offline"} (via ${source})`);
  for (const fn of _ouvintes) {
    try {
      fn(status());
    } catch (_) {
      /* um ouvinte quebrado não derruba os outros */
    }
  }
}

/** @returns {{ online: boolean, since: number|null }} */
function status() {
  return { online: _online, since: _desdeQuando };
}

/** @param {(s: {online:boolean, since:number|null}) => void} fn */
function onChange(fn) {
  _ouvintes.add(fn);
  return () => _ouvintes.delete(fn);
}

/** Só para os testes: devolve o módulo ao estado inicial. */
function _reset() {
  _online = true;
  _falhas = 0;
  _desdeQuando = null;
  _ouvintes.clear();
}

module.exports = { report, status, onChange, FALHAS_PARA_OFFLINE, _reset };
