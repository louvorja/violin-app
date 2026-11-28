/**
 * Junta, para a exportação, os arquivos que a liturgia usa: os dos itens do
 * tipo arquivo (sempre) e, conforme as opções, os da Biblioteca de Mídia, do
 * Som de Fundo e da Projeção de Fundo usados pela liturgia.
 *
 * A coleta não lê bytes: devolve `PackageEntry` com tamanho e um `open()` que
 * só então abre o stream. O acesso ao IndexedDB e ao disco entra por `deps`,
 * para os testes não precisarem de nenhum dos dois.
 */
import { LiturgyItemTypeEnum } from "@/enums/LiturgyItemTypeEnum";
import { isBundledLiturgicalId } from "@/config/LiturgicalAudios";
import { DB_TABLE } from "@/constants/DbTables";
import type { LiturgyItem } from "@/types/Liturgy";
import { blobOf } from "@/helpers/Bytes";
import { extensionForMime } from "@/helpers/Mime";
import type { FileSource, PackageEntry } from "./format";

export interface ExportOptions {
  /** Arquivos da Biblioteca de Mídia que a liturgia usa. */
  media: boolean;
  /** Áudios do Som de Fundo que a liturgia usa. */
  backgroundSound: boolean;
  /** Imagens e vídeos da Projeção de Fundo que a liturgia usa. */
  backgroundProjection: boolean;
}

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  media: true,
  backgroundSound: true,
  backgroundProjection: true,
};

export interface ExportCounts {
  liturgy: number;
  media: number;
  backgroundSound: number;
  backgroundProjection: number;
}

/** Registro de biblioteca como está no IndexedDB (os campos que interessam aqui). */
export interface LibraryRecord {
  id: string;
  name?: string;
  fileName?: string;
  path?: string;
  data?: ArrayBuffer | ArrayBufferView | Blob;
  mime?: string;
}

/** Arquivo que mora no disco, aberto sob demanda. */
export interface LocalFile {
  size: number;
  open: () => Promise<ReadableStream<Uint8Array> | null>;
}

export interface CollectDeps {
  get: (_table: string, _id: string) => Promise<LibraryRecord | undefined>;
  /** Arquivo que o item de arquivo guardou no app (`ref_id`). */
  readLiturgyFile: (_id: string) => Promise<{
    name: string;
    mime: string;
    size: number;
    open: () => Promise<ReadableStream<Uint8Array> | null>;
  } | null>;
  /** Arquivo do disco (desktop) ou `louvorja://`; `null` se não der para ler. */
  readLocal: (_path: string) => Promise<LocalFile | null>;
}

export interface CollectResult {
  files: PackageEntry[];
  /** Itens cujo arquivo não foi achado — vão sem ele. */
  missing: string[];
  /** Itens que dependem de algo que só existe neste computador e não vai no pacote. */
  localOnly: string[];
}

const URL_SCHEME = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//;

/**
 * Item do tipo arquivo que aponta para algo guardado no aparelho (e não para um
 * endereço da internet, que continua valendo no outro computador).
 */
