"use strict";

const fs = require("fs-extra");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { isVideoId } = require("./ids.js");
const { canonical, overlaps } = require("../storageRoots.js");

function exists(file) {
  try { return fs.lstatSync(file); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

/**
 * Executado no bootstrap, antes de iniciar downloads. A ordem das origens é
 * prioridade: um checkpoint já presente nunca se mistura ao de outra origem.
 * Não reutiliza trilhas .stream e não apaga nada nas pastas antigas.
 */
function migrateVideoWork(sourceDirs, targetDir) {
  // Importação adiada: storageLayout também chama esta migração no bootstrap.
  const { copyVerified, readJson, atomicJson } = require("../storageLayout.js");
  const target = canonical(targetDir);
  const markerFile = path.join(target, ".legacy-work-v1.json");
  const marker = readJson(markerFile);
  if (marker && (marker.version !== 1 || !Array.isArray(marker.sources) || marker.sources.some((s) => typeof s !== "string"))) {
    throw new Error("O registro dos temporários de vídeo está inválido. As origens foram preservadas.");
  }
  const completed = new Set(marker?.sources || []);

  function migrateDownloadMarker(source) {
    const name = ".legacy-downloads-v1.json";
    const previous = readJson(path.join(source, name));
    if (!previous) return;
    const destination = path.join(target, name);
    const current = readJson(destination);
    for (const value of [previous, current].filter(Boolean)) {
      if (value.version !== 1 || !Array.isArray(value.sources) || value.sources.some((s) => typeof s !== "string")) {
        throw new Error("O registro da migração de vídeos está inválido. As origens foram preservadas.");
      }
    }
    // Sem essa memória, a origem preservada ressuscitaria vídeos já removidos.
    atomicJson(destination, { version: 1, sources: [...new Set([...(current?.sources || []), ...previous.sources])] });
  }

  function copyMissing(from, to) {
    if (exists(to)) return;
    const temporary = path.join(target, `.migrating-${randomUUID()}`);
    try {
      copyVerified(from, temporary);
      fs.ensureDirSync(path.dirname(to), { mode: 0o700 });
      fs.renameSync(temporary, to);
    } finally { fs.removeSync(temporary); }
  }

  for (const sourceDir of sourceDirs) {
    const stat = exists(sourceDir);
    if (!stat || !stat.isDirectory()) continue;
    const source = canonical(sourceDir);
    if (source === target || completed.has(source)) continue;
    if (overlaps(source, target)) throw new Error("A origem dos temporários de vídeo precisa estar separada do novo destino.");
    migrateDownloadMarker(source);
    const partial = path.join(source, ".partial");
    if (exists(partial)?.isDirectory()) {
      const destination = path.join(target, ".partial");
      const destinationStat = exists(destination);
      if (destinationStat && !destinationStat.isDirectory()) throw new Error("O destino dos checkpoints de vídeo não é uma pasta regular.");
      for (const entry of fs.readdirSync(partial, { withFileTypes: true })) {
        if (!entry.isDirectory() || !isVideoId(entry.name)) continue;
        copyMissing(path.join(partial, entry.name), path.join(target, ".partial", entry.name));
      }
    }
    const cache = path.join(source, ".ytdlp-cache");
    if (exists(cache)?.isDirectory()) {
      // Cache não é um checkpoint: preserve a versão atual inteira, quando existir.
      copyMissing(cache, path.join(target, ".ytdlp-cache"));
    }
    completed.add(source);
    atomicJson(markerFile, { version: 1, sources: [...completed] });
  }
}

module.exports = { migrateVideoWork };
