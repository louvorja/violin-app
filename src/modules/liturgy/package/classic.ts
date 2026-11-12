/**
 * Leitura do `.llja` do LouvorJA Classic (louvorja/desktop, `uLiturgiaLlja.pas`).
 *
 *   liturgia.json   `{ schema: 1, name, color, exportedAt, items }` (o Classic
 *                   também grava `liturgia.lja`, nome antigo);
 *   arquivos/       os arquivos dos itens do tipo "arquivo".
 *
 * No Classic, o item de arquivo aponta para dentro do pacote: `dir` relativo
 * (`arquivos\foto.jpg`, com a barra do Windows) e `dir_info` "L". Aqui ele vira
 * um arquivo da liturgia (`source: "liturgy"`, `sourceId` = id do item), e a
 * importação segue o mesmo caminho do pacote do Violin.
 *
 * Os tipos e campos do JSON do Classic já são os do Violin (o Victor fez o
 * formato de troca assim), por isso não há conversão de item por item.
 */
import {
  isZip,
  loadJsZip,
  MAX_PACKAGE_BYTES,
  MAX_PACKAGE_FILES,
  normalizeZipPath,
  safeFileName,
  safeZipPath,
  type PackageFile,
} from "./format";

/** Versão do JSON do Classic. Ausente vale 1; outra, o arquivo é recusado (como lá). */
export const CLASSIC_SCHEMA = 1;
const CLASSIC_JSON = "liturgia.json";
const CLASSIC_JSON_ALT = "liturgia.lja";
const CLASSIC_FILES = "arquivos/";
/** `dir_info` de item cujo `dir` é relativo ao pacote. */
export const DIR_INFO_PACKAGE = "L";

export interface ClassicPackage {
  liturgyJson: string;
  files: PackageFile[];
}

type ZipEntry = import("jszip").JSZipObject & { _data?: { uncompressedSize?: number } };

/** `null` quando o ZIP não é do Classic (ou não é ZIP). */
export async function readClassicPackage(blob: Blob): Promise<ClassicPackage | null> {
  if (!(await isZip(blob))) return null;
  const JSZip = await loadJsZip();
  let zip: import("jszip");
  try {
    zip = await JSZip.loadAsync(blob);
  } catch {
    return null;
  }
  // Pacote feito no Windows pode trazer a barra invertida e outra caixa no nome.
  const entries = new Map<string, ZipEntry>();
  zip.forEach((path, entry) => {
    if (!entry.dir) entries.set(normalizeZipPath(path).toLowerCase(), entry as ZipEntry);
  });
  if (entries.size > MAX_PACKAGE_FILES + 2) return null;

  const manifest = entries.get(CLASSIC_JSON) ?? entries.get(CLASSIC_JSON_ALT);
  if (!manifest) return null;
  // Sem o BOM, que o Delphi pode gravar.
  const liturgyJson = (await manifest.async("string")).replace(/^\uFEFF/, "");

  let data: { schema?: unknown; items?: unknown };
  try {
    data = JSON.parse(liturgyJson);
  } catch {
    return null;
  }
  if (data.schema !== undefined && Number(data.schema) !== CLASSIC_SCHEMA) return null;

  const files: PackageFile[] = [];
  let total = 0;
  for (const raw of Array.isArray(data.items) ? data.items : []) {
    const item = raw as { id?: unknown; dir?: unknown; dir_info?: unknown } | null;
    if (!item || typeof item.id !== "string" || typeof item.dir !== "string") continue;
    if (String(item.dir_info || "").toUpperCase() !== DIR_INFO_PACKAGE) continue;
    const path = safeZipPath(item.dir, CLASSIC_FILES);
    const entry = path ? entries.get(path.toLowerCase()) : undefined;
    if (!path || !entry) continue;
    total += entry._data?.uncompressedSize ?? 0;
    if (total > MAX_PACKAGE_BYTES) return null;
    files.push({
      source: "liturgy",
      sourceId: item.id,
      name: safeFileName(path.split("/").pop() || ""),
      mime: "",
      data: await entry.async("blob"),
    });
  }
  return { liturgyJson, files };
}

/** Item do Classic cujo arquivo mora dentro do pacote. */
export function pointsIntoPackage(item: { dir_info?: unknown }): boolean {
  return String(item.dir_info || "").toUpperCase() === DIR_INFO_PACKAGE;
}
