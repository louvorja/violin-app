"use strict";

/**
 * fontFiles — lê o nome de dentro de arquivos de fonte (.ttf/.otf).
 *
 * O nome do arquivo não diz nada ("Montserrat-Black.ttf" pode registrar a
 * família "Montserrat Black" ou "Montserrat" com estilo "Black"). O que o
 * PowerPoint e o LibreOffice procuram é o nome interno, então é ele que conta.
 */
const fs = require("fs/promises");
const fss = require("fs");
const path = require("path");
const { norm } = require("./fontNames.js");

function _pickName(n) {
  if (!n) return "";
  if (typeof n === "string") return n;
  return n.en || Object.values(n)[0] || "";
}

/**
 * @param {string} filePath
 * @returns {Promise<{family: string, full: string, typo: string, registryName: string, keys: string[]}>}
 */
async function readFontNames(filePath) {
  const base = path.basename(filePath, path.extname(filePath));
  try {
    const opentype = require("opentype.js");
    const buf = await fs.readFile(filePath);
    const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    const names = font.names || {};
    const family = _pickName(names.fontFamily);
    const full = _pickName(names.fullName) || `${family} ${_pickName(names.fontSubfamily)}`.trim();
    const typo = _pickName(names.preferredFamily) || family;
    const kind = font.outlinesFormat === "cff" ? "OpenType" : "TrueType";
    return {
      family,
      full,
      typo,
      registryName: `${full || base} (${kind})`,
      keys: [...new Set([family, full, typo, base].filter(Boolean).map(norm))],
    };
  } catch {
    return { family: base, full: base, typo: base, registryName: `${base} (TrueType)`, keys: [norm(base)] };
  }
}

/**
 * Nomes internos de vários arquivos, com cache em disco por tamanho+data.
 * Ler centenas de fontes do sistema leva alguns segundos; com o cache, só a
 * primeira vez.
 *
 * @param {string[]} files
 * @param {string} cacheFile
 * @returns {Promise<Set<string>>} nomes normalizados
 */
async function namesFromFiles(files, cacheFile) {
  let cache = {};
  try {
    cache = JSON.parse(await fs.readFile(cacheFile, "utf8"));
  } catch {
    /* primeira vez */
  }
  const out = new Set();
  const vistos = new Set();
  let mudou = false;
  for (const f of files) {
    if (!/\.(ttf|otf)$/i.test(f)) continue;
    let st;
    try {
      st = fss.statSync(f);
    } catch {
      continue;
    }
    vistos.add(f);
    const key = `${st.size}|${Math.round(st.mtimeMs)}`;
    let hit = cache[f];
    if (!hit || hit.k !== key) {
      const n = await readFontNames(f);
      hit = cache[f] = { k: key, n: n.keys };
      mudou = true;
    }
    hit.n.forEach((x) => out.add(x));
  }
  for (const f of Object.keys(cache)) {
    if (!vistos.has(f)) {
      delete cache[f];
      mudou = true;
    }
  }
  if (mudou) {
    await fs.mkdir(path.dirname(cacheFile), { recursive: true });
    await fs.writeFile(cacheFile, JSON.stringify(cache));
  }
  return out;
}

/** Lista recursiva de arquivos .ttf/.otf de uma pasta (pastas que não existem são ignoradas). */
async function listFontFiles(dir, depth = 4) {
  const out = [];
  let itens;
  try {
    itens = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const it of itens) {
    const p = path.join(dir, it.name);
    if (it.isDirectory() && depth > 0) out.push(...(await listFontFiles(p, depth - 1)));
    else if (/\.(ttf|otf)$/i.test(it.name)) out.push(p);
  }
  return out;
}

module.exports = { readFontNames, namesFromFiles, listFontFiles };
