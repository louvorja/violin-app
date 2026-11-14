/**
 * Arquivos escolhidos num item da liturgia.
 *
 * Desktop: o arquivo é copiado para `<acervo>/liturgy-files/<id>/` e o registro
 * guarda só o caminho relativo. Web: os bytes ficam no IndexedDB como `Blob`,
 * limitados a 500 MB. Nos dois casos o item aponta para o `ref_id` do registro.
 *
 * @category helper-puro — sem Vue; usa IndexedDB e IPC.
 */
import $idb from "@/helpers/IndexedDB";
import { DB_TABLE } from "@/constants/DbTables";
import { AUDIO_EXT, IMAGE_EXT, VIDEO_EXT } from "@/constants/FileTypes";
import { ensureRenderableImage } from "@/helpers/ImageConvert";
import { fetchWithTimeout, NET_TIMEOUT } from "@/helpers/Http";
import Path from "@/helpers/Path";
import Platform from "@/helpers/Platform";
import { blobOf } from "@/helpers/Bytes";
import {
  storeLibraryStream,
  removeLibraryFile,
  libraryFileInfo,
  openOpfsLibraryFile,
} from "@/helpers/LibraryFiles";
import { assertFileFits, assertWebQuota } from "@/helpers/StorageLimits";

type FileKind = "image" | "video" | "audio" | "pdf" | "slja";

interface LiturgyFileRecord {
  id: string;
  name: string;
  mime: string;
  size: number;
  /** Desktop: caminho relativo no acervo. */
  path?: string;
  /** Web/legado: bytes no IndexedDB. */
  data?: Blob | ArrayBuffer;
  sha256?: string;
}

/** O que a exportação precisa de um arquivo guardado. */
export interface LiturgyFileSource {
  name: string;
  mime: string;
  size: number;
  /** `null` quando o arquivo sumiu do disco. */
  open: () => Promise<ReadableStream<Uint8Array> | null>;
}

export const LITURGY_FILE_ACCEPT = [...IMAGE_EXT, ...VIDEO_EXT, ...AUDIO_EXT, "pdf", "slja"]
  .map((extension) => `.${extension}`)
  .join(",");

function kindOf(name: string): FileKind | null {
  const extension = name.split(".").pop()?.toLowerCase() || "";
  if (IMAGE_EXT.includes(extension)) return "image";
  if (VIDEO_EXT.includes(extension)) return "video";
  if (AUDIO_EXT.includes(extension)) return "audio";
  return extension === "pdf" || extension === "slja" ? extension : null;
}

export function validateLiturgyFile(file: File): void {
  if (
    !(file instanceof File) ||
    !file.name ||
    file.name.length > 255 ||
    /[\\/]/.test(file.name) ||
    file.name.includes(String.fromCharCode(0)) ||
    !Number.isSafeInteger(file.size) ||
    file.size <= 0 ||
    !kindOf(file.name)
  )
    throw new Error("unsupported_file");
  assertFileFits(file.size);
}

function recordOf(raw: unknown, id: string): Partial<LiturgyFileRecord> | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Partial<LiturgyFileRecord>;
  if (record.id !== id || typeof record.name !== "string") return null;
  if (record.name.length > 255) return null;
  if (typeof record.mime !== "string" || record.mime.length > 128) return null;
  return record;
}

/** Abre o stream de um caminho relativo/absoluto do acervo. */
async function openLocalStream(path: string): Promise<ReadableStream<Uint8Array> | null> {
  if (!path) return null;
  const response = await fetchWithTimeout(Path.media(path), {
    timeout: NET_TIMEOUT.MEDIA,
    source: "file",
  });
  if (!response.ok || !response.body) return null;
  return response.body as ReadableStream<Uint8Array>;
}

export async function importLiturgyFile(file: File): Promise<{ dir: string; ref_id: string }> {
  validateLiturgyFile(file);
  const prepared =
    kindOf(file.name) === "image"
      ? await ensureRenderableImage(file.name, file)
      : { blob: file as Blob, name: file.name };
  const stored = await storeLiturgyFileSource({
    name: prepared.name,
    mime:
      prepared.blob.type && prepared.blob.type.length <= 128
        ? prepared.blob.type
        : "application/octet-stream",
    size: prepared.blob.size,
    open: async () => prepared.blob.stream() as ReadableStream<Uint8Array>,
  });
  if (!stored.ref_id) throw new Error("file_not_stored");
  return { dir: stored.dir, ref_id: stored.ref_id };
}

