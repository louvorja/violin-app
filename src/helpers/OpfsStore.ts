/**
 * OpfsStore — arquivos das bibliotecas no Origin Private File System (web).
 *
 * O IndexedDB guarda só metadados + `path: "opfs:<pasta>/<id>/<nome>"`; os
 * bytes ficam no OPFS, que é disco de verdade (sem o teto de um registro do
 * IndexedDB). No desktop nada disto é usado: lá o acervo é uma pasta física.
 *
 * As URLs são servidas pelo Service Worker em `<base>__opfs/<caminho>`; assim
 * `<img>`, `<video>` e PDF recebem uma URL síncrona e o vídeo continua com
 * `Range` (seek). Sem Service Worker controlando a página, `opfsActive()` é
 * falso e as bibliotecas voltam ao modelo antigo (Blob no IDB, 500 MB).
 *
 * @category helper-puro — sem Vue; usa OPFS e Cache Storage.
 */
import { safeFileName } from "@/helpers/FileName";

const OPFS_SCHEME = "opfs:";
const ROOT = "louvorja";
const KIND_RE = /^(media-library|background-projection|background-sound|liturgy-files)$/;
const RECORD_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const REL_RE =
  /^(media-library|background-projection|background-sound|liturgy-files)\/[A-Za-z0-9][A-Za-z0-9_-]{0,63}\/[^/\\]+$/;
const TEMP_RE = /^liturgy-temp\/[A-Za-z0-9-]+\.(llja|zip)$/;
const STAGING_RE =
  /^\.staging\/[A-Za-z0-9-]+\/(restore|rollback)\/(media-library|background-projection|background-sound|liturgy-files)\/[A-Za-z0-9][A-Za-z0-9_-]{0,63}\/[^/\\]+$/;
const STAGING_JOURNAL_RE = /^\.staging\/[A-Za-z0-9-]+\/journal\.json$/;

type DirHandle = FileSystemDirectoryHandle & {
  entries?: () => AsyncIterableIterator<[string, FileSystemHandle]>;
};
type FileHandle = FileSystemFileHandle & {
  createWritable?: () => Promise<FileSystemWritableFileStream>;
};
type WritableFile = {
  write: (data: BufferSource | Blob | string) => Promise<void>;
  close: () => Promise<void>;
  abort: (reason?: unknown) => Promise<void>;
};

export interface OpfsInfo {
  exists: boolean;
  size: number;
  mtimeMs?: number;
}

export interface OpfsEntry {
  rel: string;
  size: number;
  mtimeMs: number;
}

export function isOpfsSupported(): boolean {
  if (typeof navigator === "undefined" || typeof navigator.storage?.getDirectory !== "function") {
    return false;
  }
  // `getDirectory()` sozinho não basta: o Safari antigo expõe OPFS mas não
  // `createWritable`, e escrever falharia no meio da importação.
  const proto =
    typeof FileSystemFileHandle !== "undefined"
      ? (FileSystemFileHandle.prototype as { createWritable?: unknown })
      : null;
  return !!proto && typeof proto.createWritable === "function";
}

/** `path` de registro com o esquema OPFS. */
export function isOpfsPath(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(OPFS_SCHEME) && isOpfsRel(relOf(value));
}

export function relOf(value: string): string {
  return value.startsWith(OPFS_SCHEME) ? value.slice(OPFS_SCHEME.length) : value;
}

export function opfsPathOf(rel: string): string {
  return `${OPFS_SCHEME}${rel}`;
}

/** Caminho relativo que o adaptador aceita (as quatro pastas ou o temp de export). */
export function isOpfsRel(value: unknown): value is string {
  if (typeof value !== "string" || !value || value.includes("\0")) return false;
  if (value.includes("\\") || value.startsWith("/") || value.includes(":")) return false;
  if (TEMP_RE.test(value)) return true;
  if (!REL_RE.test(value)) return false;
  const parts = value.split("/");
  if (parts[2] === "." || parts[2] === "..") return false;
  return KIND_RE.test(parts[0]);
}

