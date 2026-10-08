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
  // Destino da telemetria e dos bundles lazy (Replay, Logs e Error Tracking).
  // O SDK vem parcialmente no bundle, mas o recorder do Replay é carregado
  // em runtime. O wildcard acompanha os hosts de ingestão e de assets das
  // regiões US/EU, conforme a orientação do SDK.
  POSTHOG: [
    "https://*.posthog.com"
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
  // Fotos da tela Sobre. O endpoint de favicons do Google redireciona para
  // diferentes hosts t0–t3.gstatic.com conforme o site consultado.
  CONTRIBUTOR_IMAGES: [
    "https://avatars.githubusercontent.com",
    "https://www.google.com",
    "https://t0.gstatic.com",
    "https://t1.gstatic.com",
    "https://t2.gstatic.com",
    "https://t3.gstatic.com",
  ],
  // Miniaturas de designs do Canva (`thumbnail.url` documentado como
  // document-export.canva.com; o wildcard cobre hosts de assets que o Canva
  // pode trocar). Só IMG: as chamadas REST acontecem no main, então CONNECT
  // não ganha nada aqui.
  CANVA: ["https://document-export.canva.com", "https://*.canva.com"],
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
const posthog = DOMAINS.POSTHOG.join(" ");
const contributorImages = DOMAINS.CONTRIBUTOR_IMAGES.join(" ");
const canva = DOMAINS.CANVA.join(" ");
const thirdParty = `${youtube} ${google} ${vlibras} ${cdn} ${posthog}`;

const DOMAINS_CSP = {
  SCRIPT: `${cdn} ${google} ${youtube} ${vlibras} ${posthog}`,
  STYLE: `${fonts}`,
  FONT: `${DOMAINS.GOOGLE.filter((d) => d.includes("fonts.gstatic")).join(" ")} ${vlibras} ${cdn}`,
  // A API entra nos três: dela vêm as capas (`<img>`), o áudio das músicas
  // (`<audio>`) e os JSONs do banco (`fetch`). Faltando em IMG e MEDIA, o
  // navegador barrava a capa e o áudio enquanto o `fetch` da mesma origem
  // passava — o operador via "Ocorreu um erro ao carregar este áudio". Só o
  // desktop escapava, porque lá o CSP libera `https:` inteiro.
  IMG: `${api} ${youtube} ${contributorImages} ${canva}`,
  MEDIA: `${api} ${youtube}`,
  CONNECT: `${api} ${thirdParty}`,
  WORKER: `data:`,
  FRAME: `${youtube} ${vlibras}`,
};

module.exports = { DOMAINS, DOMAINS_CSP, DOMAINS_SCR };
