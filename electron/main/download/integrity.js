"use strict";
const paths = require("../paths.js");
const { isSizeAcceptable } = require("../mediaRoots.js");
const resolver = require("../mediaResolver.js");

/**
 * Verifica se um arquivo local existe e serve. Procura em todas as origens de
 * leitura — a pasta de dados e, quando configurada, o acervo da versão clássica
 * — aceitando variantes de extensão (.mp3 vale por .opus, .bmp por .jpg), para
 * não rebaixar o que já está no disco em outro formato ou em outra pasta.
 *
 * @param {string} localPath  Caminho relativo ao acervo (absoluto é aceito por
 *   compatibilidade e tratado como já resolvido)
 * @param {number} expectedSize  Tamanho em bytes (0 = catálogo não informa)
 * @returns {{ exists:boolean, sizeOk:boolean, actualSize:number, origin:string|null }}
 */
function checkFile(localPath, expectedSize = 0) {
  const rel = _paraRelativo(localPath);
  const achado = resolver.resolveReadSync(rel);
  if (!achado) return { exists: false, sizeOk: false, actualSize: 0, origin: null };

  const actualSize = require("fs-extra").statSync(achado.path).size;
  return {
    exists: true,
    sizeOk: isSizeAcceptable(actualSize, expectedSize),
    actualSize,
    origin: achado.origin,
  };
}

/** O acervo é endereçado por caminho relativo; absolutos vêm de chamadas antigas. */
function _paraRelativo(localPath) {
  const path = require("path");
  if (!path.isAbsolute(localPath)) return localPath;
  const filesDir = paths.filesDir();
  return localPath.startsWith(filesDir + path.sep)
    ? localPath.slice(filesDir.length + 1)
    : localPath;
}

/**
 * Recebe lista de arquivos com tamanhos esperados, retorna os que precisam ser baixados.
 * @param {Array<{ remote:string, local:string, expectedSize:number }>} files
 * @returns {{ missing: Array, damaged: Array, ok: Array }}
 */
function diff(files) {
  const missing = [];
  const damaged = [];
  const ok = [];

  files.forEach((file) => {
    const check = checkFile(file.local, file.expectedSize || 0);
    if (!check.exists) {
      missing.push(file);
    } else if (!check.sizeOk) {
      damaged.push({ ...file, actualSize: check.actualSize });
    } else {
      ok.push(file);
    }
  });

  return { missing, damaged, ok };
}

module.exports = { checkFile, diff };
