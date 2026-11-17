"use strict";

/**
 * Catálogo compartilhado de regras de música (`config/musicCatalog.mjs`).
 *
 * O caminho é resolvido **aqui** (relativo a `httpServer/`) para que os
 * consumidores não dependam da própria profundidade: `musicSearchCatalog.js`
 * fica em `httpServer/` e as rotas em `remoteRoutes/`, mas ambos aguardam a
 * mesma promessa. O renderer usa o alias `@root/config/musicCatalog.mjs`, que
 * não existe no processo main.
 */
const musicCatalogRules = import("../../../config/musicCatalog.mjs");

module.exports = { musicCatalogRules };
