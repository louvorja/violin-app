/**
 * Junta, para a exportação, os arquivos que a liturgia usa: os dos itens do
 * tipo arquivo (sempre) e, conforme as opções, os da Biblioteca de Mídia, do
 * Som de Fundo e a biblioteca inteira da Projeção de Fundo.
 *
 * O acesso ao IndexedDB e ao disco entra por `deps`, para os testes não
 * precisarem de nenhum dos dois.
 */
import { LiturgyItemTypeEnum } from "@/enums/LiturgyItemTypeEnum";
import { DB_TABLE } from "@/constants/DbTables";
import type { LiturgyItem } from "@/types/Liturgy";
import type { FileSource, PackageFile } from "./format";

export interface ExportOptions {
  /** Arquivos da Biblioteca de Mídia que a liturgia usa. */
  media: boolean;
  /** Áudios do Som de Fundo que a liturgia usa. */
  backgroundSound: boolean;
  /** A biblioteca inteira da Projeção de Fundo (a liturgia ainda não aponta para ela). */
  backgroundProjection: boolean;
}

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  media: true,
  backgroundSound: true,
  backgroundProjection: false,
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

export interface CollectDeps {
  get: (_table: string, _id: string) => Promise<LibraryRecord | undefined>;
  getAll: (_table: string) => Promise<LibraryRecord[]>;
  /** Arquivo que o item de arquivo guardou no app (`ref_id`). */
  readLiturgyFile: (_id: string) => Promise<{ name: string; data: Blob } | null>;
  /** Arquivo do disco (desktop) ou `louvorja://`; `null` se não der para ler. */
  readLocal: (_path: string) => Promise<Blob | null>;
}

