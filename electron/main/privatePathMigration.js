"use strict";

const fs = require("fs-extra");
const path = require("node:path");
const crypto = require("node:crypto");

// Mesmo contrato de referências de src/helpers/PrivateStorageMigration.ts.
// O restante do documento, incluindo textos e segredos cifrados, é preservado.
const PATH_KEYS = new Set(["path", "filePath", "localPath", "uri", "url", "src", "dir", "video_src", "imagePath", "thumbnailPath", "auto_folder", "audio", "image", "bg_image"]);

function absolute(value) {
  return typeof value === "string" && /^(?:\/|[a-z]:[\\/]|\\\\)/i.test(value)
    && !value.includes("\0") && !value.split(/[\\/]/).includes("..");
}

function validatedMappings(raw) {
  if (!Array.isArray(raw)) throw new Error("Mapeamento de arquivos pessoais inválido.");
  return raw.map((entry) => {
    if (!entry || !absolute(entry.from) || !absolute(entry.to)) throw new Error("Mapeamento de arquivos pessoais inválido.");
    const from = entry.from.replace(/\\/g, "/").replace(/\/+$/, "");
    const to = entry.to.replace(/\\/g, "/").replace(/\/+$/, "");
    if (!from || !to || /^[a-z]:$/i.test(from) || /^[a-z]:$/i.test(to)) throw new Error("Raiz de arquivos pessoais inválida.");
    return { from, to };
  }).sort((a, b) => b.from.length - a.from.length);
}

function replacePath(value, mappings) {
  const normalized = value.replace(/\\/g, "/");
  for (const { from, to } of mappings) {
    const windows = /^[a-z]:\//i.test(from) || from.startsWith("//");
    const source = windows ? from.toLowerCase() : from;
    const input = windows ? normalized.toLowerCase() : normalized;
    if (input !== source && !input.startsWith(`${source}/`)) continue;
    const suffix = normalized.slice(from.length);
    if (suffix.split("/").some((part) => part === ".." || part === ".")) return value;
    const result = `${to}${suffix}`;
    return value.includes("\\") && !value.includes("/") ? result.replace(/\//g, "\\") : result;
  }
  return value;
}

function replaceReference(value, mappings) {
  if (/^(?:file:|louvorja:\/\/local\/)/i.test(value)) {
    try {
      const url = new URL(value);
      if (url.protocol !== "file:" && (url.protocol !== "louvorja:" || url.hostname !== "local")) return value;
      let filePath = decodeURIComponent(url.pathname);
      if (/^\/[a-z]:\//i.test(filePath)) filePath = filePath.slice(1);
      if (url.protocol === "file:" && url.hostname && url.hostname !== "localhost") filePath = `//${url.hostname}${filePath}`;
      const next = replacePath(filePath, mappings).replace(/\\/g, "/");
      if (next === filePath) return value;
      const encoded = next.split("/").map((segment, index) => index === 0 && /^[a-z]:$/i.test(segment) ? segment : encodeURIComponent(segment)).join("/");
      const prefix = url.protocol === "file:" ? (encoded.startsWith("//") ? "file:" : encoded.startsWith("/") ? "file://" : "file:///") : encoded.startsWith("/") ? "louvorja://local" : "louvorja://local/";
      return `${prefix}${encoded}${url.search}${url.hash}`;
    } catch { return value; }
  }
  return absolute(value) ? replacePath(value, mappings) : value;
}

function rewrite(document, mappings) {
  let changed = false;
  function visit(value, key = "") {
    if (typeof value === "string") {
      const next = PATH_KEYS.has(key.split(".").at(-1)) ? replaceReference(value, mappings) : value;
      if (next !== value) changed = true;
      return next;
    }
    if (!value || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map((entry) => visit(entry, key));
    return Object.fromEntries(Object.entries(value).map(([name, entry]) => [name, visit(entry, name)]));
  }
  const value = visit(document);
  return changed ? value : document;
}

/** Opera apenas na cópia privada de staging; os destinos nos mapas são os caminhos finais. */
function rebaseJsonFiles(profileDir, rawMappings) {
  const mappings = validatedMappings(rawMappings);
  if (!mappings.length) return 0;
  let changed = 0;
  function walk(dir) {
    let stat;
    try { stat = fs.lstatSync(dir); }
    catch (error) { if (error.code === "ENOENT") return; throw error; }
    if (stat.isSymbolicLink()) throw new Error(`A pasta de dados pessoais contém um link: ${dir}`);
    if (!stat.isDirectory()) throw new Error(`A pasta de dados pessoais é inválida: ${dir}`);
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Os dados pessoais contêm um link: ${file}`);
      if (entry.isDirectory()) { walk(file); continue; }
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      // JSON inválido aborta a migração inteira antes de publicar o perfil.
      const original = fs.readJsonSync(file);
      const next = rewrite(original, mappings);
      if (next === original) continue;
      const temporary = `${file}.${crypto.randomUUID()}.tmp`;
      try {
        fs.writeJsonSync(temporary, next, { spaces: 2, mode: 0o600 });
        fs.renameSync(temporary, file);
      } finally { fs.removeSync(temporary); }
      changed++;
    }
  }
  walk(path.join(profileDir, "storage"));
  walk(path.join(profileDir, "library"));
  return changed;
}

module.exports = { rebaseJsonFiles };
