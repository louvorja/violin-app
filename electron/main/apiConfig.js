/**
 * apiConfig.js — Configuração central de URLs/tokens da API no main process.
 *
 * O main process NÃO tem acesso a `import.meta.env`. As variáveis são
 * recebidas do renderer via IPC `setRemoteConfig()` no boot, ou em dev
 * são carregadas do .env via process.env (o Vite injeta no node).
 *
 * Uso: require("./apiConfig").getConfig()
 */

let _config = {
  apiUrl: "",
  apiUrlDb: "",
  apiUrlFiles: "",
  apiToken: "",
  apiUrlFallback: "",
  apiUrlFallbackToken: "",
};

/**
 * Atualiza a configuração a partir dos valores do renderer.
 * Chamado pelo renderer via IPC no boot (main.js).
 *
 * @param {Object} cfg
 */
function setConfig(cfg) {
  if (cfg.apiUrl != null) _config.apiUrl = cfg.apiUrl;
  if (cfg.apiUrlDb != null) _config.apiUrlDb = cfg.apiUrlDb;
  if (cfg.apiUrlFiles != null) _config.apiUrlFiles = cfg.apiUrlFiles;
  if (cfg.apiToken != null) _config.apiToken = cfg.apiToken;
  if (cfg.apiUrlFallback != null) _config.apiUrlFallback = cfg.apiUrlFallback;
  if (cfg.apiUrlFallbackToken != null) _config.apiUrlFallbackToken = cfg.apiUrlFallbackToken;

  // Compat: aceitar chaves legadas
  if (cfg.databaseUrl) _config.apiUrlDb = cfg.databaseUrl;
  if (cfg.filesUrl) _config.apiUrlFiles = cfg.filesUrl;

  console.log("[apiConfig] Config atualizada:", {
    apiUrl: _config.apiUrl,
    apiUrlDb: _config.apiUrlDb,
    apiUrlFiles: _config.apiUrlFiles,
  });
}

/** Retorna uma cópia da configuração atual. */
function getConfig() {
  return { ..._config };
}

/**
 * Token apropriado para uma URL (fallback ou principal).
 */
function getTokenForUrl(url) {
  if (_config.apiUrlFallback && url.startsWith(_config.apiUrlFallback)) {
    return _config.apiUrlFallbackToken || _config.apiToken;
  }
  return _config.apiToken;
}

module.exports = { setConfig, getConfig };