function isStagingRel(value: unknown): value is string {
  return typeof value === "string" && STAGING_RE.test(value);
}

function isStagingJournalRel(value: unknown): value is string {
  return typeof value === "string" && STAGING_JOURNAL_RE.test(value);
}

function isWritableRel(value: unknown): value is string {
  return isOpfsRel(value) || isStagingRel(value) || isStagingJournalRel(value);
}

/** Caminho de staging interno de uma restauração de backup. */
export function stagingRel(token: string, phase: "restore" | "rollback", rel: string): string {
  if (!isOpfsRel(rel)) throw new Error("opfs_path_invalid");
  return `.staging/${token}/${phase}/${rel}`;
}

/** Caminho do journal de restauração em `.staging/<token>/journal.json`. */
export function stagingJournalRel(token: string): string {
  if (!/^[A-Za-z0-9-]+$/.test(token)) throw new Error("opfs_token_invalid");
  return `.staging/${token}/journal.json`;
}

/** URL síncrona servida pelo Service Worker. */
export function opfsUrl(value: string): string {
  const rel = relOf(value);
  if (!isOpfsRel(rel)) return "";
  const base = (import.meta.env.BASE_URL || "/").replace(/\/?$/, "/");
  const encoded = rel.split("/").map(encodeURIComponent).join("/");
  return `${base}__opfs/${encoded}`;
}

/** Nome seguro para o OPFS, mesma régua do pacote. */
export const safeStorageName = safeFileName;

async function root(): Promise<DirHandle> {
  if (!isOpfsSupported()) throw new Error("opfs_unavailable");
  const storage = navigator.storage as StorageManager & {
    getDirectory: () => Promise<FileSystemDirectoryHandle>;
  };
  const dir = (await storage.getDirectory()) as DirHandle;
  return (await dir.getDirectoryHandle(ROOT, { create: true })) as DirHandle;
}

async function parentOf(rel: string, create: boolean): Promise<{ dir: DirHandle; name: string }> {
  if (!isWritableRel(rel)) throw new Error("opfs_path_invalid");
  const parts = rel.split("/");
  let dir = await root();
  for (const part of parts.slice(0, -1)) {
    dir = (await dir.getDirectoryHandle(part, { create })) as DirHandle;
  }
  return { dir, name: parts[parts.length - 1] };
}

async function fileHandle(rel: string, create: boolean): Promise<FileHandle> {
  const { dir, name } = await parentOf(rel, create);
  return (await dir.getFileHandle(name, { create })) as FileHandle;
}

/** Abre o `createWritable` de um arquivo, limpando o vazio em caso de falha. */
async function openWritable(rel: string): Promise<{ handle: FileHandle; target: WritableFile }> {
  const handle = await fileHandle(rel, true);
  if (typeof handle.createWritable !== "function") {
    await removeOpfs(rel, true).catch(() => {});
    throw new Error("opfs_not_writable");
  }
  return { handle, target: (await handle.createWritable()) as unknown as WritableFile };
}

