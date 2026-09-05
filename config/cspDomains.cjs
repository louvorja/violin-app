/**
 * cspDomains.cjs — Domínios base compartilhados para Content-Security-Policy.
 *
 * Fonte ÚNICA de verdade para domínios de terceiros.
 * Importado por:
 *   - electron/main/csp.js (runtime, CommonJS)
 *   - vite.config.js (build-time, ESM via createRequire)
 *   - config/cspDomains.mjs (renderer ESM wrapper)
 *
 * As URLs do VLibras também existem em src/config/Libras.ts (renderer).
 * Ao alterar URLs do VLibras, atualize AMBOS os arquivos.
 *
 * Para adicionar um novo domínio, altere APENAS este arquivo.
 */

const DOMAINS_SCR = {
  VLIBRAS: {
    URL: "https://vlibras.gov.br",
    DICT: "https://dicionario2.vlibras.gov.br",
    TRANSLATE: "https://traducao2.vlibras.gov.br",
    REPO: "https://repositorio.vlibras.gov.br",
  },
};

const DOMAINS = {
  API: [
    "https://api.louvorja.workers.dev",
    "https://api.louvorja.com.br"
  ],
  CDN: [
    "https://cdn.jsdelivr.net",
    "https://static.cloudflareinsights.com"
  ],
  FONTS: [
    "https://fonts.googleapis.com"
  ],
  YOUTUBE: [
    "https://www.youtube.com",
    "https://www.youtube-nocookie.com",
    "https://*.youtube.com",
    "https://*.googlevideo.com",
    "https://*.ytimg.com",
  ],
  GOOGLE: [
    "https://*.doubleclick.net",
    "https://www.google.com",
    "https://*.google.com",
    "https://*.googleapis.com",
    "https://fonts.gstatic.com",
    "https://www.gstatic.com",
  ],
  VLIBRAS: [
    DOMAINS_SCR.VLIBRAS.URL,
    DOMAINS_SCR.VLIBRAS.DICT,
    DOMAINS_SCR.VLIBRAS.TRANSLATE,
    DOMAINS_SCR.VLIBRAS.REPO,
  ],
};

const api = DOMAINS.API.join(" ");
const cdn = DOMAINS.CDN.join(" ");
const google = DOMAINS.GOOGLE.join(" ");
const youtube = DOMAINS.YOUTUBE.join(" ");
const vlibras = DOMAINS.VLIBRAS.join(" ");
const fonts = DOMAINS.FONTS.join(" ");
const thirdParty = `${youtube} ${google} ${vlibras} ${cdn}`;

const DOMAINS_CSP = {
  SCRIPT: `${cdn} ${google} ${youtube} ${vlibras}`,
  STYLE: `${fonts}`,
  FONT: `${DOMAINS.GOOGLE.filter((d) => d.includes("fonts.gstatic")).join(" ")} ${vlibras} ${cdn}`,
  IMG: `${youtube}`,
  MEDIA: `${youtube}`,
  CONNECT: `${api} ${thirdParty}`,
  WORKER: ``,
  FRAME: `${youtube} ${vlibras}`,
};

module.exports = { DOMAINS, DOMAINS_CSP, DOMAINS_SCR };
