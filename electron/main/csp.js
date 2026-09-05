"use strict";

/**
 * csp.js — Configuração central de Content-Security-Policy.
 *
 * Gera strings CSP para cada contexto:
 *   - "prod-desktop" → protocol.js (resposta HTTP header)
 *   - "dev-desktop"  → main.cjs (session.webRequest interceptor)
 *
 * Domínios de terceiros estão em config/cspDomains.cjs (fonte única).
 * As variações entre contextos são apenas: schemes, unsafe-inline/eval, localhost.
 */

const apiConfig = require("./apiConfig.js");
const { DOMAINS, DOMAINS_CSP } = require("../../config/cspDomains.cjs");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _apiOrigins() {
  const cfg = apiConfig.getConfig();
  return [cfg.apiUrl, cfg.apiUrlFallback]
    .join(" ");
}

function _connectApi() {
  const origins = _apiOrigins();
  const apis = DOMAINS.API.join(" ")
  return origins ? ` ${origins} ${apis}` : ` ${apis}`;
}

// ---------------------------------------------------------------------------
// Gerador de CSP
// ---------------------------------------------------------------------------

/**
 * Gera a string CSP para o contexto informado.
 *
 * @param {"prod-desktop" | "dev-desktop"} context
 * @returns {string} CSP completa pronta para header ou meta tag
 */
function buildCsp(context) {
  const isDev = context === "dev-desktop";
  const connectApi = _connectApi();

  const devLocalhost = isDev ? " http://localhost:* ws://localhost:*" : "";
  const devUnsafe = isDev ? " 'unsafe-inline' 'unsafe-eval'" : "";
  const desktopSchemes = !isDev ? " file: louvorja:" : "";

  const directives = [
    `default-src 'self'${desktopSchemes}${devLocalhost}`,

    `script-src 'self' blob:${desktopSchemes}${devUnsafe}${devLocalhost} ${DOMAINS_CSP.SCRIPT} 'wasm-unsafe-eval'`,

    `style-src 'self' 'unsafe-inline'${desktopSchemes}${devLocalhost} ${DOMAINS_CSP.STYLE}`,

    `font-src 'self' data:${desktopSchemes}${devLocalhost} ${DOMAINS_CSP.FONT}`,

    `img-src 'self' blob: data: https:${desktopSchemes}${devLocalhost} ${DOMAINS_CSP.IMG}`,

    `media-src 'self' blob: https:${desktopSchemes}${devLocalhost} ${DOMAINS_CSP.MEDIA}`,

    `connect-src 'self' blob:${desktopSchemes ? " louvorja:" : ""}${connectApi}${devLocalhost} ${DOMAINS_CSP.CONNECT}`,

    `frame-src ${DOMAINS_CSP.FRAME}`,

    `worker-src 'self'${isDev ? " blob:" : ` blob:${desktopSchemes}`}`,
  ];

  return directives.join("; ");
}

module.exports = { buildCsp };