export function carriesFile(item: LiturgyItem): boolean {
  if (item.tipo !== LiturgyItemTypeEnum.ARQUIVO) return false;
  if (item.ref_id) return true;
  const dir = item.dir || "";
  if (!dir) return false;
  if (/^louvorja:\/\/local\//i.test(dir)) return true;
  return !URL_SCHEME.test(dir) && !/^(blob|data):/i.test(dir);
}

function displayName(item: LiturgyItem): string {
  return (item.item || item.subitem || item.dir || item.tipo || "").trim();
}

/** Item que aponta para uma biblioteca: de qual tabela, com que origem e qual opção o leva. */
const LIBRARY_OF: Record<
  string,
  {
    table: string;
    source: FileSource;
    option: "media" | "backgroundSound" | "backgroundProjection";
  }
> = {
  [LiturgyItemTypeEnum.MEDIA_LIBRARY]: {
    table: DB_TABLE.MEDIA_LIBRARY,
    source: "media",
    option: "media",
  },
  [LiturgyItemTypeEnum.BG_SOUND]: {
    table: DB_TABLE.BACKGROUND_SOUND_LIBRARY,
    source: "background-sound",
    option: "backgroundSound",
  },
  [LiturgyItemTypeEnum.BG_PROJECTION]: {
    table: DB_TABLE.BACKGROUND_PROJECTION_LIBRARY,
    source: "background-projection",
    option: "backgroundProjection",
  },
};

function refsOf(items: LiturgyItem[], tipo: string): Set<string> {
  const ids = new Set<string>();
  for (const item of items) if (item.tipo === tipo && item.ref_id) ids.add(item.ref_id);
  return ids;
}

/** Quantos arquivos cada opção leva — para a janela de exportação. */
export function countExport(items: LiturgyItem[]): ExportCounts {
  const liturgy = new Set(items.filter(carriesFile).map((i) => i.ref_id || i.id)).size;
  return {
    liturgy,
    media: refsOf(items, LiturgyItemTypeEnum.MEDIA_LIBRARY).size,
    backgroundSound: refsOf(items, LiturgyItemTypeEnum.BG_SOUND).size,
    backgroundProjection: refsOf(items, LiturgyItemTypeEnum.BG_PROJECTION).size,
  };
}

function baseName(path: string): string {
  try {
    return decodeURIComponent(path.split(/[?#]/)[0].split(/[\\/]/).pop() || "");
  } catch {
    return path.split(/[?#]/)[0].split(/[\\/]/).pop() || "";
  }
}

/**
 * Nome com extensão: o operador pode ter renomeado o item na biblioteca ("Abertura"),
 * e quem importa precisa da extensão para saber o tipo.
 */
export function nameWithExtension(name: string, path: string, mime: string): string {
  const clean = (name || "").trim();
  if (/\.[a-z\d]{2,5}$/i.test(clean)) return clean;
  const fromPath = baseName(path || "").match(/\.([a-z\d]{2,5})$/i)?.[1];
  const ext = fromPath || extensionForMime(mime, "");
  const base = clean || baseName(path || "").replace(/\.[^.]*$/, "") || "arquivo";
  return ext ? `${base}.${ext}` : base;
}

/** Bytes guardados no registro, em qualquer uma das formas que o IDB devolve. */
function storedBytes(data: unknown, mime: string): { size: number; blob: Blob } | null {
  const blob = blobOf(data, mime);
  return blob && blob.size ? { size: blob.size, blob } : null;
}

/** Bytes de um registro de biblioteca: guardados no IndexedDB ou no disco. */
async function bytesOf(
  record: LibraryRecord,
  deps: CollectDeps
): Promise<{ size: number; open: () => Promise<ReadableStream<Uint8Array> | null> } | null> {
  const mime = record.mime || "";
  const stored = storedBytes(record.data, mime);
  if (stored) {
    return {
      size: stored.size,
      open: async () => stored.blob.stream() as ReadableStream<Uint8Array>,
    };
  }
  const path = record.path || "";
  // Blob de outra sessão sem bytes guardados, ou endereço da internet: não há o que levar.
  if (!path || /^(blob|data|https?):/i.test(path)) return null;
  return deps.readLocal(path);
}

async function fromLibrary(
  source: FileSource,
  record: LibraryRecord,
  deps: CollectDeps
): Promise<PackageEntry | null> {
  const data = await bytesOf(record, deps).catch(() => null);
  if (!data || !data.size) return null;
  const mime = record.mime || "";
  return {
    source,
    sourceId: record.id,
    name: nameWithExtension(record.fileName || record.name || "", record.path || "", mime),
    mime,
    size: data.size,
    open: data.open,
  };
}

async function fromLiturgyItem(item: LiturgyItem, deps: CollectDeps): Promise<PackageEntry | null> {
  if (item.ref_id) {
    const stored = await deps.readLiturgyFile(item.ref_id).catch(() => null);
    if (!stored || !stored.size) return null;
    return {
      source: "liturgy",
      sourceId: item.ref_id,
      name: nameWithExtension(stored.name, item.dir || "", stored.mime),
      mime: stored.mime || "",
      size: stored.size,
      open: stored.open,
    };
  }
  const dir = item.dir || "";
  const data = await deps.readLocal(dir).catch(() => null);
  if (!data || !data.size) return null;
  return {
    source: "liturgy",
    sourceId: item.id,
    name: nameWithExtension(baseName(dir), dir, ""),
    mime: "",
    size: data.size,
    open: data.open,
  };
}

export async function collectFiles(
  items: LiturgyItem[],
  options: ExportOptions,
  deps: CollectDeps
): Promise<CollectResult> {
  const files: PackageEntry[] = [];
  const missing: string[] = [];
  const localOnly: string[] = [];
  const done = new Map<string, boolean>();

  /** Lê cada origem uma vez, mesmo com vários itens apontando para ela. */
  async function once(key: string, load: () => Promise<PackageEntry | null>): Promise<boolean> {
    if (done.has(key)) return done.get(key) as boolean;
    const file = await load().catch(() => null);
    if (file) files.push(file);
    done.set(key, !!file);
    return !!file;
  }

  for (const item of items) {
    switch (item.tipo) {
      case LiturgyItemTypeEnum.ARQUIVO:
        if (!carriesFile(item)) break;
        if (!(await once(`liturgy:${item.ref_id || item.id}`, () => fromLiturgyItem(item, deps))))
          missing.push(displayName(item));
        break;
      case LiturgyItemTypeEnum.MEDIA_LIBRARY:
      case LiturgyItemTypeEnum.BG_SOUND:
      case LiturgyItemTypeEnum.BG_PROJECTION: {
        const lib = LIBRARY_OF[item.tipo];
        if (!options[lib.option]) {
          localOnly.push(displayName(item));
          break;
        }
        const refId = item.ref_id;
        if (!refId) {
          missing.push(displayName(item));
          break;
        }
        // Áudio litúrgico: vem com todo programa, o pacote não precisa levar.
        if (isBundledLiturgicalId(refId)) break;
        const { table, source } = lib;
        const ok = await once(`${source}:${refId}`, async () => {
          const record = await deps.get(table, refId);
          return record ? fromLibrary(source, record, deps) : null;
        });
        if (!ok) missing.push(displayName(item));
        break;
      }
      case LiturgyItemTypeEnum.MUSICA:
        // Música personalizada: mora nas coleções deste computador.
        if (item.ref_id || (item.id_music ?? item.musica) < -1) localOnly.push(displayName(item));
        break;
      case LiturgyItemTypeEnum.ANUNCIOS:
      case LiturgyItemTypeEnum.OVERLAY:
        localOnly.push(displayName(item));
        break;
    }
  }

  return { files, missing, localOnly };
}
