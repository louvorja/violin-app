/**
 * Importação do pacote: grava os arquivos nas bibliotecas deste computador e
 * troca, nos itens, as referências de origem pelas novas.
 *
 * - Arquivo da liturgia que é imagem, vídeo, áudio ou PDF vira UMA cópia na
 *   Biblioteca de Mídia (categoria "Importados") e o item passa a ser da
 *   biblioteca; `.slja` continua item de arquivo, guardado como antes.
 * - Biblioteca de Mídia, Som de Fundo e Projeção de Fundo: registros novos, na
 *   categoria "Importados" de cada uma, e `ref_id` trocado.
 * - Referência que não veio no pacote e não existe aqui: o item fica, sem a
 *   referência, para o operador escolher de novo.
 * - Link do YouTube (vídeo online, ou site com link do YouTube) entra na lista
 *   de Vídeos Online, sem duplicar.
 *
 * Nada é gravado na liturgia aqui: quem chama grava por último e, se falhar,
 * chama `rollback()` para apagar o que foi criado — registros **e** arquivos
 * físicos.
 */
import { LiturgyItemTypeEnum } from "@/enums/LiturgyItemTypeEnum";
import { DB_TABLE } from "@/constants/DbTables";
import { ICONS } from "@/config/Icons";
import { videoIdFromUrl } from "@/helpers/OnlineVideo";
import { blobFromStream } from "@/helpers/Bytes";
import { hashStream } from "@/helpers/Hash";
import type { StoredFile } from "@/helpers/LibraryFiles";
import { isHeic, ensureRenderableImage } from "@/helpers/ImageConvert";
import type { LiturgyItem } from "@/types/Liturgy";
import type { FileSource, PackageEntry } from "./format";
import { pointsIntoPackage } from "./classic";
import {
  buildLibraryRecord,
  mediaKindOf,
  mimeMatches,
  recordSize,
  sameContent,
  type MediaKind,
} from "./library-record";

/** Id fixo da categoria "Importados": reaproveitada nas próximas importações. */
export const IMPORTED_CATEGORY_ID = "importados";
const IMPORTED_CATEGORY_COLOR = "#64748B";
/** HEIC é imagem: converter acima disso é sinal de pacote adulterado. */
const MAX_HEIC_BYTES = 200 * 1024 ** 2;
/** Acima disso, não vale travar a UI com hash antes de gravar. */
const PREHASH_LIMIT = 64 * 1024 ** 2;

export interface InstallDeps {
  get: (_table: string, _id: string) => Promise<unknown>;
  getAll: (_table: string) => Promise<unknown[]>;
  put: (_table: string, _record: Record<string, unknown>) => Promise<unknown>;
  del: (_table: string, _id: string) => Promise<unknown>;
  /** Guarda um `.slja` como arquivo da liturgia. */
  storeLiturgyFile: (input: {
    name: string;
    mime: string;
    size: number;
    open: () => Promise<ReadableStream<Uint8Array> | null>;
  }) => Promise<{ dir: string; ref_id?: string; path?: string }>;
  removeLiturgyFile: (_id: string) => Promise<unknown>;
  /** Grava bytes numa biblioteca: caminho no desktop, Blob no web. */
  storeLibraryFile: (input: {
    source: Exclude<FileSource, "liturgy">;
    recordId: string;
    name: string;
    mime: string;
    size: number;
    open: () => Promise<ReadableStream<Uint8Array> | null>;
  }) => Promise<StoredFile>;
  /** Remove um arquivo físico criado por esta importação. */
  removeStoredFile: (_value: unknown) => Promise<unknown>;
  /** Nome da categoria "Importados" no idioma do operador. */
  importedCategoryName: string;
  newId?: () => string;
  now?: () => number;
}

export interface InstallResult {
  items: LiturgyItem[];
  /** Arquivos gravados nas bibliotecas. */
  stored: number;
  /** Itens que ficaram sem o arquivo (não veio no pacote ou não deu para guardar). */
  missing: string[];
  /** Arquivos de tipo que nenhuma biblioteca aceita. */
  unsupported: string[];
  /** Vídeos do YouTube que entraram na lista agora — para iniciar o download. */
  youtube: { id: string; name: string }[];
  /** Apaga tudo o que esta importação criou. */
  rollback: () => Promise<void>;
}

