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
 * chama `rollback()` para apagar o que foi criado.
 */
import { LiturgyItemTypeEnum } from "@/enums/LiturgyItemTypeEnum";
import { DB_TABLE } from "@/constants/DbTables";
import { AUDIO_EXT, IMAGE_EXT, VIDEO_EXT } from "@/constants/FileTypes";
import { ICONS } from "@/config/Icons";
import { videoIdFromUrl } from "@/helpers/OnlineVideo";
import type { LiturgyItem } from "@/types/Liturgy";
import type { FileSource, PackageFile } from "./format";
import { pointsIntoPackage } from "./classic";

/** Id fixo da categoria "Importados": reaproveitada nas próximas importações. */
export const IMPORTED_CATEGORY_ID = "importados";
const IMPORTED_CATEGORY_COLOR = "#64748B";

export type MediaKind = "image" | "video" | "audio" | "pdf";

export function mediaKindOf(name: string): MediaKind | null {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  if (IMAGE_EXT.includes(ext)) return "image";
  if (VIDEO_EXT.includes(ext)) return "video";
  if (AUDIO_EXT.includes(ext)) return "audio";
  return ext === "pdf" ? "pdf" : null;
}

export interface InstallDeps {
  get: (_table: string, _id: string) => Promise<unknown>;
  getAll: (_table: string) => Promise<unknown[]>;
  put: (_table: string, _record: Record<string, unknown>) => Promise<unknown>;
  del: (_table: string, _id: string) => Promise<unknown>;
  /** Guarda um `.slja` como arquivo da liturgia. */
  storeLiturgyFile: (_file: File) => Promise<{ dir: string; ref_id: string }>;
  removeLiturgyFile: (_id: string) => Promise<unknown>;
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

function byteLength(data: unknown): number {
  if (!data) return -1;
  if (typeof Blob !== "undefined" && data instanceof Blob) return data.size;
  const size = (data as { byteLength?: unknown }).byteLength;
  return typeof size === "number" ? size : -1;
}

function displayName(item: LiturgyItem): string {
  return (item.item || item.subitem || item.dir || item.tipo || "").trim();
}

/**
 * Registro que a biblioteca guarda com os bytes dentro. O `path` "blob:" é o
 * sinal que as bibliotecas já usam para recriar a URL a partir de `data` ao
 * abrir — a URL em si morre com a sessão.
 */
function placeholderPath(): string {
  try {
    const url = URL.createObjectURL(new Blob([]));
    URL.revokeObjectURL(url);
    return url;
  } catch {
    return "blob:imported";
  }
}

export async function installPackage(
  items: LiturgyItem[],
  files: PackageFile[],
  deps: InstallDeps
): Promise<InstallResult> {
  const newId = deps.newId ?? (() => crypto.randomUUID());
  const now = deps.now ?? (() => Date.now());
  const created: [string, string][] = [];
  const liturgyFiles: string[] = [];
  const missing: string[] = [];
  const unsupported: string[] = [];
  const youtube: { id: string; name: string }[] = [];
  let stored = 0;

  const byKey = new Map<string, PackageFile>();
  /** Arquivos do pacote já tratados por algum item (não entram de novo como "sobra"). */
  const handled = new Set<string>();
  for (const f of files) byKey.set(`${f.source}:${f.sourceId}`, f);

  async function rollback(): Promise<void> {
    for (const id of liturgyFiles.splice(0)) await deps.removeLiturgyFile(id).catch(() => {});
    for (const [table, id] of created.splice(0).reverse())
      await deps.del(table, id).catch(() => {});
  }

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

  /** Grava o arquivo na biblioteca e devolve o id novo (`null` se o tipo não serve). */
  async function storeInLibrary(
    source: Exclude<FileSource, "liturgy">,
    file: PackageFile
  ): Promise<{ id: string; kind: MediaKind } | null> {
    const kind = mediaKindOf(file.name);
    const accepts =
      source === "media"
        ? kind !== null
        : source === "background-sound"
          ? kind === "audio"
          : kind === "image" || kind === "video";
    if (!kind || !accepts) return null;
    const { table, category } = LIBRARY[source];
    const categoryId = await importedCategory(category);
    // Importar o mesmo pacote de novo não duplica: o arquivo que já entrou em
    // "Importados", com o mesmo nome e o mesmo tamanho, é reaproveitado.
    const fileNameKey = source === "background-sound" ? "fileName" : "name";
    const again = (await importedRecords(table, categoryId)).find(
      (r) => r[fileNameKey] === file.name && byteLength(r.data) === file.data.size
    );
    if (again) return { id: String(again.id), kind };
    const id = source === "media" ? `file_${now()}_${newId().slice(0, 8)}` : newId();
    const data = await file.data.arrayBuffer();
    const mime = file.mime || file.data.type || "application/octet-stream";
    const path = placeholderPath();
    const record: Record<string, unknown> =
      source === "background-sound"
        ? {
            id,
            categoryId,
            name: file.name.replace(/\.[^.]+$/, ""),
            fileName: file.name,
            path,
            data,
            mime,
          }
        : {
            id,
            name: file.name,
            path,
            type: kind,
            addedAt: now(),
            data,
            mime,
            categoryId,
            ...(kind === "image" ? { thumb: path } : {}),
          };
    await deps.put(table, record);
    created.push([table, id]);
    importedCache.get(table)?.push(record);
    stored += 1;
    return { id, kind };
  }

  // Cada arquivo do pacote vira um registro só, mesmo com vários itens apontando para ele.
  const done = new Map<
    string,
    { id: string; kind: MediaKind } | { liturgy: string; dir: string } | null
  >();
  async function once<
    T extends { id: string; kind: MediaKind } | { liturgy: string; dir: string } | null,
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
            missing.push(displayName(original));
          } else if (item.ref_id && !(await existsHere(DB_TABLE.LITURGY_FILES, item.ref_id))) {
            delete item.ref_id;
            missing.push(displayName(original));
          }
          break;
        }
        if (mediaKindOf(file.name)) {
          const saved = (await once(`media-from-liturgy:${key}`, () =>
            storeInLibrary("media", file)
          )) as { id: string; kind: MediaKind } | null;
          if (!saved) {
            missing.push(displayName(original));
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
              const r = await deps.storeLiturgyFile(
                new File([file.data], file.name, { type: file.mime || file.data.type })
              );
              liturgyFiles.push(r.ref_id);
              stored += 1;
              return { liturgy: r.ref_id, dir: r.dir };
            } catch {
              return null;
            }
          })) as { liturgy: string; dir: string } | null;
          if (!saved) {
            missing.push(displayName(original));
            break;
          }
          item = { ...item, ref_id: saved.liturgy, dir: saved.dir, dir_info: "E" };
          break;
        }
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
          handled.add(`${source}:${item.ref_id}`);
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

  // Projeção de Fundo que nenhum item usa: veio com a biblioteca inteira (opção na exportação).
  for (const file of files) {
    if (file.source !== "background-projection") continue;
    if (handled.has(`background-projection:${file.sourceId}`)) continue;
    const saved = await once(`background-projection:${file.sourceId}`, () =>
      storeInLibrary("background-projection", file)
    );
    if (!saved) unsupported.push(file.name);
  }

  // YouTube: entra na lista de Vídeos Online, sem duplicar o que já existe.
  const videoLinks = out.filter(
    (i) =>
      (i.tipo === LiturgyItemTypeEnum.VIDEO_ONLINE || i.tipo === LiturgyItemTypeEnum.SITE) &&
      videoIdFromUrl(i.url)
  );
  if (videoLinks.length) {
    const existing = ((await deps.getAll(DB_TABLE.CUSTOM_ONLINE_VIDEOS).catch(() => [])) || []) as {
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
}
