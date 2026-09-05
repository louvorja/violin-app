/**
 * VLibras domains — renderer ESM source of truth.
 *
 * As URLs do VLibras também existem em config/cspDomains.cjs (CSP/Electron).
 * Ao alterar URLs do VLibras, atualize AMBOS os arquivos.
 */
export const VLIBRAS_URL = "https://vlibras.gov.br";
export const VLIBRAS_DICT = "https://dicionario2.vlibras.gov.br";
export const VLIBRAS_TRANSLATE = "https://traducao2.vlibras.gov.br";
export const VLIBRAS_REPO = "https://repositorio.vlibras.gov.br";

export const DOMAINS_SCR = {
  VLIBRAS: {
    URL: VLIBRAS_URL,
    DICT: VLIBRAS_DICT,
    TRANSLATE: VLIBRAS_TRANSLATE,
    REPO: VLIBRAS_REPO,
  },
} as const;
