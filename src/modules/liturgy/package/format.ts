/**
 * Pacote da liturgia (`.llja`): um ZIP com a liturgia e os arquivos que ela
 * usa, para montar o culto num computador e abrir em outro.
 *
 *   manifest.json   o que tem no pacote (formato, versão e a lista de arquivos);
 *   liturgy.json    a liturgia: `{ name, color?, items }`, como o app guarda;
 *   files/
 *     liturgy/<ref-ou-item>/<nome>               arquivos dos itens do tipo arquivo
 *     media/<id>/<nome>                          Biblioteca de Mídia
 *     background-sound/<id>/<nome>               Som de Fundo
 *     background-projection/<id>/<nome>          Projeção de Fundo
 *
 * Os itens continuam com o `ref_id` de origem; o manifesto diz de que
 * biblioteca (`source`) e de que registro (`sourceId`) veio cada arquivo, e a
 * importação troca pelo id novo.
 *
 * Este arquivo só monta e lê o ZIP — sem IndexedDB, sem disco. Quem junta os
 * arquivos é `collect.ts`; quem grava nas bibliotecas é `install.ts`. O
 * `.llja` do Classic (outro formato) é lido por `classic.ts`.
 *
 * O ZIP é montado e lido em streaming (`@zip.js/zip.js`): o pacote pode ter
 * 5 GB no desktop sem passar pela memória. O JSZip continua nos outros fluxos
 * (backup, bundles, `.slja` e vídeos online).
 */
import type { LiturgyItem } from "@/types/Liturgy";
import { maxPackageBytes, MAX_PACKAGE_FILES } from "@/helpers/StorageLimits";
import { loadZipJs } from "@/helpers/Zip";
import { safeFileName } from "@/helpers/FileName";

export { loadZipJs, safeFileName };

export const PACKAGE_EXT = "llja";
export const PACKAGE_FORMAT = "louvorja-liturgy-package";
export const PACKAGE_VERSION = 1;
export const PACKAGE_MIME = "application/x-louvorja-liturgy";
export const MANIFEST_PATH = "manifest.json";
export const LITURGY_PATH = "liturgy.json";
const FILES_ROOT = "files/";

/** Manifesto/JSON de liturgia não precisa ser maior que isto. */
export const MAX_MANIFEST_BYTES = 64 * 1024 ** 2;

export { MAX_PACKAGE_FILES };

export const FILE_SOURCES = [
  "liturgy",
  "media",
  "background-sound",
  "background-projection",
] as const;
export type FileSource = (typeof FILE_SOURCES)[number];

/**
 * Um arquivo a pôr no pacote, ou lido dele. Os bytes só são abertos quando
 * alguém chama `open()` — a coleta não carrega nada.
 */
export interface PackageEntry {
  source: FileSource;
  /** Id do registro na origem (ou do item, para arquivo da liturgia sem registro). */
  sourceId: string;
  /** Nome original, com extensão. */
  name: string;
  mime: string;
  size: number;
  /** `null` quando o arquivo sumiu entre a coleta e a leitura. */
  open: () => Promise<ReadableStream<Uint8Array> | null>;
}

export interface ManifestFile {
  zipPath: string;
  source: FileSource;
  sourceId: string;
  name: string;
  mime: string;
  size: number;
}

export interface PackageManifest {
  format: typeof PACKAGE_FORMAT;
  version: number;
  exportedAt: string;
  appVersion: string;
  liturgy: string;
  files: ManifestFile[];
}

export interface PackageLiturgy {
  name: string;
  color?: string;
  items: LiturgyItem[];
}

/** O arquivo começa com a assinatura de ZIP (`PK\x03\x04`)? */
export async function isZip(file: Blob): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  return head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
}

/** `files\foto.jpg` (Windows) e `files/foto.jpg` são o mesmo lugar. */
export function normalizeZipPath(path: string): string {
  return String(path || "")
    .trim()
    .replace(/\\/g, "/");
}

