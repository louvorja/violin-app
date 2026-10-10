"use strict";

/**
 * fileBrowser.js — listagem de uma pasta para o navegador de arquivos do
 * Modo apresentação.
 *
 * Um nível só, com o que o operador precisa ver na grade: nome, tipo, tamanho
 * e data. O `storage:readDir` que já existe desce a árvore inteira e devolve
 * só caminhos — numa pasta de fotos de anos de culto, isso trava a grade.
 *
 * Arquivos ocultos ficam de fora (`.DS_Store`, `desktop.ini`, `Thumbs.db`):
 * não são conteúdo, só barulho na grade.
 */

const fs = require("fs-extra");
const path = require("path");

const HIDDEN = new Set(["desktop.ini", "thumbs.db"]);

function isHidden(name) {
  return name.startsWith(".") || HIDDEN.has(name.toLowerCase());
}

/**
 * @param {unknown} dirPath caminho absoluto da pasta
 * @returns {Promise<{ ok: true, entries: Array<{ name: string, path: string, isDir: boolean,
 *   ext: string, size: number, mtimeMs: number }> } | { ok: false, error: string }>}
 */
async function listDir(dirPath) {
  if (typeof dirPath !== "string" || !dirPath || !path.isAbsolute(dirPath)) {
    return { ok: false, error: "invalid_path" };
  }
  let dirents;
  try {
    dirents = await fs.readdir(dirPath, { withFileTypes: true });
  } catch (e) {
    return { ok: false, error: e && e.code === "ENOENT" ? "not_found" : "unreadable" };
  }

  const entries = [];
  for (const dirent of dirents) {
    if (isHidden(dirent.name)) continue;
    const full = path.join(dirPath, dirent.name);
    try {
      // stat segue links: um atalho para pasta aparece como pasta.
      const stat = await fs.stat(full);
      const isDir = stat.isDirectory();
      entries.push({
        name: dirent.name,
        path: full,
        isDir,
        ext: isDir ? "" : path.extname(dirent.name).slice(1).toLowerCase(),
        size: isDir ? 0 : stat.size,
        mtimeMs: stat.mtimeMs,
      });
    } catch {
      // Link quebrado ou arquivo sumindo enquanto lista: não é motivo para falhar a pasta.
    }
  }
  return { ok: true, entries };
}

module.exports = { listDir, isHidden };
