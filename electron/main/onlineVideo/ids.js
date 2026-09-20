"use strict";

/**
 * O renderer só entrega ao main o ID do vídeo, nunca uma URL: a URL é montada
 * aqui. Um ID de 11 caracteres de [A-Za-z0-9_-] não carrega opção de linha de
 * comando (não começa com "-" sozinho por causa do tamanho fixo e do prefixo da
 * URL), nem separador de caminho, e é também o nome do arquivo em disco.
 */
const ID_RE = /^[A-Za-z0-9_-]{11}$/;

function isVideoId(value) {
  return typeof value === "string" && ID_RE.test(value);
}

function watchUrl(id) {
  if (!isVideoId(id)) throw new Error("ID de vídeo inválido");
  return `https://www.youtube.com/watch?v=${id}`;
}

module.exports = { isVideoId, watchUrl };