export interface CollectResult {
  files: PackageFile[];
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

function refsOf(items: LiturgyItem[], tipo: string): Set<string> {
  const ids = new Set<string>();
  for (const item of items) if (item.tipo === tipo && item.ref_id) ids.add(item.ref_id);
  return ids;
}

/** Quantos arquivos cada opção leva — para a janela de exportação. */
export async function countExport(
  items: LiturgyItem[],
  getAll: CollectDeps["getAll"]
): Promise<ExportCounts> {
  const liturgy = new Set(items.filter(carriesFile).map((i) => i.ref_id || i.id)).size;
  let backgroundProjection = 0;
  try {
    backgroundProjection = (await getAll(DB_TABLE.BACKGROUND_PROJECTION_LIBRARY)).length;
  } catch {
    backgroundProjection = 0;
  }
  return {
    liturgy,
    media: refsOf(items, LiturgyItemTypeEnum.MEDIA_LIBRARY).size,
    backgroundSound: refsOf(items, LiturgyItemTypeEnum.BG_SOUND).size,
    backgroundProjection,
  };
}

function baseName(path: string): string {
  try {
    return decodeURIComponent(path.split(/[?#]/)[0].split(/[\\/]/).pop() || "");
  } catch {
    return path.split(/[?#]/)[0].split(/[\\/]/).pop() || "";
  }
}

const MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "audio/mpeg": "mp3",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
  "application/pdf": "pdf",
};

/**
 * Nome com extensão: o operador pode ter renomeado o item na biblioteca ("Abertura"),
 * e quem importa precisa da extensão para saber o tipo.
 */
export function nameWithExtension(name: string, path: string, mime: string): string {
  const clean = (name || "").trim();
  if (/\.[a-z\d]{2,5}$/i.test(clean)) return clean;
  const fromPath = baseName(path || "").match(/\.([a-z\d]{2,5})$/i)?.[1];
  const ext = fromPath || MIME_EXT[(mime || "").toLowerCase()];
  const base = clean || baseName(path || "").replace(/\.[^.]*$/, "") || "arquivo";
  return ext ? `${base}.${ext}` : base;
}

/**
 * Bytes guardados no registro. O IndexedDB devolve `ArrayBuffer` (às vezes um
 * `Uint8Array`), e de outro "realm" o `instanceof` falha — daí a checagem pela
 * marca do objeto.
 */
function storedBytes(data: unknown, mime: string): Blob | null {
  if (!data) return null;
  if (typeof Blob !== "undefined" && data instanceof Blob) return data.size ? data : null;
  const tag = Object.prototype.toString.call(data);
  if (tag === "[object ArrayBuffer]") {
    const buffer = data as ArrayBuffer;
    return buffer.byteLength ? new Blob([buffer], { type: mime }) : null;
  }
  if (ArrayBuffer.isView(data)) {
    const view = data as ArrayBufferView;
    return view.byteLength ? new Blob([view as BlobPart], { type: mime }) : null;
  }
  return null;
}

/** Bytes de um registro de biblioteca: guardados no IndexedDB ou no disco. */
async function bytesOf(record: LibraryRecord, deps: CollectDeps): Promise<Blob | null> {
  const mime = record.mime || "";
  const stored = storedBytes(record.data, mime);
  if (stored) return stored;
  const path = record.path || "";
  // Blob de outra sessão sem bytes guardados, ou endereço da internet: não há o que levar.
  if (!path || /^(blob|data|https?):/i.test(path)) return null;
  return deps.readLocal(path);
}

async function fromLibrary(
  source: FileSource,
  record: LibraryRecord,
  deps: CollectDeps
): Promise<PackageFile | null> {
  const data = await bytesOf(record, deps).catch(() => null);
  if (!data || !data.size) return null;
  const mime = record.mime || data.type || "";
  return {
    source,
    sourceId: record.id,
    name: nameWithExtension(record.fileName || record.name || "", record.path || "", mime),
    mime,
    data,
  };
}

async function fromLiturgyItem(item: LiturgyItem, deps: CollectDeps): Promise<PackageFile | null> {
  if (item.ref_id) {
    const stored = await deps.readLiturgyFile(item.ref_id).catch(() => null);
    if (!stored || !stored.data.size) return null;
    return {
      source: "liturgy",
      sourceId: item.ref_id,
      name: nameWithExtension(stored.name, item.dir || "", stored.data.type),
      mime: stored.data.type || "",
      data: stored.data,
    };
  }
  const dir = item.dir || "";
  const data = await deps.readLocal(dir).catch(() => null);
  if (!data || !data.size) return null;
  return {
    source: "liturgy",
    sourceId: item.id,
    name: nameWithExtension(baseName(dir), dir, data.type),
    mime: data.type || "",
    data,
  };
}

export async function collectFiles(
  items: LiturgyItem[],
  options: ExportOptions,
  deps: CollectDeps
): Promise<CollectResult> {
  const files: PackageFile[] = [];
  const missing: string[] = [];
  const localOnly: string[] = [];
  const done = new Map<string, boolean>();

  /** Lê cada origem uma vez, mesmo com vários itens apontando para ela. */
  async function once(key: string, load: () => Promise<PackageFile | null>): Promise<boolean> {
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
      case LiturgyItemTypeEnum.BG_SOUND: {
        const isMedia = item.tipo === LiturgyItemTypeEnum.MEDIA_LIBRARY;
        if (!(isMedia ? options.media : options.backgroundSound)) {
          localOnly.push(displayName(item));
          break;
        }
        const refId = item.ref_id;
        if (!refId) {
          missing.push(displayName(item));
          break;
        }
        const table = isMedia ? DB_TABLE.MEDIA_LIBRARY : DB_TABLE.BACKGROUND_SOUND_LIBRARY;
        const source: FileSource = isMedia ? "media" : "background-sound";
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

  if (options.backgroundProjection) {
    const all = await deps.getAll(DB_TABLE.BACKGROUND_PROJECTION_LIBRARY).catch(() => []);
    for (const record of all) {
      if (!record?.id) continue;
      await once(`background-projection:${record.id}`, () =>
        fromLibrary("background-projection", record, deps)
      );
    }
  }

  return { files, missing, localOnly };
}