/**
 * Grava um arquivo de liturgia vindo de um stream (pacote `.llja`).
 * Desktop: acervo + `path`; web: `Blob` no IndexedDB.
 */
export async function storeLiturgyFileSource(input: {
  name: string;
  mime: string;
  size: number;
  open: () => Promise<ReadableStream<Uint8Array> | null>;
}): Promise<{ dir: string; ref_id?: string; path?: string }> {
  assertFileFits(input.size);
  if (!Platform.isDesktop) await assertWebQuota(input.size);
  const id = crypto.randomUUID();
  const stored = await storeLibraryStream({
    kind: "liturgy-files",
    recordId: id,
    name: input.name,
    size: input.size,
    open: async () => {
      const stream = await input.open();
      if (!stream) throw new Error("missing_file");
      return stream;
    },
  });
  const record: LiturgyFileRecord =
    stored.mode === "path"
      ? {
          id,
          name: input.name,
          mime: input.mime,
          size: stored.size,
          path: stored.path,
          sha256: stored.sha256,
        }
      : {
          id,
          name: input.name,
          mime: input.mime,
          size: stored.size,
          data: stored.data,
        };
  await $idb.put(DB_TABLE.LITURGY_FILES, record);
  return stored.mode === "path"
    ? { dir: record.name, ref_id: id, path: stored.path }
    : { dir: record.name, ref_id: id };
}

export async function removeLiturgyFile(id: string): Promise<void> {
  const raw = await $idb.get<unknown>(DB_TABLE.LITURGY_FILES, id).catch(() => null);
  const record = recordOf(raw, id);
  if (record?.path) await removeLibraryFile(record.path);
  await $idb.del(DB_TABLE.LITURGY_FILES, id);
}

// Áudio pode continuar tocando sobre uma imagem/PDF. Conserve no máximo
// essas duas fontes, liberando a anterior somente após a troca ter sucesso.
const activeUrls = new Map<"audio" | "projection", string>();

export function releaseLiturgyFileUrl(url: string): void {
  if (!url.startsWith("blob:")) return;
  if (![...activeUrls.values()].includes(url)) URL.revokeObjectURL(url);
}

export function retainLiturgyFileUrl(url: string, slot: "audio" | "projection"): void {
  const previous = activeUrls.get(slot);
  activeUrls.set(slot, url);
  if (previous && previous !== url) releaseLiturgyFileUrl(previous);
}

/** Nome, tipo e stream de um arquivo guardado, para exportar a liturgia. */
export async function readLiturgyFile(id: string): Promise<LiturgyFileSource | null> {
  if (!/^[\da-f-]{36}$/i.test(id)) return null;
  const raw = await $idb.get<unknown>(DB_TABLE.LITURGY_FILES, id);
  const record = recordOf(raw, id);
  if (!record) return null;

  if (record.path) {
    const info = await libraryFileInfo(record.path).catch(() => null);
    if (info && !info.exists) return null;
    const size = Number(record.size);
    const opfs = await openOpfsLibraryFile(record.path as string);
    return {
      name: record.name as string,
      mime: record.mime as string,
      size: opfs?.size || (Number.isFinite(size) && size > 0 ? size : 0),
      open: opfs ? opfs.open : () => openLocalStream(record.path as string),
    };
  }

  const blob = blobOf(record.data, record.mime as string);
  if (!blob || !blob.size) return null;
  return {
    name: record.name as string,
    mime: (record.mime as string) || blob.type,
    size: blob.size,
    open: async () => blob.stream() as ReadableStream<Uint8Array>,
  };
}

/** Recria a URL a cada sessão; nunca salva blob URLs na liturgia. */
export async function resolveLiturgyFile(
  id: string
): Promise<{ url: string; name: string; kind: FileKind } | null> {
  if (!/^[\da-f-]{36}$/i.test(id)) return null;
  const raw = await $idb.get<unknown>(DB_TABLE.LITURGY_FILES, id);
  const record = recordOf(raw, id);
  if (!record) return null;
  const kind = kindOf(record.name as string);
  if (!kind) return null;

  if (record.path) {
    // Caminho do acervo: se o arquivo sumiu, o item não pode "projetar" uma
    // URL que só vai dar 404 — o chamador mostra o aviso de arquivo ausente.
    const info = await libraryFileInfo(record.path).catch(() => null);
    if (info && !info.exists) return null;
    return { url: Path.media(record.path as string), name: record.name as string, kind };
  }

  const blob = blobOf(record.data, record.mime as string);
  if (!blob || !blob.size) return null;
  return {
    url: URL.createObjectURL(blob),
    name: record.name as string,
    kind,
  };
}
