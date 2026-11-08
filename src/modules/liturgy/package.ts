/**
 * Formato `.llja` (Liturgia LouvorJA): um ZIP com a liturgia e os arquivos que
 * ela usa, para montar o culto num computador e abrir em outro.
 *
 *   liturgia.json   o mesmo JSON do export antigo (`name`, `items`), mais
 *                   `format`, `version`, `color` e a lista `files`;
 *   arquivos/       um arquivo por item do tipo "arquivo" que pôde ser lido.
 *
 * O `.json` de antes só levava o caminho do arquivo (ou a referência ao que o
 * navegador guardou), e no outro computador o item aparecia mas não abria.
 *
 * Leitura e gravação dos bytes entram por parâmetro (`readFile`/`storeFile`):
 * o formato não depende de onde o app guarda os arquivos, e os testes não
 * precisam de disco nem de IndexedDB.
 */
import { LiturgyItemTypeEnum } from "@/enums/LiturgyItemTypeEnum";
import type { LiturgyItem } from "@/types/Liturgy";

export const LLJA_EXT = "llja";
export const LLJA_FORMAT = "louvorja-liturgy";
export const LLJA_VERSION = 1;
export const LLJA_MANIFEST = "liturgia.json";
const FILES_DIR = "arquivos/";

/** Um arquivo de item, como entra no pacote. */
export interface PackedFile {
  name: string;
  data: Blob;
}

export interface LljaFileEntry {
  /** `id` do item que usa o arquivo. */
  item: string;
  /** Caminho dentro do ZIP (`arquivos/...`). */
  path: string;
  /** Nome original, com extensão. */
  name: string;
}

export interface LljaManifest {
  format: typeof LLJA_FORMAT;
  version: number;
  name: string;
  color?: string;
  exportedAt: string;
  items: LiturgyItem[];
  files: LljaFileEntry[];
}

export interface BuildResult {
  blob: Blob;
  /** Itens do tipo arquivo cujo arquivo não foi achado — vão sem ele. */
  missing: string[];
  /** Itens que dependem de algo que só existe neste computador. */
  localOnly: string[];
}

async function loadJsZip() {
  const mod = (await import("jszip")) as unknown as {
    default?: { default?: unknown } | unknown;
  };
  const anyMod = mod as { default?: { default?: unknown } };
  return (anyMod.default?.default ?? anyMod.default ?? mod) as typeof import("jszip");
}

/** Nome de arquivo aceito em Windows, macOS e Linux, sem perder acentos. */
export function safeFileName(name: string, fallback = "Liturgia"): string {
  const cleaned = String(name || "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    // Windows não aceita nome terminado em ponto ou espaço.
    .replace(/[. ]+$/, "");
  return cleaned || fallback;
}

/**
 * Itens que dependem de algo guardado só neste computador e que o pacote não
 * leva: música personalizada, biblioteca de mídia, som de fundo, anúncios e
 * sobreposições.
 */
export function dependsOnThisComputer(item: LiturgyItem): boolean {
  switch (item.tipo) {
    case LiturgyItemTypeEnum.MUSICA:
      return Boolean(item.ref_id) || (item.id_music ?? item.musica) < -1;
    case LiturgyItemTypeEnum.MEDIA_LIBRARY:
    case LiturgyItemTypeEnum.BG_SOUND:
    case LiturgyItemTypeEnum.ANUNCIOS:
    case LiturgyItemTypeEnum.OVERLAY:
      return true;
    default:
      return false;
  }
}

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
  return !/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(dir) && !/^(blob|data):/i.test(dir);
}

function displayName(item: LiturgyItem): string {
  return (item.item || item.dir || item.tipo || "").trim();
}

/**
 * Monta o `.llja`. `readFile` devolve os bytes do arquivo de um item (ou
 * `null` se não achar); itens sem arquivo seguem como estão.
 */
