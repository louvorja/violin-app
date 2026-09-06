"use strict";
const fs = require("fs-extra");
const path = require("path");
const paths = require("./paths.js");
const { candidatesFor, joinDentroDe, isSizeAcceptable } = require("./mediaRoots.js");

/**
 * mediaResolver — onde está, de fato, o arquivo que o banco pediu.
 *
 * Existe uma assimetria proposital aqui, e ela é a regra mais importante do
 * módulo: LER pode vir de qualquer origem, ESCREVER só na pasta de dados do
 * app. A pasta da versão clássica é acervo de outro programa, que muita gente
 * ainda usa em paralelo; gravar ou apagar lá destruiria o trabalho alheio, e
 * ainda por cima ela costuma ficar em Program Files, onde escrever exige
 * elevação e o Windows desvia em silêncio para o VirtualStore.
 */

/** @type {{dir: string, lang: string|null} | null} */
let _classic = null;

/**
 * @param {{dir: string, lang?: string|null}} raiz
 */
function setClassicRoot(raiz) {
  if (!raiz || !raiz.dir) {
    _classic = null;
    return;
  }
  _classic = { dir: path.resolve(raiz.dir), lang: raiz.lang || null };
}

function clearClassicRoot() {
  _classic = null;
}

/** @returns {{dir: string, lang: string|null} | null} */
function classicRoot() {
  return _classic ? { ..._classic } : null;
}

/**
 * As origens de leitura, da preferida para a última.
 * @returns {Array<{dir: string, layout: string, lang: string|null}>}
 */
function roots() {
  const lista = [{ dir: paths.filesDir(), layout: "modern", lang: null }];
  if (_classic) {
    lista.push({ dir: _classic.dir, layout: "classic", lang: _classic.lang });
  }
  return lista;
}

/**
 * O arquivo que atende `rel`, com a origem de onde veio.
 *
 * A origem não é enfeite: sem ela a interface diz "baixado" para o que está na
 * pasta do clássico e oferece um botão de remover que não remove nada.
 *
 * @param {string} rel  caminho relativo do banco
 * @returns {{path: string, origin: "own"|"classic"} | null}
 */
function resolveReadSync(rel) {
  for (const candidato of candidatesFor(rel, roots())) {
    try {
      const stat = fs.statSync(candidato.path);
      if (stat.isFile() && isSizeAcceptable(stat.size)) return candidato;
    } catch {
      /* não existe: próximo candidato */
    }
  }
  return null;
}

/**
 * @param {string} rel
 * @returns {Promise<{path: string, origin: "own"|"classic"} | null>}
 */
async function resolveRead(rel) {
  for (const candidato of candidatesFor(rel, roots())) {
    try {
      const stat = await fs.stat(candidato.path);
      if (stat.isFile() && isSizeAcceptable(stat.size)) return candidato;
    } catch {
      /* não existe: próximo candidato */
    }
  }
  return null;
}

/**
 * Onde gravar `rel`. Sempre dentro da pasta de dados do app, nunca numa origem
 * extra — ver a nota no topo do arquivo.
 *
 * @param {string} rel
 * @returns {string|null} null quando o caminho escaparia da pasta de dados
 */
function resolveWrite(rel) {
  return joinDentroDe(paths.filesDir(), rel);
}

module.exports = {
  setClassicRoot,
  clearClassicRoot,
  classicRoot,
  roots,
  resolveRead,
  resolveReadSync,
  resolveWrite,
};