const LIBRARY: Record<Exclude<FileSource, "liturgy">, { table: string; category: string }> = {
  media: { table: DB_TABLE.MEDIA_LIBRARY, category: DB_TABLE.MEDIA_LIBRARY_CATEGORY },
  "background-sound": {
    table: DB_TABLE.BACKGROUND_SOUND_LIBRARY,
    category: DB_TABLE.BACKGROUND_SOUND_CATEGORY,
  },
  "background-projection": {
    table: DB_TABLE.BACKGROUND_PROJECTION_LIBRARY,
    category: DB_TABLE.BACKGROUND_PROJECTION_CATEGORIES,
  },
};

function fold(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
}

/** Caminho de arquivo do aparelho (não é URL de rede nem blob da sessão). */
function isLocalSource(path: string | undefined): boolean {
  return !!path && !/^(https?:|data:|blob:)/i.test(path);
}

function displayName(item: LiturgyItem): string {
  return (item.item || item.subitem || item.dir || item.tipo || "").trim();
}

export async function installPackage(
  items: LiturgyItem[],
  files: PackageEntry[],
  deps: InstallDeps
): Promise<InstallResult> {
  const newId = deps.newId ?? (() => crypto.randomUUID());
  const now = deps.now ?? (() => Date.now());
  const created: [string, string][] = [];
  const liturgyFiles: string[] = [];
  const storedPaths: unknown[] = [];
  const missing: string[] = [];
  const unsupported: string[] = [];
  const youtube: { id: string; name: string }[] = [];
  let stored = 0;

  const byKey = new Map<string, PackageEntry>();
  for (const f of files) byKey.set(`${f.source}:${f.sourceId}`, f);

  async function rollback(): Promise<void> {
    for (const id of liturgyFiles.splice(0)) await deps.removeLiturgyFile(id).catch(() => {});
    for (const value of storedPaths.splice(0)) await deps.removeStoredFile(value).catch(() => {});
    for (const [table, id] of created.splice(0).reverse())
      await deps.del(table, id).catch(() => {});
  }

  try {
    const categories = new Map<string, string>();
    /** Categoria "Importados" da tabela: a que já existe (pelo id ou pelo nome) ou uma nova. */
    async function importedCategory(table: string): Promise<string> {
      const known = categories.get(table);
      if (known) return known;
      const all = ((await deps.getAll(table).catch(() => [])) || []) as {
        id?: string;
        name?: string;
      }[];
      const wanted = fold(deps.importedCategoryName);
      const found =
        all.find((c) => c?.id === IMPORTED_CATEGORY_ID) ||
        all.find((c) => typeof c?.name === "string" && fold(c.name) === wanted);
      let id = found?.id;
      if (!id) {
        id = IMPORTED_CATEGORY_ID;
        await deps.put(table, {
          id,
          name: deps.importedCategoryName,
          icon: ICONS.ACTIONS.IMPORT,
          iconType: "icon",
          color: IMPORTED_CATEGORY_COLOR,
        });
        created.push([table, id]);
      }
      categories.set(table, id);
      return id;
    }

    const importedCache = new Map<string, Record<string, unknown>[]>();
    /** Registros que já estão na categoria "Importados" da tabela (lidos uma vez). */
    async function importedRecords(
      table: string,
      categoryId: string
    ): Promise<Record<string, unknown>[]> {
      if (!importedCache.has(table)) {
        const all = ((await deps.getAll(table).catch(() => [])) || []) as Record<string, unknown>[];
        importedCache.set(
          table,
          all.filter((r) => r && r.categoryId === categoryId)
        );
      }
      return importedCache.get(table) as Record<string, unknown>[];
    }

    /** HEIC não decodifica no Chromium: converte antes de guardar. */
    async function prepareEntry(entry: PackageEntry): Promise<PackageEntry | null> {
      if (mediaKindOf(entry.name) !== "image" || !isHeic(entry.name)) return entry;
      try {
        const stream = await entry.open();
        if (!stream) return null;
        const blob = await blobFromStream(stream, {
          expectedSize: entry.size,
          maxBytes: MAX_HEIC_BYTES,
        });
        const converted = await ensureRenderableImage(
          entry.name,
          new File([blob], entry.name, { type: entry.mime })
        );
        return {
          ...entry,
          name: converted.name,
          mime: converted.blob.type || "image/jpeg",
          size: converted.blob.size,
          open: async () => converted.blob.stream() as ReadableStream<Uint8Array>,
        };
      } catch {
        return null;
      }
    }

    /** Grava o arquivo na biblioteca e devolve o id novo (`null` se o tipo não serve). */
    async function storeInLibrary(
      source: Exclude<FileSource, "liturgy">,
      rawEntry: PackageEntry
    ): Promise<{ id: string; kind: MediaKind } | null> {
      const file = await prepareEntry(rawEntry);
      if (!file) return null;
      const kind = mediaKindOf(file.name);
      const accepts =
        source === "media"
          ? kind !== null
          : source === "background-sound"
            ? kind === "audio"
            : kind === "image" || kind === "video";
      if (!kind || !accepts || !mimeMatches(kind, file.mime)) return null;
      const { table, category } = LIBRARY[source];
      const categoryId = await importedCategory(category);

      // Importar o mesmo pacote de novo não duplica: procura em "Importados" o
      // mesmo nome/tamanho e confirma o conteúdo (hash no desktop; primeiros e
      // últimos 64 KB no web).
      const fileNameKey = source === "background-sound" ? "fileName" : "name";
      const candidates = (await importedRecords(table, categoryId)).filter(
        (record) => record[fileNameKey] === file.name && recordSize(record) === file.size
      );

      // Reimportação: se já existe candidato com hash, confere o hash antes de
      // gravar. Evita copiar 5 GB para depois descobrir que era o mesmo arquivo.
      // Hash roda na thread principal, então fica limitado a arquivos pequenos;
      // acima disso a comparação acontece depois de gravar (em worker).
      const hashed = candidates.filter(
        (record) => typeof record.sha256 === "string" && record.sha256
      );
      let incomingSha: string | undefined;
      if (hashed.length && file.size <= PREHASH_LIMIT) {
        const probe = await file.open().catch(() => null);
        if (probe) incomingSha = (await hashStream(probe).catch(() => null)) ?? undefined;
        if (incomingSha) {
          const same = hashed.find((record) => record.sha256 === incomingSha);
          if (same) return { id: String(same.id), kind };
        }
      }

      const id = source === "media" ? `file_${now()}_${newId().slice(0, 8)}` : newId();
      const storedFile = await deps.storeLibraryFile({
        source,
        recordId: id,
        name: file.name,
        mime: file.mime,
        size: file.size,
        open: file.open,
      });

      for (const record of candidates) {
        if (await sameContent(record, storedFile).catch(() => false)) {
          if (storedFile.mode === "path") {
            await deps.removeStoredFile(storedFile.path).catch(() => {});
          }
          return { id: String(record.id), kind };
        }
      }

      if (storedFile.mode === "path") storedPaths.push(storedFile.path);
      const record = buildLibraryRecord({
        source,
        id,
        name: file.name,
        kind,
        categoryId,
        stored: storedFile,
        now: now(),
      });
      await deps.put(table, record);
      created.push([table, id]);
      importedCache.get(table)?.push(record);
      stored += 1;
      return { id, kind };
    }

    // Cada arquivo do pacote vira um registro só, mesmo com vários itens apontando para ele.
    const done = new Map<
      string,
      { id: string; kind: MediaKind } | { liturgy: string; dir: string; path?: string } | null
    >();
    async function once<
      T extends
        | { id: string; kind: MediaKind }
        | { liturgy: string; dir: string; path?: string }
        | null,
    >(key: string, make: () => Promise<T>): Promise<T> {
      if (done.has(key)) return done.get(key) as T;
      const value = await make();
      done.set(key, value);
      return value;
    }

    async function existsHere(table: string, id: string): Promise<boolean> {
      try {
        return !!(await deps.get(table, id));
      } catch {
        return false;
      }
    }

    const out: LiturgyItem[] = [];
    for (const original of items) {
      let item: LiturgyItem = { ...original };
      switch (item.tipo) {
        case LiturgyItemTypeEnum.ARQUIVO: {
          const inPackage = pointsIntoPackage(item);
          const key = item.ref_id && byKey.has(`liturgy:${item.ref_id}`) ? item.ref_id : item.id;
          const file = byKey.get(`liturgy:${key}`);
          if (inPackage) item.dir_info = "E";
          if (!file) {
            if (inPackage) {
              delete item.ref_id;
              item.dir = "";
              missing.push(displayName(original));
            } else if (item.ref_id && !(await existsHere(DB_TABLE.LITURGY_FILES, item.ref_id))) {
              delete item.ref_id;
              if (isLocalSource(item.dir)) item.dir = "";
              missing.push(displayName(original));
            } else if (!item.ref_id && files.length > 0 && isLocalSource(item.dir)) {
              // Pacote de verdade que não trouxe este arquivo: o caminho local da
              // máquina de origem não vale aqui. `.ja`/`.json` antigos (sem files)
              // mantêm o caminho, como sempre fizeram.
              item.dir = "";
              missing.push(displayName(original));
            }
            break;
          }
          if (mediaKindOf(file.name)) {
            const saved = (await once(`media-from-liturgy:${key}`, () =>
              storeInLibrary("media", file)
            )) as { id: string; kind: MediaKind } | null;
            if (!saved) {
              delete item.ref_id;
              item.dir = "";
              item.dir_info = "E";
              unsupported.push(file.name);
              break;
            }
            item = {
              ...item,
              tipo: LiturgyItemTypeEnum.MEDIA_LIBRARY,
              ref_id: saved.id,
              dir: "",
              dir_info: "E",
              subtipo: saved.kind,
              item: item.item || file.name,
              subitem: file.name,
            };
            break;
          }
          if (/\.slja$/i.test(file.name)) {
            const saved = (await once(`liturgy:${key}`, async () => {
              try {
                const r = await deps.storeLiturgyFile({
                  name: file.name,
                  mime: file.mime || "",
                  size: file.size,
                  open: file.open,
                });
                if (r.ref_id) liturgyFiles.push(r.ref_id);
                if (r.path) storedPaths.push(r.path);
                stored += 1;
                return { liturgy: r.ref_id || r.dir, dir: r.dir, path: r.path };
              } catch {
                return null;
              }
            })) as { liturgy: string; dir: string; path?: string } | null;
            if (!saved) {
              delete item.ref_id;
              item.dir = "";
              item.dir_info = "E";
              missing.push(displayName(original));
              break;
            }
            // Desktop: o item aponta para o caminho relativo no acervo (o
            // `ref_id` só existe no web, onde os bytes estão no IndexedDB).
            item = { ...item, dir: saved.path || saved.dir, dir_info: "E" };
            if (saved.liturgy && saved.liturgy !== saved.dir) item.ref_id = saved.liturgy;
            else delete item.ref_id;
            break;
          }
          delete item.ref_id;
          item.dir = "";
          item.dir_info = "E";
          unsupported.push(file.name);
          break;
        }
        case LiturgyItemTypeEnum.MEDIA_LIBRARY:
        case LiturgyItemTypeEnum.BG_SOUND:
        case LiturgyItemTypeEnum.BG_PROJECTION: {
          const source: Exclude<FileSource, "liturgy"> =
            item.tipo === LiturgyItemTypeEnum.MEDIA_LIBRARY
              ? "media"
              : item.tipo === LiturgyItemTypeEnum.BG_SOUND
                ? "background-sound"
                : "background-projection";
          if (!item.ref_id) break;
          const file = byKey.get(`${source}:${item.ref_id}`);
          if (file) {
            const saved = (await once(`${source}:${item.ref_id}`, () =>
              storeInLibrary(source, file)
            )) as { id: string; kind: MediaKind } | null;
            if (saved) {
              item.ref_id = saved.id;
              break;
            }
            unsupported.push(file.name);
          }
          // Não veio no pacote: só fica a referência se o registro existir aqui.
          if (!(await existsHere(LIBRARY[source].table, item.ref_id))) {
            delete item.ref_id;
            missing.push(displayName(original));
          }
          break;
        }
      }
      out.push(item);
    }

    // YouTube: entra na lista de Vídeos Online, sem duplicar o que já existe.
    const videoLinks = out.filter(
      (i) =>
        (i.tipo === LiturgyItemTypeEnum.VIDEO_ONLINE || i.tipo === LiturgyItemTypeEnum.SITE) &&
        videoIdFromUrl(i.url)
    );
    if (videoLinks.length) {
      const existing = ((await deps.getAll(DB_TABLE.CUSTOM_ONLINE_VIDEOS).catch(() => [])) ||
        []) as {
        url?: string;
      }[];
      const known = new Set(existing.map((v) => videoIdFromUrl(v?.url)).filter(Boolean));
      for (const item of videoLinks) {
        const ytId = videoIdFromUrl(item.url) as string;
        if (known.has(ytId)) continue;
        known.add(ytId);
        const categoryId = await importedCategory(DB_TABLE.CUSTOM_ONLINE_VIDEOS_CATEGORIES);
        const id = newId();
        const name =
          String(item.subitem || "")
            .replace(/^(URL|Site):?\s*/i, "")
            .trim() ||
          item.item ||
          ytId;
        await deps.put(DB_TABLE.CUSTOM_ONLINE_VIDEOS, {
          id,
          name: /^https?:\/\//i.test(name) ? item.item || ytId : name,
          url: item.url,
          createdAt: new Date(now()).toISOString(),
          categoryId,
        });
        created.push([DB_TABLE.CUSTOM_ONLINE_VIDEOS, id]);
        youtube.push({ id: ytId, name: item.item || name });
      }
    }

    return { items: out, stored, missing, unsupported, youtube, rollback };
  } catch (error) {
    await rollback();
    throw error;
  }
}
