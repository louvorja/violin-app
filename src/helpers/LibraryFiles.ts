/**
 * Ponte do renderer com as pastas de arquivos das bibliotecas no acervo.
 *
 * No desktop os bytes vão para o disco pelo main (`libraryFiles:*`), em
 * streaming, e o registro guarda só o caminho relativo. No navegador não há
 * acervo: os bytes ficam no IndexedDB como `Blob`, limitados a 500 MB.
 *
 * Quem chama não precisa saber a diferença: recebe `mode: "path"` ou
 * `mode: "blob"` e grava o que vier no registro.
 *
 * @category helper-puro — sem Vue; usa IPC só no desktop.
 */
import Platform from "@/helpers/Platform";
import { assertFileFits, assertWebQuota, MAX_WEB_FILE_BYTES } from "@/helpers/StorageLimits";
import { blobFromStream } from "@/helpers/Bytes";
import { mimeForName } from "@/helpers/Mime";
import { createHashTap, hashBlob } from "@/helpers/Hash";
import {
  isOpfsPath,
  isOpfsRel,
  isOpfsSupported,
  listOpfs,
  opfsActive,
  opfsInfo,
  opfsPathOf,
  readOpfsFile,
  relOf,
  removeOpfs,
  safeStorageName,
  writeOpfsStream,
} from "@/helpers/OpfsStore";

/**
 * Até esse tamanho o hash é calculado junto com a escrita (sem leitura extra).
 * Acima, o OPFS é lido de novo em um Web Worker para não travar a UI.
 */
const HASH_MAX_BYTES = 512 * 1024 ** 2;

const MANAGED_RE =
  /^(media-library|background-projection|background-sound|liturgy-files)\/[A-Za-z0-9][A-Za-z0-9_-]{0,63}\/[^/\\]+$/;
const MANAGED_TAIL_RE =
  /(?:^|\/)((?:media-library|background-projection|background-sound|liturgy-files)\/[^/]+\/[^/]+)$/;

export interface StoredPath {
  mode: "path";
  path: string;
  name: string;
  size: number;
  sha256?: string;
}

export type StoredFile = StoredPath | { mode: "blob"; data: Blob; name: string; size: number };

/** Caminho relativo que pertence a uma das pastas gerenciadas do acervo. */
export function isManagedLibraryPath(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const raw = value.startsWith("opfs:") ? value.slice(5) : value;
  return MANAGED_RE.test(raw.replace(/\\/g, "/"));
}

/**
 * Extrai o caminho relativo mesmo de um valor absoluto/URL antigo
 * (`.../media-library/<id>/<nome>`). Registros antigos podem ter guardado o
 * caminho completo; o prune precisa reconhecê-los para não apagar o arquivo.
 */
export function managedLibraryRel(value: unknown): string | null {
  if (typeof value !== "string" || !value || value.includes("\0")) return null;
  const raw = (value.startsWith("opfs:") ? value.slice(5) : value).replace(/\\/g, "/");
  if (MANAGED_RE.test(raw)) return raw;
  const tail = raw.match(MANAGED_TAIL_RE);
  return tail ? tail[1] : null;
}

function api() {
  return Platform.api as LouvorjaApi | null;
}

/** Copia um arquivo já existente no disco para o acervo (só desktop). */
export async function storeLibraryPath(
  kind: LibraryFileKind,
  recordId: string,
  sourcePath: string
): Promise<StoredPath> {
  const desktop = api()?.libraryFiles;
  if (!Platform.isDesktop || !desktop) throw new Error("unsupported_platform");
  const stored = await desktop.storePath({ kind, recordId, sourcePath });
  return { mode: "path", ...stored };
}

/**
 * Grava bytes de um stream no acervo (desktop) ou no IndexedDB (web).
 *
 * `size` é obrigatório: é o que permite recusar antes de começar e conferir
 * se o stream entregou tudo. O stream é consumido uma única vez.
 */
