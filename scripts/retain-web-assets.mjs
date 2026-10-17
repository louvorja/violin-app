import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const RETENTION_MANIFEST = "asset-retention.json";
export const RETENTION_LIMITS = Object.freeze({
  releases: 5, // atual + até quatro anteriores
  ageMs: 14 * 24 * 60 * 60 * 1000,
  bytes: 128 * 1024 * 1024,
  manifestBytes: 4 * 1024 * 1024,
  filesPerRelease: 10_000,
});

// Somente arquivos imutáveis gerados pelo Vite. Nunca HTML, SW, source maps,
// arquivos arbitrários do public/ ou dados do usuário.
const assetPath =
  /^assets\/[A-Za-z0-9_.-]+-[A-Za-z0-9_-]{8}\.(?:m?js|css|svg|png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf|eot|wasm|mp3|mp4|ogg|opus|wav|webm)$/;
const digest = (data) => createHash("sha256").update(data).digest("hex");
const releaseId = (assets) => digest(JSON.stringify(assets));

function validAsset(asset) {
  return (
    asset &&
    assetPath.test(asset.path) &&
    Number.isSafeInteger(asset.bytes) &&
    asset.bytes >= 0 &&
    /^[a-f0-9]{64}$/.test(asset.sha256)
  );
}

function validateManifest(manifest, now) {
  if (
    manifest?.version !== 1 ||
    !Array.isArray(manifest.releases) ||
    manifest.releases.length > RETENTION_LIMITS.releases
  )
    throw new Error("Invalid retention manifest");
  const ids = new Set();
  let previousDate = now;
  for (const release of manifest.releases) {
    if (
      !Number.isSafeInteger(release?.createdAt) ||
      release.createdAt < 0 ||
      release.createdAt > previousDate ||
      !Array.isArray(release.assets) ||
      release.assets.length === 0 ||
      release.assets.length > RETENTION_LIMITS.filesPerRelease ||
      !release.assets.every(validAsset) ||
      releaseId(release.assets) !== release.id ||
      ids.has(release.id) ||
      new Set(release.assets.map((asset) => asset.path)).size !== release.assets.length
    ) {
      throw new Error("Invalid retention release");
    }
    ids.add(release.id);
    previousDate = release.createdAt;
  }
  return manifest.releases;
}

async function readAsset(directory, relative) {
  if (!assetPath.test(relative)) throw new Error(`Invalid asset path: ${relative}`);
  const info = await fs.lstat(path.join(directory, relative));
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Invalid asset file: ${relative}`);
  return fs.readFile(path.join(directory, relative));
}

async function inventory(directory, createdAt) {
  const assets = [];
  for (const name of (await fs.readdir(path.join(directory, "assets"))).sort()) {
    const relative = `assets/${name}`;
    if (!assetPath.test(relative)) continue;
    const content = await readAsset(directory, relative);
    assets.push({ path: relative, bytes: content.length, sha256: digest(content) });
  }
  return { id: releaseId(assets), createdAt, assets };
}

async function assertAssetDirectory(directory) {
  const info = await fs.lstat(path.join(directory, "assets"));
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Invalid assets directory");
}

async function previousReleases(directory, createdAt, now) {
  if (!directory) return [];
  await assertAssetDirectory(directory);
  let content;
  try {
    const info = await fs.lstat(path.join(directory, RETENTION_MANIFEST));
    if (!info.isFile() || info.isSymbolicLink() || info.size > RETENTION_LIMITS.manifestBytes) {
      throw new Error("Invalid retention manifest file");
    }
    content = await fs.readFile(path.join(directory, RETENTION_MANIFEST), "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    // Migração única: somente o dist imediatamente anterior, com a data real
    // de seu commit. Não inventa gerações nem reaproveita o mtime do checkout.
    const legacy = { version: 1, releases: [await inventory(directory, createdAt)] };
    return validateManifest(legacy, now);
  }
  return validateManifest(JSON.parse(content), now);
}

/** Executar DEPOIS de gerar o SW, para não precachear gerações antigas. */
export async function retainWebAssets({
  directory,
  previousDirectory,
  previousCreatedAt,
  now = Date.now(),
}) {
  await assertAssetDirectory(directory);
  const current = await inventory(directory, now);
  validateManifest({ version: 1, releases: [current] }, now);
  const previous = await previousReleases(previousDirectory, previousCreatedAt, now);
  const releases = [current];
  const files = new Map(current.assets.map((asset) => [asset.path, asset]));
  const copies = new Map();
  let bytes = current.assets.reduce((total, asset) => total + asset.bytes, 0);

  for (const release of previous) {
    if (release.id === current.id) continue;
    if (
      releases.length >= RETENTION_LIMITS.releases ||
      now - release.createdAt > RETENTION_LIMITS.ageMs
    )
      break;
    const additions = release.assets.filter((asset) => !files.has(asset.path));
    const extraBytes = additions.reduce((total, asset) => total + asset.bytes, 0);
    // O build atual nunca é removido, mesmo se sozinho exceder o orçamento.
    // Retém gerações completas, da mais nova à mais antiga; nunca parte delas.
    if (bytes + extraBytes > RETENTION_LIMITS.bytes) break;
    for (const asset of release.assets) {
      const existing = files.get(asset.path);
      if (existing && (existing.sha256 !== asset.sha256 || existing.bytes !== asset.bytes)) {
        throw new Error(`Immutable asset collision: ${asset.path}`);
      }
      if (existing) continue;
      const content = await readAsset(previousDirectory, asset.path);
      if (content.length !== asset.bytes || digest(content) !== asset.sha256) {
        throw new Error(`Retained asset integrity mismatch: ${asset.path}`);
      }
      files.set(asset.path, asset);
      copies.set(asset.path, content);
    }
    bytes += extraBytes;
    releases.push(release);
  }

  const manifest = JSON.stringify({ version: 1, releases });
  if (Buffer.byteLength(manifest) > RETENTION_LIMITS.manifestBytes)
    throw new Error("Retention manifest too large");
  // Toda validação termina antes de modificar a saída do build.
  for (const [relative, content] of copies)
    await fs.writeFile(path.join(directory, relative), content, { flag: "wx" });
  await fs.writeFile(path.join(directory, RETENTION_MANIFEST), manifest + "\n");
  return {
    releases: releases.length,
    copiedFiles: copies.size,
    bytes,
    droppedReleases: previous.length - releases.length + 1,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [directory, previousDirectory, previousDate] = process.argv.slice(2);
  if (!directory || !previousDirectory || !previousDate)
    throw new Error("Usage: retain-web-assets.mjs <dist> <previous-dist> <previous-commit-date>");
  const result = await retainWebAssets({
    directory,
    previousDirectory,
    previousCreatedAt: Date.parse(previousDate),
  });
  console.log(
    `Web assets: ${result.releases}/${RETENTION_LIMITS.releases} builds, ${result.bytes}/${RETENTION_LIMITS.bytes} bytes, ${result.copiedFiles} retained files; ${result.droppedReleases} discarded generations (age <=14 days).`
  );
}