/**
 * Caminho de dentro do pacote que pode ser lido: relativo, sem unidade, sem
 * subir de pasta e debaixo de `root`. ZIP de terceiro é entrada não confiável.
 */
export function safeZipPath(path: string, root: string): string | null {
  const p = normalizeZipPath(path);
  if (!p || p.includes(":") || p.startsWith("/")) return null;
  if (p.split("/").some((part) => part === ".." || part === ".")) return null;
  if (!p.toLowerCase().startsWith(root.toLowerCase())) return null;
  return p;
}

function zipPathFor(file: PackageEntry): string {
  return `${FILES_ROOT}${file.source}/${safeFileName(file.sourceId, "item")}/${safeFileName(file.name)}`;
}

/**
 * Monta o pacote direto no `sink` (arquivo no disco ou writable do navegador).
 * Cada arquivo entra uma vez por (`source`, `sourceId`); os binários vão sem
 * compressão (imagem e vídeo já vêm comprimidos) e os JSONs, comprimidos.
 */
export async function buildPackage(input: {
  liturgy: PackageLiturgy;
  files: PackageEntry[];
  appVersion?: string;
  sink: WritableStream<Uint8Array>;
}): Promise<{ fileCount: number; totalBytes: number }> {
  const { ZipWriter, TextReader } = await loadZipJs();
  const writer = new ZipWriter(input.sink, { level: 0 });
  const seen = new Set<string>();
  const manifestFiles: ManifestFile[] = [];
  let totalBytes = 0;

  for (const file of input.files) {
    const key = `${file.source}\u0000${file.sourceId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const stream = await file.open();
    if (!stream) continue;
    const zipPath = zipPathFor(file);
    const reader = { readable: stream, size: file.size };
    await writer.add(zipPath, reader, { level: 0 });
    manifestFiles.push({
      zipPath,
      source: file.source,
      sourceId: file.sourceId,
      name: file.name,
      mime: file.mime || "application/octet-stream",
      size: file.size,
    });
    totalBytes += file.size;
  }

  const manifest: PackageManifest = {
    format: PACKAGE_FORMAT,
    version: PACKAGE_VERSION,
    exportedAt: new Date().toISOString(),
    appVersion: input.appVersion || "",
    liturgy: LITURGY_PATH,
    files: manifestFiles,
  };
  const liturgy: PackageLiturgy = {
    name: input.liturgy.name,
    ...(input.liturgy.color ? { color: input.liturgy.color } : {}),
    items: input.liturgy.items,
  };
  await writer.add(LITURGY_PATH, new TextReader(JSON.stringify(liturgy, null, 2)), {
    level: 6,
  });
  await writer.add(MANIFEST_PATH, new TextReader(JSON.stringify(manifest, null, 2)), {
    level: 6,
  });
  await writer.close();

  return { fileCount: manifestFiles.length, totalBytes };
}

export type ReadError = "not_zip" | "not_liturgy" | "unsupported_version" | "too_large" | "invalid";

/** Pacote aberto: os bytes de cada entrada ainda estão no ZIP. */
export interface PackageReader {
  manifest: PackageManifest;
  liturgyJson: string;
  files: PackageEntry[];
  close: () => Promise<void>;
}

export type ReadPackageResult =
  | { ok: true; reader: PackageReader }
  | { ok: false; error: ReadError };

/** Entrada do zip.js com os campos que interessam aqui. */
type ZipEntry = import("@zip.js/zip.js").FileEntry;

function entrySize(entry: ZipEntry): number {
  return typeof entry.uncompressedSize === "number" && entry.uncompressedSize >= 0
    ? entry.uncompressedSize
    : 0;
}

export function openZipEntry(entry: ZipEntry): () => Promise<ReadableStream<Uint8Array>> {
  return async () => {
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    void entry.getData(writable).catch((error: unknown) => {
      void writable.abort(error).catch(() => {});
    });
    return readable;
  };
}

/**
 * Lê um pacote do Violin. `null` quando o ZIP não é um (pode ser do Classic,
 * que `classic.ts` lê). Só são lidos os caminhos que o manifesto lista, dentro
 * de `files/`, e nada é gravado em disco.
 */
export async function readPackage(file: Blob): Promise<ReadPackageResult | null> {
  if (!Number.isFinite(file.size) || file.size <= 0) return { ok: false, error: "not_zip" };
  if (file.size > maxPackageBytes()) return { ok: false, error: "too_large" };
  if (!(await isZip(file))) return { ok: false, error: "not_zip" };

  const { ZipReader, BlobReader, TextWriter } = await loadZipJs();
  const reader = new ZipReader(new BlobReader(file));
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await reader.close().catch(() => {});
  };

  try {
    const entries = await reader.getEntries();
    const byPath = new Map<string, ZipEntry>();
    let total = 0;
    for (const entry of entries) {
      if (entry.directory) continue;
      total += entrySize(entry);
      byPath.set(normalizeZipPath(entry.filename).toLowerCase(), entry);
    }
    const manifestEntry = byPath.get(MANIFEST_PATH);
    if (!manifestEntry) {
      await close();
      return null;
    }
    if (entries.length > MAX_PACKAGE_FILES + 2 || total > maxPackageBytes()) {
      await close();
      return { ok: false, error: "too_large" };
    }
    if (entrySize(manifestEntry) > 16 * 1024 ** 2) {
      await close();
      return { ok: false, error: "invalid" };
    }

    let manifest: PackageManifest;
    try {
      const text = await manifestEntry.getData(new TextWriter());
      manifest = JSON.parse(String(text).replace(/^\uFEFF/, ""));
    } catch {
      await close();
      return { ok: false, error: "invalid" };
    }
    if (!manifest || manifest.format !== PACKAGE_FORMAT) {
      await close();
      return { ok: false, error: "not_liturgy" };
    }
    if (Number(manifest.version) !== PACKAGE_VERSION) {
      await close();
      return { ok: false, error: "unsupported_version" };
    }

    const liturgyPath = safeZipPath(String(manifest.liturgy || LITURGY_PATH), "");
    const liturgyEntry = liturgyPath ? byPath.get(liturgyPath.toLowerCase()) : undefined;
    if (!liturgyEntry || entrySize(liturgyEntry) > MAX_MANIFEST_BYTES) {
      await close();
      return { ok: false, error: "invalid" };
    }
    const liturgyJson = String(await liturgyEntry.getData(new TextWriter())).replace(/^\uFEFF/, "");
    if (liturgyJson.length > MAX_MANIFEST_BYTES) {
      await close();
      return { ok: false, error: "invalid" };
    }

    const listed = Array.isArray(manifest.files) ? manifest.files : [];
    if (listed.length > MAX_PACKAGE_FILES) {
      await close();
      return { ok: false, error: "too_large" };
    }
    const files: PackageEntry[] = [];
    let read = 0;
    for (const f of listed) {
      if (
        !f ||
        !FILE_SOURCES.includes(f.source) ||
        typeof f.sourceId !== "string" ||
        !f.sourceId ||
        typeof f.zipPath !== "string"
      )
        continue;
      const path = safeZipPath(f.zipPath, FILES_ROOT);
      const entry = path ? byPath.get(path.toLowerCase()) : undefined;
      if (!path || !entry || entry.encrypted || entrySize(entry) <= 0) continue;
      read += entrySize(entry);
      if (read > maxPackageBytes()) {
        await close();
        return { ok: false, error: "too_large" };
      }
      const name = safeFileName(
        typeof f.name === "string" && f.name ? f.name : path.split("/").pop() || ""
      );
      const mime = typeof f.mime === "string" && f.mime.length <= 128 ? f.mime : "";
      files.push({
        source: f.source,
        sourceId: f.sourceId,
        name,
        mime,
        size: entrySize(entry),
        open: openZipEntry(entry),
      });
    }

    return {
      ok: true,
      reader: { manifest, liturgyJson, files, close },
    };
  } catch {
    await close();
    return { ok: false, error: "not_zip" };
  }
}
