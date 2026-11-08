/**
 * Formato `.llja` (Liturgia LouvorJA): um ZIP com a liturgia e os arquivos que
 * ela usa, para montar o culto num computador e abrir em outro.
 *
 * É o mesmo pacote do LouvorJA Classic (louvorja/desktop, `uLiturgiaLlja.pas`),
 * para um programa abrir o arquivo do outro:
 *
 *   liturgia.json   o JSON de troca: `{ schema: 1, name, color, exportedAt, items }`
 *                   (o Classic também lê `liturgia.lja` com esse nome antigo);
 *   arquivos/       os arquivos dos itens do tipo "arquivo".
 *
 * Dentro do pacote, o item de arquivo tem `dir` relativo ao pacote
 * (`arquivos/foto.jpg`) e `dir_info` "L". O "L" só existe aí: ao importar, o
 * arquivo é guardado no aparelho e o item volta a ser um arquivo comum ("E").
 *
 * Leitura e gravação dos bytes entram por parâmetro (`readFile`/`storeFile`):
 * o formato não depende de onde o app guarda os arquivos, e os testes não
 * precisam de disco nem de IndexedDB.
 */
import { LiturgyItemTypeEnum } from "@/enums/LiturgyItemTypeEnum";
import type { LiturgyItem } from "@/types/Liturgy";

export const LLJA_EXT = "llja";
/** Versão do JSON de troca. Ausente vale 1; outra, o arquivo é recusado (como no Classic). */
export const LLJA_SCHEMA = 1;
export const LLJA_MANIFEST = "liturgia.json";
const LLJA_MANIFEST_ALT = "liturgia.lja";
const FILES_DIR = "arquivos/";
/** `dir_info` de item cujo `dir` é relativo ao pacote. */
export const DIR_INFO_PACKAGE = "L";

/** Um arquivo de item, como entra no pacote. */
export interface PackedFile {
  name: string;
  data: Blob;
}

export interface LljaManifest {
  schema: number;
  name: string;
  color?: string;
  exportedAt: string;
  items: LiturgyItem[];
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
        // No outro computador o caminho daqui não existe: o item aponta para
        // dentro do pacote, como o Classic grava.
        item.dir = path;
        item.dir_info = DIR_INFO_PACKAGE;
        item.subitem = `Arquivo ${path.slice(FILES_DIR.length)}`;
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
    schema: LLJA_SCHEMA,
    name: input.name,
    ...(input.color ? { color: input.color } : {}),
    exportedAt: new Date().toISOString(),
    items,
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

/** `arquivos\foto.jpg` (Windows) e `arquivos/foto.jpg` são o mesmo lugar. */
function normalizePath(path: string): string {
  return path.trim().replace(/\\/g, "/");
}

/**
 * Caminho de dentro do pacote que pode ser lido: relativo, sem unidade, sem
 * subir de pasta e dentro de `arquivos/`. ZIP de terceiro é entrada não confiável.
 */
export function safePackagePath(path: string): string | null {
  const p = normalizePath(path);
  if (!p || p.includes(":") || p.startsWith("/")) return null;
  if (p.split("/").some((part) => part === "..")) return null;
  if (!p.toLowerCase().startsWith(FILES_DIR)) return null;
  return p;
}

/**
 * Abre um `.llja`: devolve o `liturgia.json` e os arquivos que os itens
 * apontam (`dir_info` "L"). Nada do ZIP é gravado em disco por aqui.
 */
export async function readLlja(file: Blob): Promise<ReadResult | null> {
  const JSZip = await loadJsZip();
  let zip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch {
    return null;
  }
  // Pacote feito no Windows pode trazer a barra invertida e outra caixa no nome.
  const entries = new Map<string, import("jszip").JSZipObject>();
  zip.forEach((path, entry) => {
    if (!entry.dir) entries.set(normalizePath(path).toLowerCase(), entry);
  });

  const manifest = entries.get(LLJA_MANIFEST) ?? entries.get(LLJA_MANIFEST_ALT);
  if (!manifest) return null;
  // Sem o BOM, que o Delphi pode gravar.
  const json = (await manifest.async("string")).replace(/^\uFEFF/, "");

  let data: { schema?: unknown; items?: unknown };
  try {
    data = JSON.parse(json);
  } catch {
    return null;
  }
  if (data.schema !== undefined && Number(data.schema) !== LLJA_SCHEMA) return null;

  const files = new Map<string, PackedFile>();
  for (const raw of Array.isArray(data.items) ? data.items : []) {
    const item = raw as Partial<LiturgyItem> | null;
    if (!item || typeof item.id !== "string" || typeof item.dir !== "string") continue;
    if (String(item.dir_info || "").toUpperCase() !== DIR_INFO_PACKAGE) continue;
    const path = safePackagePath(item.dir);
    const entry = path ? entries.get(path.toLowerCase()) : undefined;
    if (!path || !entry) continue;
    const name = safeFileName(path.split("/").pop() || "", "arquivo");
    files.set(item.id, { name, data: await entry.async("blob") });
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
    const inPackage =
      item.tipo === LiturgyItemTypeEnum.ARQUIVO &&
      String(item.dir_info || "").toUpperCase() === DIR_INFO_PACKAGE;
    if (!inPackage) {
      out.push(item);
      continue;
    }
    // O "L" não sai do pacote: guardado ou não, o item volta a ser arquivo comum.
    const plain = { ...item, dir_info: "E" };
    const packed = files.get(item.id);
    if (!packed) {
      failed.push(displayName(item));
      out.push(plain);
      continue;
    }
    try {
      const stored = await storeFile(
        new File([packed.data], packed.name, { type: packed.data.type || "" })
      );
      out.push({ ...plain, ...stored });
    } catch {
      failed.push(displayName(item));
      out.push(plain);
    }
  }
  return { items: out, failed };
}
