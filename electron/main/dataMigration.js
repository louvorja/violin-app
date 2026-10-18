"use strict";

const fs = require("fs-extra");
const path = require("path");

/** Dados do produto que acompanham a pasta escolhida em Armazenamento. */
const DATA_ENTRIES = [
  "files", "storage", "library", "Videos", "json_db", "bin", "server",
  "configweb.json", "runtime-incidents.json", "telemetry-main-errors.json",
];

const PROFILE_ENTRIES = [
  "Cache", "Code Cache", "Cookies", "Cookies-journal", "DIPS", "DIPS-wal",
  "DawnGraphiteCache", "DawnWebGPUCache", "GPUCache", "IndexedDB", "Local State",
  "Local Storage", "Network", "Network Persistent State", "Preferences",
  "Session Storage", "Shared Dictionary", "SharedStorage", "SharedStorage-wal",
  "TransportSecurity", "Trust Tokens", "Trust Tokens-journal", "VideoDecodeStats",
  "WebStorage", "blob_storage", "shared_proto_db", "Service Worker", "Sessions",
  "Crashpad", "logs", "logs.txt", "BrowserMetrics", "CertificateRevocation",
];

/** Mescla apenas dados conhecidos, preservando o destino e timestamps do cache. */
async function moveMissing(from, to) {
  let source;
  try {
    source = await fs.lstat(from);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  if (source.isSymbolicLink()) return;
  if (!(await fs.pathExists(to))) {
    await fs.move(from, to, { overwrite: false });
    return;
  }
  const target = await fs.lstat(to);
  if (!source.isDirectory() || !target.isDirectory() || target.isSymbolicLink()) return;
  for (const name of await fs.readdir(from)) {
    await moveMissing(path.join(from, name), path.join(to, name));
  }
}

async function migrateLegacyData(fromDir, toDir) {
  if (path.resolve(fromDir) === path.resolve(toDir)) return;
  for (const name of DATA_ENTRIES) {
    for (const suffix of ["", ".bak", ".tmp"]) {
      if (suffix && !name.endsWith(".json")) continue;
      await moveMissing(path.join(fromDir, name + suffix), path.join(toDir, name + suffix));
    }
  }
}

/**
 * Só roda antes de ready e depois do lock de instância única. O Chromium não
 * pode ter aberto IndexedDB/cookies enquanto esses arquivos mudam de lugar.
 */
function prepareProfile({ legacyDir, sourceDir, targetDir }) {
  if (sourceDir && path.resolve(sourceDir) !== path.resolve(targetDir)) {
    const staging = `${targetDir}.migrating`;
    if (fs.pathExistsSync(targetDir) && fs.pathExistsSync(sourceDir)) {
      throw new Error(`O destino já contém um perfil Electron: ${targetDir}`);
    }
    if (fs.pathExistsSync(sourceDir)) {
      // Uma cópia entre volumes interrompida mantém a origem; refaça só a staging.
      fs.removeSync(staging);
      fs.moveSync(sourceDir, staging, { overwrite: false });
    }
    if (fs.pathExistsSync(staging)) fs.moveSync(staging, targetDir, { overwrite: false });
    if (!fs.pathExistsSync(targetDir)) throw new Error(`Perfil Electron não encontrado: ${sourceDir}`);
  }
  fs.ensureDirSync(targetDir);
  // Upgrade do perfil antigo: nunca carregue locks nem arquivos do produto no perfil.
  if (!sourceDir && path.resolve(legacyDir) !== path.resolve(targetDir)) {
    for (const name of PROFILE_ENTRIES) {
      const from = path.join(legacyDir, name);
      const to = path.join(targetDir, name);
      if (!fs.pathExistsSync(from) || fs.pathExistsSync(to)) continue;
      if (fs.lstatSync(from).isSymbolicLink()) continue;
      fs.moveSync(from, to, { overwrite: false });
    }
  }
  return targetDir;
}

module.exports = { DATA_ENTRIES, PROFILE_ENTRIES, migrateLegacyData, prepareProfile, moveMissing };
