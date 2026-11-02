"use strict";

const fs = require("fs-extra");
const path = require("path");
const { randomUUID } = require("crypto");
const { isVideoId } = require("./ids.js");
const { assertPrivateWorkDir } = require("./workDirectory.js");
const { copyVerified, atomicJson, readJson } = require("../storageLayout.js");
const { ensureCollectionDirectory } = require("../sharedCollectionDirs.js");
const { publishCollectionFile } = require("../collectionPublication.js");

async function entries(dir) {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function copyMissing(from, to) {
  const stat = await fs.lstat(from);
  if (stat.isSymbolicLink()) return;
  if (stat.isDirectory()) {
    if (await fs.pathExists(to)) {
      if (!(await fs.lstat(to)).isDirectory()) throw new Error(`Destino inválido na migração de vídeos: ${to}`);
    } else await fs.ensureDir(to);
    for (const entry of await entries(from)) await copyMissing(path.join(from, entry.name), path.join(to, entry.name));
  } else if (stat.isFile() && !(await fs.pathExists(to))) await publishCopy(from, to);
}

async function publishCopy(from, to, { workDir = path.dirname(to), shared = false, root = path.dirname(to) } = {}) {
  // Outro perfil pode estar lendo o acervo durante a migração. Só exponha o
  // nome definitivo quando todos os bytes já tiverem sido conferidos.
  await fs.ensureDir(workDir, { mode: 0o700 });
  const temporary = path.join(workDir, `.louvorja-legacy-${randomUUID()}.tmp`);
  try {
    copyVerified(from, temporary);
    if (await fs.pathExists(to)) return;
    await ensureCollectionDirectory(path.dirname(to), { shared });
    await publishCollectionFile(temporary, to, { root, shared, overwrite: false });
  } finally { await fs.remove(temporary); }
}

/** Copia e verifica downloads antigos sem apagar a origem ou seguir links. */
async function migrateDownloads(fromDir, toDir, { workDir, shared = false } = {}) {
  assertPrivateWorkDir(toDir, workDir);
  if (path.resolve(fromDir) === path.resolve(toDir)) return;
  const source = await entries(fromDir);
  if (!source.length) return;
  // A origem preservada é uma cópia de segurança, não outra fonte ativa.
  // Sem este registro, excluir um vídeo ou mudar de pasta o traria de volta.
  const markerFile = path.join(workDir, ".legacy-downloads-v1.json");
  const marker = readJson(markerFile);
  const sourcePath = await fs.realpath(fromDir);
  if (marker && (marker.version !== 1 || !Array.isArray(marker.sources) || marker.sources.some((entry) => typeof entry !== "string"))) {
    throw new Error("O registro da migração de vídeos está inválido. Os arquivos foram preservados.");
  }
  if (marker?.sources.includes(sourcePath)) return;

  // MP4 primeiro: a marca de manter só acompanha um vídeo que já está no destino.
  for (const extension of ["mp4", "keep"]) {
    for (const entry of source) {
      const match = /^([A-Za-z0-9_-]{11})\.(mp4|keep)$/.exec(entry.name);
      if (!entry.isFile() || !match || match[2] !== extension) continue;
      if (extension === "keep" && !(await fs.pathExists(path.join(toDir, `${match[1]}.mp4`)))) continue;
      const target = path.join(toDir, entry.name);
      if (await fs.pathExists(target)) continue;
      await publishCopy(path.join(fromDir, entry.name), target, { workDir, shared, root: toDir });
    }
  }

  // Downloads interrompidos continuam retomáveis; trilhas de streaming antigas
  // são temporárias e não fazem parte dos vídeos guardados.
  const partials = source.find((entry) => entry.name === ".partial" && entry.isDirectory());
  if (partials) {
    const partialRoot = path.join(fromDir, ".partial");
    for (const entry of await entries(partialRoot)) {
      if (!entry.isDirectory() || !isVideoId(entry.name)) continue;
      const target = path.join(workDir, ".partial", entry.name);
      if (await fs.pathExists(target)) continue;
      await copyMissing(path.join(partialRoot, entry.name), target);
    }
  }
  const cache = source.find((entry) => entry.name === ".ytdlp-cache" && entry.isDirectory());
  if (cache) await copyMissing(path.join(fromDir, cache.name), path.join(workDir, cache.name));
  atomicJson(markerFile, { version: 1, sources: [...(marker?.sources || []), sourcePath] });
}

module.exports = { migrateDownloads };
