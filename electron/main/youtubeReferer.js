"use strict";

/**
 * O player embutido do YouTube só carrega quando a requisição traz um Referer
 * http(s) que identifique o cliente; sem ele o player responde com o erro 153.
 * A origem `louvorja://` não gera esse cabeçalho: o embed abre, avisa `ready` e
 * logo em seguida falha, mesmo com o vídeo liberado. Com a origem trocada por
 * `http://` o erro some, então o que falta é só o cabeçalho.
 */
const YOUTUBE_URLS = ["https://www.youtube.com/*", "https://www.youtube-nocookie.com/*"];
const FALLBACK_IDENTITY = "https://louvorja.com.br/";

function precisaDeReferer(referer) {
  return !/^https?:\/\//i.test(String(referer || ""));
}

function identidadeDe(homepage) {
  try {
    return new URL(homepage).origin + "/";
  } catch {
    return FALLBACK_IDENTITY;
  }
}

/**
 * @param {import("electron").Session} ses
 * @param {string} homepage  site do app, que passa a identificá-lo perante o YouTube
 */
function install(ses, homepage) {
  const identidade = identidadeDe(homepage);
  ses.webRequest.onBeforeSendHeaders({ urls: YOUTUBE_URLS }, (details, callback) => {
    const headers = details.requestHeaders;
    const chave = Object.keys(headers).find((k) => k.toLowerCase() === "referer");
    if (!chave || precisaDeReferer(headers[chave])) headers[chave || "Referer"] = identidade;
    callback({ requestHeaders: headers });
  });
}

module.exports = { install, precisaDeReferer, identidadeDe, YOUTUBE_URLS };
