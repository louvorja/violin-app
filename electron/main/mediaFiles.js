"use strict";

const fs = require("fs-extra");
const path = require("path");

// Estas são as únicas áreas descartáveis do acervo. Bibliotecas particulares,
// arquivos auxiliares e formatos desconhecidos não entram na limpeza automática.
const FORMATS = {
  musics: new Set([".mp3", ".opus", ".ogg", ".wav", ".m4a", ".flac"]),
  images: new Set([".jpg", ".jpeg", ".png", ".bmp", ".webp", ".gif"]),
  covers: new Set([".jpg", ".jpeg", ".png", ".bmp", ".webp", ".gif"]),
};

function managedRelative(relative) {
  if (typeof relative !== "string" || relative.includes("\\") || relative.includes("\0")) return null;
  const clean = relative.replace(/^\/+/, "");
  const parts = clean.split("/");
  if (parts.length < 2 || parts.some((part) => !part || part === "." || part === "..")) return null;
  return FORMATS[parts[0]]?.has(path.extname(clean).toLowerCase()) ? clean : null;
}

/** Confere cada componente: lstat no arquivo sozinho não protege pastas com links. */
async function regularFile(root, relative) {
  const clean = managedRelative(relative);
  if (!clean) return null;
  let abs = path.resolve(root);
  try {
    if (!(await fs.lstat(abs)).isDirectory()) return null;
    const parts = clean.split("/");
    for (let i = 0; i < parts.length; i++) {
      abs = path.join(abs, parts[i]);
      const stat = await fs.lstat(abs);
      if (i === parts.length - 1) return stat.isFile() ? { abs, relative: clean, size: stat.size, mtime: stat.mtimeMs } : null;
      if (!stat.isDirectory()) return null;
    }
  } catch (error) {
    if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error;
  }
  return null;
}

async function listManagedMedia(root) {
  const out = [];
  async function walk(abs, relative) {
    let entries;
    try {
      if (!(await fs.lstat(abs)).isDirectory()) return;
      entries = await fs.readdir(abs, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT" || error.code === "ENOTDIR") return;
      throw error;
    }
    for (const entry of entries) {
      const rel = `${relative}/${entry.name}`;
      if (entry.isDirectory()) await walk(path.join(abs, entry.name), rel);
      else if (entry.isFile()) {
        const file = await regularFile(root, rel);
        if (file) out.push(file);
      }
    }
  }
  // Não atravessa um link que substituiu a própria raiz configurada.
  try { if (!(await fs.lstat(root)).isDirectory()) return out; } catch (error) {
    if (error.code === "ENOENT") return out;
    throw error;
  }
  for (const name of Object.keys(FORMATS)) await walk(path.join(root, name), name);
  return out;
}

async function removeManagedFile(root, relative) {
  const file = await regularFile(root, relative);
  if (!file) return false;
  // unlink nunca remove recursivamente uma pasta que apareceu no lugar do arquivo.
  await fs.unlink(file.abs);
  return true;
}

module.exports = { managedRelative, regularFile, listManagedMedia, removeManagedFile };
