"use strict";
const path = require("path");

/**
 * Extensões intercambiáveis para o mesmo arquivo do acervo. A API serve
 * áudio em Opus e capas em JPEG, mas instalações antigas (e a versão
 * Delphi, via modo clássico) têm o mesmo conteúdo em MP3 e BMP no disco.
 */
const VARIANT_GROUPS = [
  [".opus", ".mp3"],
  [".jpg", ".jpeg", ".bmp"],
];

/**
 * Caminhos equivalentes a `filePath`, ele próprio à frente. Sem I/O — cabe
 * a quem chama testar existência no estilo (sync ou async) que já usa.
 *
 * @param {string} filePath
 * @returns {string[]}
 */
function variantsOf(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const group = VARIANT_GROUPS.find((g) => g.includes(ext));
  if (!group) return [filePath];

  const base = filePath.slice(0, -ext.length);
  return [filePath, ...group.filter((e) => e !== ext).map((e) => base + e)];
}

module.exports = { variantsOf, VARIANT_GROUPS };
