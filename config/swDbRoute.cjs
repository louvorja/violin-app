/**
 * swDbRoute.cjs — Padrões das rotas do service worker para o banco e a mídia.
 *
 * `config` fica de fora: é o que diz se o catálogo mudou. Em StaleWhileRevalidate
 * ele devolvia a cópia anterior, e a tela de Atualizações só enxergava a versão
 * nova numa segunda verificação. Sem rota, a requisição segue direto para a rede.
 */

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function dbCachePattern(dbUrl) {
  return new RegExp(`^${escapeRegex(dbUrl)}/(?!config(?:[?#]|$))(?![^#]*[?&]fresh=1(?:[&#]|$))`);
}

// `https://*.dominio` segue a regra da CSP. Escapado como texto, o `*` só
// casaria um asterisco literal, e as imagens baixadas deixariam de abrir offline.
function originPattern(origin) {
  const base = origin.replace(/\/+$/, "");
  const wildcard = /^(https?:\/\/)\*\.(.+)$/i.exec(base);
  if (!wildcard) return escapeRegex(base);
  return `${escapeRegex(wildcard[1])}(?:[a-z0-9-]+\\.)+${escapeRegex(wildcard[2])}`;
}

/** Sem origens, casa pela extensão em qualquer host. */
function mediaCachePattern(origins, extensions) {
  const ext = `\\.(?:${extensions.join("|")})(?:\\?.*)?$`;
  const roots = origins.filter(Boolean).map(originPattern);
  return new RegExp(roots.length ? `^(?:${roots.join("|")})/.*${ext}` : ext, "i");
}

module.exports = { dbCachePattern, mediaCachePattern };
