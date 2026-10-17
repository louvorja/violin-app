/**
 * swDbRoute.cjs — Padrão da rota do service worker para os JSONs do banco.
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

module.exports = { escapeRegex, dbCachePattern };
