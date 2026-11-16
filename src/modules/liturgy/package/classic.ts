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
 *
 * Lido com o mesmo zip.js em streaming do pacote do Violin: um `.llja` do
 * Classic com vídeos grandes não precisa caber na memória.
 */
import {
  isZip,
  loadZipJs,
  MAX_MANIFEST_BYTES,
  normalizeZipPath,
  openZipEntry,
  safeFileName,
  safeZipPath,
  type PackageEntry,
} from "./format";
import { maxPackageBytes, MAX_PACKAGE_FILES } from "@/helpers/StorageLimits";

/** Versão do JSON do Classic. Ausente vale 1; outra, o arquivo é recusado (como lá). */
export const CLASSIC_SCHEMA = 1;
const CLASSIC_JSON = "liturgia.json";
const CLASSIC_JSON_ALT = "liturgia.lja";
const CLASSIC_FILES = "arquivos/";
/** `dir_info` de item cujo `dir` é relativo ao pacote. */
export const DIR_INFO_PACKAGE = "L";

export interface ClassicPackage {
  liturgyJson: string;
  files: PackageEntry[];
  close: () => Promise<void>;
}

type ZipEntry = import("@zip.js/zip.js").FileEntry;

function entrySize(entry: ZipEntry): number {
  return typeof entry.uncompressedSize === "number" && entry.uncompressedSize >= 0
    ? entry.uncompressedSize
    : 0;
}

/** `null` quando o ZIP não é do Classic (ou não é ZIP). */
export async function readClassicPackage(blob: Blob): Promise<ClassicPackage | null> {
  if (!Number.isFinite(blob.size) || blob.size <= 0 || blob.size > maxPackageBytes()) return null;
  if (!(await isZip(blob))) return null;

  const { ZipReader, BlobReader, TextWriter } = await loadZipJs();
  const reader = new ZipReader(new BlobReader(blob));
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await reader.close().catch(() => {});
  };

  try {
    const entries = await reader.getEntries();
    if (entries.length > MAX_PACKAGE_FILES + 2) {
      await close();
      return null;
    }
    // Pacote feito no Windows pode trazer a barra invertida e outra caixa no nome.
    const byPath = new Map<string, ZipEntry>();
    for (const entry of entries) {
      if (!entry.directory) byPath.set(normalizeZipPath(entry.filename).toLowerCase(), entry);
    }

    const manifestEntry = byPath.get(CLASSIC_JSON) ?? byPath.get(CLASSIC_JSON_ALT);
    if (!manifestEntry) {
      await close();
      return null;
    }
    const manifestSize = entrySize(manifestEntry);
    if (manifestSize > MAX_MANIFEST_BYTES || manifestSize > maxPackageBytes()) {
      await close();
      return null;
    }
    // Sem o BOM, que o Delphi pode gravar.
    const liturgyJson = String(await manifestEntry.getData(new TextWriter())).replace(
      /^\uFEFF/,
      ""
    );
    if (liturgyJson.length > MAX_MANIFEST_BYTES) {
      await close();
      return null;
    }

    let data: { schema?: unknown; items?: unknown };
    try {
      data = JSON.parse(liturgyJson);
    } catch {
      await close();
      return null;
    }
    if (data.schema !== undefined && Number(data.schema) !== CLASSIC_SCHEMA) {
      await close();
      return null;
    }

    const files: PackageEntry[] = [];
    let total = manifestSize;
    for (const raw of Array.isArray(data.items) ? data.items : []) {
      const item = raw as { id?: unknown; dir?: unknown; dir_info?: unknown } | null;
      if (!item || typeof item.id !== "string" || typeof item.dir !== "string") continue;
      if (String(item.dir_info || "").toUpperCase() !== DIR_INFO_PACKAGE) continue;
      const path = safeZipPath(item.dir, CLASSIC_FILES);
      const entry = path ? byPath.get(path.toLowerCase()) : undefined;
      if (!path || !entry || entry.encrypted || entrySize(entry) <= 0) continue;
      total += entrySize(entry);
      if (total > maxPackageBytes()) {
        await close();
        return null;
      }
      files.push({
        source: "liturgy",
        sourceId: item.id,
        name: safeFileName(path.split("/").pop() || ""),
        mime: "",
        size: entrySize(entry),
        open: openZipEntry(entry),
      });
    }
    return { liturgyJson, files, close };
  } catch {
    await close();
    return null;
  }
}

/** Item do Classic cujo arquivo mora dentro do pacote. */
export function pointsIntoPackage(item: { dir_info?: unknown }): boolean {
  return String(item.dir_info || "").toUpperCase() === DIR_INFO_PACKAGE;
}
