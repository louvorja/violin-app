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
 */
import type { LiturgyItem } from "@/types/Liturgy";

export const PACKAGE_EXT = "llja";
export const PACKAGE_FORMAT = "louvorja-liturgy-package";
export const PACKAGE_VERSION = 1;
export const PACKAGE_MIME = "application/x-louvorja-liturgy";
export const MANIFEST_PATH = "manifest.json";
export const LITURGY_PATH = "liturgy.json";
const FILES_ROOT = "files/";

/** Acima disso o pacote é recusado (JSZip monta tudo na memória). */
export const MAX_PACKAGE_BYTES = 2 * 1024 ** 3;
/** Teto de arquivos num pacote: liturgia nenhuma chega perto disso. */
export const MAX_PACKAGE_FILES = 2000;

export const FILE_SOURCES = [
  "liturgy",
  "media",
  "background-sound",
  "background-projection",
] as const;
export type FileSource = (typeof FILE_SOURCES)[number];

/** Um arquivo a pôr no pacote, ou lido dele. */
export interface PackageFile {
  source: FileSource;
  /** Id do registro na origem (ou do item, para arquivo da liturgia sem registro). */
  sourceId: string;
  /** Nome original, com extensão. */
  name: string;
  mime: string;
  data: Blob;
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

export async function loadJsZip() {
  const mod = (await import("jszip")) as unknown as { default?: { default?: unknown } };
  return (mod.default?.default ?? mod.default ?? mod) as typeof import("jszip");
}

/** Nome de arquivo aceito em Windows, macOS e Linux, sem perder acentos. */
export function safeFileName(name: string, fallback = "arquivo"): string {
  const cleaned = String(name || "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    // Windows não aceita nome terminado em ponto ou espaço.
    .replace(/[. ]+$/, "")
    .slice(0, 180);
  return cleaned || fallback;
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

function zipPathFor(file: PackageFile): string {
  return `${FILES_ROOT}${file.source}/${safeFileName(file.sourceId, "item")}/${safeFileName(file.name)}`;
}

/**
 * Monta o pacote. Cada arquivo entra uma vez por (`source`, `sourceId`); os
 * binários vão sem compressão (imagem e vídeo já vêm comprimidos) e os JSONs,
 * comprimidos.
 */
export async function buildPackage(input: {
  liturgy: PackageLiturgy;
  files: PackageFile[];
  appVersion?: string;
}): Promise<Blob> {
  const JSZip = await loadJsZip();
  const zip = new JSZip();
  const seen = new Set<string>();
  const files: ManifestFile[] = [];
  for (const file of input.files) {
    const key = `${file.source}\u0000${file.sourceId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const zipPath = zipPathFor(file);
    zip.file(zipPath, file.data, { binary: true, compression: "STORE" });
    files.push({
      zipPath,
      source: file.source,
      sourceId: file.sourceId,
      name: file.name,
      mime: file.mime || "application/octet-stream",
      size: file.data.size,
    });
  }
  const manifest: PackageManifest = {
    format: PACKAGE_FORMAT,
    version: PACKAGE_VERSION,
    exportedAt: new Date().toISOString(),
    appVersion: input.appVersion || "",
    liturgy: LITURGY_PATH,
    files,
  };
  const liturgy: PackageLiturgy = {
    name: input.liturgy.name,
    ...(input.liturgy.color ? { color: input.liturgy.color } : {}),
    items: input.liturgy.items,
  };
  zip.file(LITURGY_PATH, JSON.stringify(liturgy, null, 2), { compression: "DEFLATE" });
  zip.file(MANIFEST_PATH, JSON.stringify(manifest, null, 2), { compression: "DEFLATE" });
  return zip.generateAsync({ type: "blob", mimeType: PACKAGE_MIME });
}

export type ReadError = "not_zip" | "not_liturgy" | "unsupported_version" | "too_large" | "invalid";

export type ReadPackageResult =
  | { ok: true; manifest: PackageManifest; liturgyJson: string; files: PackageFile[] }
  | { ok: false; error: ReadError };

type ZipEntry = import("jszip").JSZipObject & { _data?: { uncompressedSize?: number } };

/** Tamanho descompactado que o ZIP declara, sem descompactar. */
function declaredSize(entry: ZipEntry): number {
  const size = entry._data?.uncompressedSize;
  return typeof size === "number" && size >= 0 ? size : 0;
}

/**
 * Lê um pacote do Violin. `null` quando o ZIP não é um (pode ser do Classic,
 * que `classic.ts` lê). Só são lidos os caminhos que o manifesto lista, dentro
 * de `files/`, e nada é gravado em disco.
 */
export async function readPackage(blob: Blob): Promise<ReadPackageResult | null> {
  if (!(await isZip(blob))) return { ok: false, error: "not_zip" };
  const JSZip = await loadJsZip();
  let zip: import("jszip");
  try {
    zip = await JSZip.loadAsync(blob);
  } catch {
    return { ok: false, error: "not_zip" };
  }
  const entries = new Map<string, ZipEntry>();
  let total = 0;
  let count = 0;
  zip.forEach((path, entry) => {
    if (entry.dir) return;
    count += 1;
    total += declaredSize(entry as ZipEntry);
    entries.set(normalizeZipPath(path).toLowerCase(), entry as ZipEntry);
  });
  const manifestEntry = entries.get(MANIFEST_PATH);
  if (!manifestEntry) return null;
  if (count > MAX_PACKAGE_FILES + 2 || total > MAX_PACKAGE_BYTES)
    return { ok: false, error: "too_large" };

  let manifest: PackageManifest;
  try {
    // Manifesto e liturgia são pequenos; um JSON enorme é pacote adulterado.
    if (declaredSize(manifestEntry) > 16 * 1024 ** 2) return { ok: false, error: "invalid" };
    manifest = JSON.parse((await manifestEntry.async("string")).replace(/^\uFEFF/, ""));
  } catch {
    return { ok: false, error: "invalid" };
  }
  if (!manifest || manifest.format !== PACKAGE_FORMAT) return { ok: false, error: "not_liturgy" };
  if (Number(manifest.version) !== PACKAGE_VERSION)
    return { ok: false, error: "unsupported_version" };

  const liturgyPath = safeZipPath(String(manifest.liturgy || LITURGY_PATH), "");
  const liturgyEntry = liturgyPath ? entries.get(liturgyPath.toLowerCase()) : undefined;
  if (!liturgyEntry || declaredSize(liturgyEntry) > 64 * 1024 ** 2)
    return { ok: false, error: "invalid" };
  const liturgyJson = (await liturgyEntry.async("string")).replace(/^\uFEFF/, "");

  const files: PackageFile[] = [];
  const listed = Array.isArray(manifest.files) ? manifest.files : [];
  if (listed.length > MAX_PACKAGE_FILES) return { ok: false, error: "too_large" };
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
    const entry = path ? entries.get(path.toLowerCase()) : undefined;
    if (!path || !entry) continue;
    read += declaredSize(entry);
    if (read > MAX_PACKAGE_BYTES) return { ok: false, error: "too_large" };
    const data = await entry.async("blob");
    const name = safeFileName(
      typeof f.name === "string" && f.name ? f.name : path.split("/").pop() || ""
    );
    const mime = typeof f.mime === "string" && f.mime.length <= 128 ? f.mime : "";
    files.push({
      source: f.source,
      sourceId: f.sourceId,
      name,
      mime,
      data: mime ? new Blob([data], { type: mime }) : data,
    });
  }
  return { ok: true, manifest, liturgyJson, files };
}
