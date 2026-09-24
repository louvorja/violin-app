"use strict";

const fs = require("fs");

const MAX_CATALOGS = 2;

function signature(stat) {
  return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * O catálogo é substituído por rename atômico no jsonCache. Um stat por busca
 * invalida imediatamente a cópia em memória após atualização, limpeza ou troca
 * da pasta de dados; a chave inclui o path para não misturar instalações.
 */
function createMusicSearchCatalog() {
  const cached = new Map();
  const inflight = new Map();

  async function load(filePath, retries = 0) {
    let stat;
    try {
      stat = await fs.promises.stat(filePath);
    } catch (error) {
      cached.delete(filePath);
      throw error;
    }
    const version = signature(stat);
    const hit = cached.get(filePath);
    if (hit?.version === version) {
      cached.delete(filePath);
      cached.set(filePath, hit);
      return hit.rows;
    }

    const key = `${filePath}:${version}`;
    if (inflight.has(key)) return inflight.get(key);
    const pending = (async () => {
      const raw = await fs.promises.readFile(filePath, "utf8");
      const after = await fs.promises.stat(filePath);
      if (signature(after) !== version) {
        if (retries >= 2) throw new Error("Catálogo de músicas mudou durante a leitura");
        return load(filePath, retries + 1);
      }
      const all = JSON.parse(raw);
      if (!Array.isArray(all)) throw new TypeError("Catálogo de músicas inválido");
      const rows = all.map((music) => ({
        music,
        name: normalize(music?.name),
        albums: normalize(music?.albums_names),
      }));
      cached.delete(filePath);
      cached.set(filePath, { version, rows });
      while (cached.size > MAX_CATALOGS) cached.delete(cached.keys().next().value);
      return rows;
    })();
    inflight.set(key, pending);
    try {
      return await pending;
    } finally {
      if (inflight.get(key) === pending) inflight.delete(key);
    }
  }

  async function search(filePath, query) {
    const rows = await load(filePath);
    return rows
      .filter(({ name, albums }) => name.includes(query) || albums.includes(query))
      .slice(0, 20)
      .map(({ music }) => music);
  }

  return { search };
}

module.exports = { createMusicSearchCatalog, normalize };