export async function storeLibraryStream(input: {
  kind: LibraryFileKind;
  recordId: string;
  name: string;
  size: number;
  open: () => Promise<ReadableStream<Uint8Array>>;
}): Promise<StoredFile> {
  assertFileFits(input.size);
  const stream = await input.open();
  if (!stream) throw new Error("missing_file");

  if (!Platform.isDesktop) {
    if (opfsActive()) {
      await assertWebQuota(input.size);
      const rel = `${input.kind}/${input.recordId}/${safeStorageName(input.name)}`;
      try {
        const tap = input.size <= HASH_MAX_BYTES ? createHashTap(stream) : null;
        const size = await writeOpfsStream(rel, tap?.stream ?? stream, input.size);
        let digest = tap?.digest();
        if (!tap) {
          const file = await readOpfsFile(rel).catch(() => null);
          digest = (file ? await hashBlob(file) : null) ?? undefined;
        }
        return {
          mode: "path",
          path: opfsPathOf(rel),
          name: input.name,
          size,
          ...(digest ? { sha256: digest } : {}),
        };
      } catch (error) {
        // OPFS pode falhar por cota/permissão. Até 500 MB ainda cabe no IDB;
        // acima disso não há fallback possível. O stream já foi consumido,
        // então o fallback abre outro (Blob/File e entradas do ZIP permitem).
        if (input.size > MAX_WEB_FILE_BYTES) throw error;
        console.warn("[OPFS] gravação falhou; usando IndexedDB:", error);
        const retry = await input.open();
        if (!retry) throw error;
        await assertWebQuota(input.size);
        const data = await blobFromStream(retry, {
          expectedSize: input.size,
          maxBytes: MAX_WEB_FILE_BYTES,
          mime: mimeForName(input.name),
        });
        return { mode: "blob", data, name: input.name, size: data.size };
      }
    }
    await assertWebQuota(input.size);
    if (input.size > MAX_WEB_FILE_BYTES) throw new Error("too_large");
    const data = await blobFromStream(stream, {
      expectedSize: input.size,
      maxBytes: MAX_WEB_FILE_BYTES,
      mime: mimeForName(input.name),
    });
    return { mode: "blob", data, name: input.name, size: data.size };
  }

  const desktop = api()?.libraryFiles;
  if (!desktop) throw new Error("unsupported_platform");
  const { token } = await desktop.begin({
    kind: input.kind,
    recordId: input.recordId,
    name: input.name,
    size: input.size,
  });
  const reader = stream.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      await desktop.write(token, value);
    }
    const stored = await desktop.end(token);
    return { mode: "path", ...stored };
  } catch (error) {
    await desktop.abort(token).catch(() => {});
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}

/** Apaga o arquivo físico de um registro. Ignora blob/URL e caminho legado. */
export async function removeLibraryFile(value: unknown): Promise<void> {
  if (typeof value !== "string") return;
  if (isOpfsPath(value)) {
    await removeOpfs(relOf(value)).catch(() => {});
    return;
  }
  if (!Platform.isDesktop || !isManagedLibraryPath(value)) return;
  await api()
    ?.libraryFiles?.remove(value)
    .catch(() => {});
}

/** Existe? `size` e `mtime` quando o arquivo é conhecido. */
export async function libraryFileInfo(
  value: unknown
): Promise<{ exists: boolean; size: number; mtimeMs?: number }> {
  if (isOpfsPath(value)) return opfsInfo(relOf(value));
  if (Platform.isDesktop && typeof value === "string" && isManagedLibraryPath(value)) {
    const info = await api()
      ?.libraryFiles?.info(value)
      .catch(() => null);
    return info ?? { exists: true, size: 0 };
  }
  // Blob/URL de sessão ou caminho legado: não dá para conferir sem abrir.
  return { exists: true, size: 0 };
}

/** Stream de um arquivo OPFS (para exportar/backup). */
export async function openOpfsLibraryFile(
  value: string
): Promise<{ size: number; open: () => Promise<ReadableStream<Uint8Array>> } | null> {
  if (!isOpfsPath(value)) return null;
  const file = await readOpfsFile(relOf(value));
  if (!file) return null;
  return {
    size: file.size,
    open: async () => file.stream() as ReadableStream<Uint8Array>,
  };
}

/**
 * Remove arquivos de biblioteca sem registro correspondente.
 *
 * Desktop: o main faz a varredura e só apaga dentro das quatro pastas.
 * Web: compara o OPFS com os caminhos conhecidos. Arquivos com menos de 24 h
 * ficam, para não apagar uma importação em andamento.
 */
export async function pruneLibraryFiles(knownPaths: string[]): Promise<number> {
  const normalized = knownPaths
    .map((value) => managedLibraryRel(value))
    .filter((value): value is string => !!value && isOpfsRel(value));
  if (Platform.isDesktop) {
    const result = await api()
      ?.libraryFiles?.prune(normalized)
      .catch(() => null);
    return result?.removed ?? 0;
  }
  if (!isOpfsSupported()) return 0;
  const known = new Set(normalized);
  let removed = 0;
  for (const entry of await listOpfs()) {
    if (known.has(entry.rel)) continue;
    if (Date.now() - entry.mtimeMs < 24 * 60 * 60 * 1000) continue;
    if (await removeOpfs(entry.rel).catch(() => false)) removed += 1;
  }
  return removed;
}
