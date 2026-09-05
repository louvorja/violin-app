/**
 * Api.ts — Configuração central de URLs e tokens da API LouvorJA.
 *
 * Todas as URLs e tokens da API são derivados de um conjunto mínimo de
 * variáveis de ambiente. Qualquer arquivo no renderer que precise de uma
 * URL da API deve importar daqui em vez de ler `import.meta.env` diretamente.
 *
 * Variáveis de ambiente obrigatórias:
 *   VITE_URL_API          — URL base da API (ex: https://api.louvorja.workers.dev)
 *   VITE_API_TOKEN        — Token de autenticação
 *
 * Variáveis de ambiente opcionais:
 *   VITE_PATH_JSON_DB     — Path para JSONs do banco (padrão: /json_db)
 *   VITE_PATH_FILES       — Path para arquivos de mídia (padrão: /file)
 *   VITE_URL_API_FALLBACK — URL de fallback quando a API principal falha
 *   VITE_URL_API_FALLBACK_TOKEN — Token da API de fallback
 *   VITE_URL_DATABASE     — [DEPRECATED] URL completa do banco (fallback se VITE_URL_API não definido)
 *   VITE_URL_FILES        — [DEPRECATED] URL completa de arquivos (fallback se VITE_URL_API não definido)
 */

/** URL base da API principal (sem path final). */
export const API_URL: string =
  import.meta.env.VITE_URL_API ||
  _deriveApiUrl("VITE_URL_DATABASE") ||
  "";

/** Path para JSONs do banco de dados. */
const PATH_JSON_DB: string = import.meta.env.VITE_PATH_JSON_DB || "/json_db";

/** Path para arquivos de mídia. */
const PATH_FILES: string = import.meta.env.VITE_PATH_FILES || "/file";

/** URL completa para JSONs do banco (API_URL + PATH_JSON_DB). */
export const API_URL_DB: string = `${API_URL}${PATH_JSON_DB}`;

/** URL completa para arquivos de mídia (API_URL + PATH_FILES). */
export const API_URL_FILES: string = `${API_URL}${PATH_FILES}`;

/** Token de autenticação da API principal. */
export const API_TOKEN: string = import.meta.env.VITE_API_TOKEN || "";

/** URL base da API de fallback. */
export const API_URL_FALLBACK: string = import.meta.env.VITE_URL_API_FALLBACK || "";
export const API_URL_DB_FALLBACK: string = `${API_URL_FALLBACK}${PATH_JSON_DB}`;

/** Token da API de fallback. */
export const API_URL_FALLBACK_TOKEN: string =
  import.meta.env.VITE_URL_API_FALLBACK_TOKEN || API_TOKEN;

/**
 * Origem da API (URL base sem paths de endpoint).
 * Ex: "https://api.louvorja.workers.dev"
 * Usado por Database.ts para rotas REST como /pt/videos_online.
 */
export function apiOrigin(): string {
  return API_URL;
}

/**
 * Token apropriado para uma URL (fallback ou principal).
 */
export function getTokenForUrl(url: string): string {
  if (API_URL_FALLBACK && url.startsWith(API_URL_FALLBACK)) {
    return API_URL_FALLBACK_TOKEN;
  }
  return API_TOKEN;
}

// --- Helpers internos ---

/**
 * [DEPRECATED] Deriva URL de API de uma variável legada.
 * Extrai a origem removendo o path de json_db ou file.
 */
function _deriveApiUrl(legacyKey: string): string {
  const val = import.meta.env[legacyKey] as string | undefined;
  if (!val) return "";
  return val
    .replace(/\/json_db\/?$/, "")
    .replace(/\/file\/?$/, "")
    .replace(/\/$/, "");
}
