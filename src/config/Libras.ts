import { VLIBRAS_TRANSLATE, VLIBRAS_DICT } from "./Vlibras";

// ─── Configuração ───────────────────────────────────────────────────────────
export const TRANSLATE_URL = VLIBRAS_TRANSLATE;
export const DICTIONARY_BASE_URL = VLIBRAS_DICT + "/2018.3.1/WEBGL";
/** URL final para bundles (pula redirect 301 do servidor). */
export const BUNDLE_URL = DICTIONARY_BASE_URL + "/static/BUNDLES/2018.3.1/WEBGL";
export const REQUEST_TIMEOUT = 15_000;
export const BUNDLE_RETRY_MAX = 5;
