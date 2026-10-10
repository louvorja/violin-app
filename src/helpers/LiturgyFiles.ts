/** Arquivos escolhidos na liturgia web: bytes no IndexedDB, referência leve no item. */
import $idb from "@/helpers/IndexedDB";
import { DB_TABLE } from "@/constants/DbTables";
import { AUDIO_EXT, IMAGE_EXT, VIDEO_EXT } from "@/constants/FileTypes";
import { ensureRenderableImage } from "@/helpers/ImageConvert";

type FileKind = "image" | "video" | "audio" | "pdf" | "slja";
interface LiturgyFileRecord {
  id: string;
  name: string;
  mime: string;
  data: ArrayBuffer;
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
}

export async function importLiturgyFile(file: File): Promise<{ dir: string; ref_id: string }> {
  validateLiturgyFile(file);
  const estimate = await navigator.storage?.estimate?.().catch(() => undefined);
  if (estimate?.quota !== undefined && file.size > estimate.quota - (estimate.usage || 0)) {
    throw new Error("storage_full");
  }
  const id = crypto.randomUUID();
  const prepared =
    kindOf(file.name) === "image"
      ? await ensureRenderableImage(file.name, file)
      : { blob: file, name: file.name };
  const record: LiturgyFileRecord = {
    id,
    name: prepared.name,
    mime:
      prepared.blob.type && prepared.blob.type.length <= 128
        ? prepared.blob.type
        : "application/octet-stream",
    data: await prepared.blob.arrayBuffer(),
  };
  await $idb.put(DB_TABLE.LITURGY_FILES, record);
  return { dir: record.name, ref_id: id };
}

export async function removeLiturgyFile(id: string): Promise<void> {
  await $idb.del(DB_TABLE.LITURGY_FILES, id);
}

// Áudio pode continuar tocando sobre uma imagem/PDF. Conserve no máximo
// essas duas fontes, liberando a anterior somente após a troca ter sucesso.
const activeUrls = new Map<"audio" | "projection", string>();

export function releaseLiturgyFileUrl(url: string): void {
  if (![...activeUrls.values()].includes(url)) URL.revokeObjectURL(url);
}

export function retainLiturgyFileUrl(url: string, slot: "audio" | "projection"): void {
  const previous = activeUrls.get(slot);
  activeUrls.set(slot, url);
  if (previous && previous !== url) releaseLiturgyFileUrl(previous);
}

/** Recria a URL a cada sessão; nunca salva blob URLs na liturgia. */
export async function resolveLiturgyFile(
  id: string
): Promise<{ url: string; name: string; kind: FileKind } | null> {
  if (!/^[\da-f-]{36}$/i.test(id)) return null;
  const raw = await $idb.get<unknown>(DB_TABLE.LITURGY_FILES, id);
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Partial<LiturgyFileRecord>;
  if (
    record.id !== id ||
    typeof record.name !== "string" ||
    record.name.length > 255 ||
    typeof record.mime !== "string" ||
    !record.mime ||
    record.mime.length > 128 ||
    !(record.data instanceof ArrayBuffer) ||
    !record.data.byteLength
  )
    return null;
  const kind = kindOf(record.name);
  if (!kind) return null;
  const url = URL.createObjectURL(new Blob([record.data], { type: record.mime }));
  return { url, name: record.name, kind };
}