export async function buildLlja(
  input: { name: string; color?: string; items: LiturgyItem[] },
  readFile: (_item: LiturgyItem) => Promise<PackedFile | null>
): Promise<BuildResult> {
  const JSZip = await loadJsZip();
  const zip = new JSZip();
  const missing: string[] = [];
  const localOnly: string[] = [];
  const files: LljaFileEntry[] = [];
  const usedPaths = new Set<string>();

  const items: LiturgyItem[] = [];
  for (const original of input.items) {
    const item = { ...original };
    if (carriesFile(item)) {
      let packed: PackedFile | null = null;
      try {
        packed = await readFile(original);
      } catch {
        packed = null;
      }
      if (packed && packed.data.size > 0) {
        const fileName = safeFileName(packed.name, "arquivo");
        let path = FILES_DIR + fileName;
        for (let n = 2; usedPaths.has(path.toLowerCase()); n += 1) {
          const dot = fileName.lastIndexOf(".");
          path =
            FILES_DIR +
            (dot > 0
              ? `${fileName.slice(0, dot)} (${n})${fileName.slice(dot)}`
              : `${fileName} (${n})`);
        }
        usedPaths.add(path.toLowerCase());
        zip.file(path, packed.data, { binary: true });
        files.push({ item: item.id, path, name: fileName });
        // No outro computador o caminho daqui não existe: fica só o nome,
        // e o import troca pela referência de onde guardou o arquivo.
        item.dir = fileName;
        delete item.ref_id;
      } else {
        missing.push(displayName(item));
      }
    } else if (dependsOnThisComputer(item)) {
      localOnly.push(displayName(item));
    }
    items.push(item);
  }

  const manifest: LljaManifest = {
    format: LLJA_FORMAT,
    version: LLJA_VERSION,
    name: input.name,
    ...(input.color ? { color: input.color } : {}),
    exportedAt: new Date().toISOString(),
    items,
    files,
  };
  zip.file(LLJA_MANIFEST, JSON.stringify(manifest, null, 2));

  // Imagem e vídeo já vêm comprimidos: comprimir de novo só gasta tempo.
  const blob = await zip.generateAsync({
    type: "blob",
    mimeType: "application/x-louvorja-liturgy",
    compression: "STORE",
  });
  return { blob, missing, localOnly };
}

/** O arquivo começa com a assinatura de ZIP (`PK\x03\x04`)? */
export async function isLlja(file: Blob): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  return head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
}

export interface ReadResult {
  /** O `liturgia.json` como texto, para o parser de sempre validar. */
  json: string;
  /** Arquivos do pacote, pelo `id` do item. */
  files: Map<string, PackedFile>;
}

/**
 * Abre um `.llja`. Lê só os caminhos que o `liturgia.json` lista, e só dentro
 * de `arquivos/` — nada do ZIP é gravado em disco por aqui.
 */
export async function readLlja(file: Blob): Promise<ReadResult | null> {
  const JSZip = await loadJsZip();
  let zip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch {
    return null;
  }
  const entry = zip.file(LLJA_MANIFEST);
  if (!entry) return null;
  const json = await entry.async("string");

  let manifest: Partial<LljaManifest>;
  try {
    manifest = JSON.parse(json);
  } catch {
    return null;
  }
  const files = new Map<string, PackedFile>();
  for (const f of Array.isArray(manifest.files) ? manifest.files : []) {
    if (
      !f ||
      typeof f.item !== "string" ||
      typeof f.path !== "string" ||
      !f.path.startsWith(FILES_DIR) ||
      f.path.includes("..")
    )
      continue;
    const data = zip.file(f.path);
    if (!data) continue;
    const name = safeFileName(
      typeof f.name === "string" && f.name ? f.name : f.path.slice(FILES_DIR.length),
      "arquivo"
    );
    files.set(f.item, { name, data: await data.async("blob") });
  }
  return { json, files };
}

/**
 * Troca, nos itens importados, o nome do arquivo pela referência de onde o app
 * o guardou. Item cujo arquivo não pôde ser guardado fica com o nome, e entra
 * em `failed`.
 */
export async function attachPackedFiles(
  items: LiturgyItem[],
  files: Map<string, PackedFile>,
  storeFile: (_file: File) => Promise<{ dir: string; ref_id: string }>
): Promise<{ items: LiturgyItem[]; failed: string[] }> {
  const failed: string[] = [];
  const out: LiturgyItem[] = [];
  for (const item of items) {
    const packed = item.tipo === LiturgyItemTypeEnum.ARQUIVO ? files.get(item.id) : undefined;
    if (!packed) {
      out.push(item);
      continue;
    }
    try {
      const stored = await storeFile(
        new File([packed.data], packed.name, { type: packed.data.type || "" })
      );
      out.push({ ...item, ...stored });
    } catch {
      failed.push(displayName(item));
      out.push(item);
    }
  }
  return { items: out, failed };
}