/** Grava um stream inteiro; confere o tamanho quando `size` é conhecido. */
export async function writeOpfsStream(
  rel: string,
  stream: ReadableStream<Uint8Array>,
  size: number,
  options: { shouldStop?: () => boolean } = {}
): Promise<number> {
  const { target: writable } = await openWritable(rel);
  let written = 0;
  const reader = stream.getReader();
  try {
    for (;;) {
      if (options.shouldStop?.()) throw new Error("canceled");
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      written += value.byteLength;
      if (size > 0 && written > size) throw new Error("too_large");
      await writable.write(value as unknown as BufferSource);
    }
    await writable.close();
  } catch (error) {
    await writable.abort(error).catch(() => {});
    await removeOpfs(rel, true).catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  if (size > 0 && written !== size) {
    await removeOpfs(rel, true).catch(() => {});
    throw new Error("incomplete_file");
  }
  return written;
}

export async function readOpfsFile(rel: string): Promise<File | null> {
  try {
    const handle = await fileHandle(rel, false);
    return await handle.getFile();
  } catch (error) {
    if ((error as { name?: string })?.name === "NotFoundError") return null;
    throw error;
  }
}

export async function opfsInfo(rel: string): Promise<OpfsInfo> {
  try {
    const file = await readOpfsFile(rel);
    return file
      ? { exists: true, size: file.size, mtimeMs: file.lastModified }
      : { exists: false, size: 0 };
  } catch {
    return { exists: false, size: 0 };
  }
}

/** Remove o arquivo e a pasta do registro, se ficarem vazias. */
export async function removeOpfs(rel: string, onlyFile = false): Promise<boolean> {
  if (!isWritableRel(rel)) return false;
  const parts = rel.split("/");
  try {
    const { dir, name } = await parentOf(rel, false);
    await dir.removeEntry(name);
    if (!onlyFile && parts.length === 3) {
      const kind = await root();
      const idDir = await kind.getDirectoryHandle(parts[0], { create: false });
      await idDir.removeEntry(parts[1]).catch(() => {});
    }
    return true;
  } catch (error) {
    if ((error as { name?: string })?.name === "NotFoundError") return false;
    throw error;
  }
}

/** Copia um arquivo OPFS em streaming (staging ↔ destino). */
export async function copyOpfsFile(fromRel: string, toRel: string): Promise<number> {
  const file = await readOpfsFile(fromRel);
  if (!file) throw new Error(`opfs_missing:${fromRel}`);
  return writeOpfsStream(toRel, file.stream() as ReadableStream<Uint8Array>, file.size);
}

/** Remove o token inteiro de staging (restore + rollback). */
export async function removeStaging(token: string): Promise<void> {
  if (!/^[A-Za-z0-9-]+$/.test(token)) return;
  try {
    const dir = await root();
    const staging = (await dir.getDirectoryHandle(".staging", { create: false })) as DirHandle;
    await (staging as FileSystemDirectoryHandle).removeEntry(token, { recursive: true });
  } catch (error) {
    if ((error as { name?: string })?.name !== "NotFoundError") throw error;
  }
}

/** Grava texto (UTF-8) em um caminho gravável do OPFS. */
export async function writeOpfsText(rel: string, content: string): Promise<void> {
  const bytes = new TextEncoder().encode(content);
  const { target: writable } = await openWritable(rel);
  try {
    await writable.write(bytes as unknown as BufferSource);
    await writable.close();
  } catch (error) {
    await writable.abort(error).catch(() => {});
    await removeOpfs(rel, true).catch(() => {});
    throw error;
  }
}

/** Lê texto (UTF-8) de um caminho do OPFS, retornando `null` se não existir. */
export async function readOpfsText(rel: string): Promise<string | null> {
  const file = await readOpfsFile(rel);
  return file ? file.text() : null;
}

/** Lista tokens existentes dentro de `.staging/`. */
export async function listOpfsStagingTokens(): Promise<string[]> {
  if (!isOpfsSupported()) return [];
  try {
    const base = await root();
    const staging = (await base.getDirectoryHandle(".staging", { create: false })) as DirHandle;
    if (!staging.entries) return [];
    const tokens: string[] = [];
    for await (const [name, handle] of staging.entries()) {
      if (handle.kind === "directory" && /^[A-Za-z0-9-]+$/.test(name)) tokens.push(name);
    }
    return tokens;
  } catch {
    return [];
  }
}

/**
 * Remove todo o staging de restaurações antigas.
 *
 * Chamado no boot. Se outra aba estiver restaurando um backup, o staging dela
 * é recriado sob um token novo na próxima etapa; o risco é interromper uma
 * restauração concorrente, cenário raro para este app.
 */
export async function pruneOpfsStaging(): Promise<boolean> {
  if (!isOpfsSupported()) return false;
  try {
    const dir = await root();
    await (dir as FileSystemDirectoryHandle).removeEntry(".staging", { recursive: true });
    return true;
  } catch (error) {
    if ((error as { name?: string })?.name === "NotFoundError") return false;
    throw error;
  }
}

/** Arquivos existentes nas pastas gerenciadas (para prune/estatísticas). */
export async function listOpfs(): Promise<OpfsEntry[]> {
  if (!isOpfsSupported()) return [];
  const out: OpfsEntry[] = [];
  let base: DirHandle;
  try {
    base = await root();
  } catch {
    return out;
  }
  for (const kind of [
    "media-library",
    "background-projection",
    "background-sound",
    "liturgy-files",
  ]) {
    let kindDir: DirHandle;
    try {
      kindDir = (await base.getDirectoryHandle(kind, { create: false })) as DirHandle;
    } catch {
      continue;
    }
    if (!kindDir.entries) continue;
    for await (const [id, idHandle] of kindDir.entries()) {
      if (idHandle.kind !== "directory" || !RECORD_RE.test(id)) continue;
      const idDir = idHandle as DirHandle;
      if (!idDir.entries) continue;
      for await (const [name, file] of idDir.entries()) {
        if (file.kind !== "file") continue;
        try {
          const data = await (file as FileSystemFileHandle).getFile();
          out.push({ rel: `${kind}/${id}/${name}`, size: data.size, mtimeMs: data.lastModified });
        } catch {
          /* arquivo removido durante a varredura */
        }
      }
    }
  }
  return out;
}

export async function opfsFreeSpace(): Promise<number | null> {
  if (!isOpfsSupported()) return null;
  const estimate = await navigator.storage?.estimate?.().catch(() => null);
  if (!estimate || typeof estimate.quota !== "number") return null;
  return Math.max(0, estimate.quota - (estimate.usage || 0));
}

/** OPFS utilizável para exibir arquivos: suporte + Service Worker controlando. */
export function opfsActive(): boolean {
  return (
    isOpfsSupported() &&
    typeof navigator.serviceWorker !== "undefined" &&
    !!navigator.serviceWorker.controller
  );
}

/** Cria um writer para um arquivo temporário de exportação. */
export async function createOpfsWriter(rel = `liturgy-temp/${crypto.randomUUID()}.llja`): Promise<{
  rel: string;
  writable: WritableStream<Uint8Array>;
  commit: () => Promise<File>;
  abort: () => Promise<void>;
}> {
  const { handle, target: raw } = await openWritable(rel);
  const target = raw as unknown as WritableStream<Uint8Array> & {
    write: (data: BufferSource | Blob | string) => Promise<void>;
  };
  let closed = false;
  const writable = new WritableStream<Uint8Array>({
    write: (chunk) => target.write(chunk as unknown as BufferSource),
    close: async () => {
      if (closed) return;
      await target.close();
      closed = true;
    },
    abort: async (reason) => {
      if (closed) return;
      closed = true;
      await target.abort(reason).catch(() => {});
    },
  });
  return {
    rel,
    writable,
    commit: async () => {
      if (!closed) {
        await target.close();
        closed = true;
      }
      return handle.getFile();
    },
    abort: async () => {
      if (!closed) {
        closed = true;
        await target.abort().catch(() => {});
      }
      await removeOpfs(rel, true).catch(() => {});
    },
  };
}

/** Remove temporários de exportação com mais de `minAgeMs`. */
export async function pruneOpfsTemp(minAgeMs = 6 * 60 * 60 * 1000): Promise<number> {
  if (!isOpfsSupported()) return 0;
  let base: DirHandle;
  try {
    base = await root();
  } catch {
    return 0;
  }
  let dir: DirHandle;
  try {
    dir = (await base.getDirectoryHandle("liturgy-temp", { create: false })) as DirHandle;
  } catch {
    return 0;
  }
  if (!dir.entries) return 0;
  let removed = 0;
  const now = Date.now();
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind !== "file") continue;
    try {
      const file = await (handle as FileSystemFileHandle).getFile();
      if (now - file.lastModified < minAgeMs) continue;
      await dir.removeEntry(name);
      removed += 1;
    } catch {
      /* sumiu no meio */
    }
  }
  return removed;
}
