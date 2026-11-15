import JSZip from "jszip";
import { DB_NAME, DB_TABLE } from "@/constants/DbTables";
import $idb from "@/helpers/IndexedDB";
import {
  decodeBackupBinary,
  decodeBackupBinaryFrom,
  encodeBackupJson,
} from "@/helpers/BackupBinary";
import { loadZipJs } from "@/helpers/Zip";
import { createExportSink } from "@/helpers/ExportSink";
import {
  copyOpfsFile,
  isOpfsRel,
  isOpfsSupported,
  listOpfs,
  opfsInfo,
  readOpfsFile,
  relOf,
  removeOpfs,
  removeStaging,
  stagingRel,
  writeOpfsStream,
} from "@/helpers/OpfsStore";
import { mimeForName } from "@/helpers/Mime";
import { assertWebQuota } from "@/helpers/StorageLimits";
import Platform from "@/helpers/Platform";

const EXPORT_FORMAT = "louvorja-violin-db";
const EXPORT_VERSION = 3;

const BACKUP_TABLES = Array.from(new Set(Object.values(DB_TABLE)));

interface BackupManifestTable {
  name: string;
  rows: number;
}

interface BackupManifestOpfs {
  path: string;
  zipPath: string;
  size: number;
  mime: string;
}

interface BackupManifest {
  format: string;
  version: number;
  db_name: string;
  exported_at: string;
  app_version: string;
  tables: BackupManifestTable[];
  opfs?: BackupManifestOpfs[];
}

export interface BackupExportResult {
  fileName: string;
  tables: number;
  rows: number;
  canceled?: boolean;
}

export interface BackupImportResult {
  tables: number;
  rows: number;
}

export interface BackupProgress {
  phase: "export" | "import";
  current: number;
  total: number;
  detail?: string;
}

function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function exportFileName(): string {
  return `louvorja-violin-db-${todayIso()}.zip`;
}

function tableFileName(table: string): string {
  return `${table}.json`;
}

function manifestFileName(): string {
  return "manifest.json";
}

async function readTextFile(zip: JSZip, fileName: string): Promise<string> {
  const entry = zip.file(fileName);
  if (!entry) throw new Error(`Arquivo ausente no ZIP: ${fileName}`);
  return entry.async("text");
}

function normalizeRows(raw: unknown, table: string): Array<Record<string, unknown>> {
  if (!Array.isArray(raw)) {
    throw new Error(`Tabela inválida no backup: ${table}`);
  }
  return raw.map((row, index) => {
    if (!row || typeof row !== "object") {
      throw new Error(`Linha inválida em ${table}[${index}]`);
    }
    if (typeof (row as Record<string, unknown>).id !== "string") {
      throw new Error(`Linha sem id em ${table}[${index}]`);
    }
    return row as Record<string, unknown>;
  });
}

/** Caminhos OPFS citados em qualquer campo de uma tabela. */
function collectOpfsPaths(rows: unknown[]): string[] {
  const out = new Set<string>();
  const walk = (value: unknown): void => {
    if (typeof value === "string") {
      if (value.startsWith("opfs:")) out.add(relOf(value));
      return;
    }
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    for (const item of Object.values(value as Record<string, unknown>)) walk(item);
  };
  for (const row of rows) walk(row);
  return [...out];
}

/** Estimativa do ZIP: metadados + binários + arquivos OPFS (sem lê-los). */
async function estimateBackupBytes(
  rowsByTable: Map<string, Array<Record<string, unknown>>>
): Promise<number> {
  const seen = new Map<string, number>();
  const valueBytes = async (value: unknown): Promise<number> => {
    if (typeof value === "string") {
      if (!value.startsWith("opfs:")) return value.length;
      const rel = relOf(value);
      if (!isOpfsRel(rel)) return 0;
      let size = seen.get(rel);
      if (size === undefined) {
        size = (await opfsInfo(rel).catch(() => ({ size: 0 }))).size;
        seen.set(rel, size);
      }
      return size;
    }
    if (!value || typeof value !== "object") return 8;
    if (value instanceof Blob) return value.size;
    if (Object.prototype.toString.call(value) === "[object ArrayBuffer]") {
      return (value as ArrayBuffer).byteLength;
    }
    if (ArrayBuffer.isView(value)) return value.byteLength;
    let total = 8;
    if (Array.isArray(value)) {
      for (const item of value) total += await valueBytes(item);
      return total;
    }
    for (const item of Object.values(value as Record<string, unknown>)) {
      total += await valueBytes(item);
    }
    return total;
  };

  let total = 0;
  for (const rows of rowsByTable.values()) {
    for (const row of rows) total += await valueBytes(row);
  }
  return total;
}

async function exportStreaming(
  onProgress?: (_progress: BackupProgress) => void
): Promise<BackupExportResult> {
  const fileName = exportFileName();
  const totalSteps = BACKUP_TABLES.length * 2 + 1;
  const rowsByTable = new Map<string, Array<Record<string, unknown>>>();
  for (const [index, table] of BACKUP_TABLES.entries()) {
    onProgress?.({
      phase: "export",
      current: index + 1,
      total: totalSteps,
      detail: table,
    });
    rowsByTable.set(table, await $idb.getAll<Record<string, unknown>>(table));
  }
  if (!Platform.isDesktop) {
    const estimated = await estimateBackupBytes(rowsByTable);
    await assertWebQuota(Math.ceil(estimated * 1.1) + 1024 * 1024);
  }
  const sink = await createExportSink(fileName, "backup");
  if (!sink) return { fileName, tables: 0, rows: 0, canceled: true };

  const { ZipWriter, TextReader, BlobReader, Uint8ArrayReader } = await loadZipJs();
  const writer = new ZipWriter(sink.stream, { level: 0 });
  const manifestTables: BackupManifestTable[] = [];
  const opfsFiles: BackupManifestOpfs[] = [];
  const seenOpfs = new Set<string>();
  let totalRows = 0;
  let binaryId = 0;

  try {
    for (const [index, [table, rows]] of [...rowsByTable.entries()].entries()) {
      onProgress?.({
        phase: "export",
        current: BACKUP_TABLES.length + index + 1,
        total: totalSteps,
        detail: table,
      });
      manifestTables.push({ name: table, rows: rows.length });
      totalRows += rows.length;

      const encoded = encodeBackupJson(rows, binaryId);
      binaryId = encoded.nextId;
      const { json, binary } = encoded;
      for (const entry of binary) {
        if (entry.value instanceof Blob) {
          await writer.add(entry.path, new BlobReader(entry.value), { level: 0 });
        } else {
          await writer.add(entry.path, new Uint8ArrayReader(new Uint8Array(entry.value)), {
            level: 0,
          });
        }
      }
      await writer.add(tableFileName(table), new TextReader(json), { level: 6 });

      for (const rel of collectOpfsPaths(rows)) {
        if (seenOpfs.has(rel) || !isOpfsRel(rel)) continue;
        seenOpfs.add(rel);
        const file = await readOpfsFile(rel);
        if (!file) continue;
        const zipPath = `opfs/${rel}`;
        await writer.add(zipPath, new BlobReader(file), { level: 0 });
        opfsFiles.push({
          path: rel,
          zipPath,
          size: file.size,
          mime: file.type || mimeForName(rel),
        });
      }
    }

    const manifest: BackupManifest = {
      format: EXPORT_FORMAT,
      version: EXPORT_VERSION,
      db_name: DB_NAME,
      exported_at: new Date().toISOString(),
      app_version: import.meta.env.VITE_APP_VERSION || "",
      tables: manifestTables,
      opfs: opfsFiles,
    };

    await writer.add(manifestFileName(), new TextReader(JSON.stringify(manifest, null, 2)), {
      level: 6,
    });
    await writer.close();
    await sink.commit();

    return {
      fileName,
      tables: BACKUP_TABLES.length,
      rows: totalRows,
    };
  } catch (error) {
    await sink.abort().catch(() => {});
    throw error;
  }
}

async function snapshotTables(): Promise<Map<string, Array<Record<string, unknown>>>> {
  const out = new Map<string, Array<Record<string, unknown>>>();
  for (const table of BACKUP_TABLES) {
    out.set(table, await $idb.getAll<Record<string, unknown>>(table));
  }
  return out;
}

async function restoreTables(previous: Map<string, Array<Record<string, unknown>>>): Promise<void> {
  for (const table of BACKUP_TABLES) await $idb.clear(table);
  for (const [table, rows] of previous) {
    for (const row of rows) await $idb.put(table, row as { id: string });
  }
}

/** Importa o formato antigo (JSZip, versões 1 e 2). */
async function importLegacy(
  file: File,
  manifest: Partial<BackupManifest>,
  onProgress?: (_progress: BackupProgress) => void
): Promise<BackupImportResult> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer(), { checkCRC32: true });
  const tables = Array.isArray(manifest.tables) ? manifest.tables : [];
  const tableNames = tables
    .map((entry) => entry?.name)
    .filter((name): name is string => typeof name === "string" && BACKUP_TABLES.includes(name));

  if (tableNames.length === 0) throw new Error("Arquivo de backup sem tabelas");

  const data = new Map<string, Array<Record<string, unknown>>>();
  let totalRows = 0;

  for (const [index, table] of tableNames.entries()) {
    onProgress?.({
      phase: "import",
      current: index + 1,
      total: tableNames.length + 2,
      detail: table,
    });
    const raw = JSON.parse(await readTextFile(zip, tableFileName(table)));
    const rows = normalizeRows(
      manifest.version === 1 ? raw : await decodeBackupBinary(zip, raw),
      table
    );
    data.set(table, rows);
    totalRows += rows.length;
  }

  const previous = await snapshotTables();
  try {
    onProgress?.({
      phase: "import",
      current: tableNames.length + 1,
      total: tableNames.length + 2,
      detail: "clearing",
    });
    for (const table of BACKUP_TABLES) await $idb.clear(table);

    onProgress?.({
      phase: "import",
      current: tableNames.length + 2,
      total: tableNames.length + 2,
      detail: "writing",
    });
    for (const [table, rows] of data) {
      for (const row of rows) await $idb.put(table, row as { id: string });
    }
  } catch (error) {
    await restoreTables(previous).catch((restoreError) => {
      console.error("[Backup] rollback do banco falhou:", restoreError);
    });
    throw error;
  }

  return { tables: data.size, rows: totalRows };
}

/** Remove arquivos OPFS que nenhuma tabela restaurada referencia mais. */
async function cleanupOpfsOrphans(
  data: Map<string, Array<Record<string, unknown>>>,
  force = false
): Promise<number> {
  if (Platform.isDesktop || !isOpfsSupported()) return 0;
  const known = new Set<string>();
  for (const rows of data.values()) {
    for (const rel of collectOpfsPaths(rows)) known.add(rel);
  }
  // Backup de desktop/IDB não referencia OPFS; não apagar o acervo OPFS local.
  if (!known.size && !force) return 0;
  let removed = 0;
  for (const entry of await listOpfs()) {
    if (known.has(entry.rel)) continue;
    if (await removeOpfs(entry.rel).catch(() => false)) removed += 1;
  }
  return removed;
}

async function importStreaming(
  entries: import("@zip.js/zip.js").Entry[],
  manifest: BackupManifest,
  onProgress?: (_progress: BackupProgress) => void
): Promise<BackupImportResult> {
  const { TextWriter, Uint8ArrayWriter } = await loadZipJs();
  const token = crypto.randomUUID();
  const staged: { rel: string; stagedRel: string; size: number }[] = [];
  const committed: { rel: string; existed: boolean }[] = [];
  let previous: Map<string, Array<Record<string, unknown>>> | null = null;

  try {
    const byPath = new Map(
      entries
        .filter((entry) => !entry.directory)
        .map((entry) => [entry.filename.replace(/\\/g, "/").toLowerCase(), entry])
    );

    const tables = Array.isArray(manifest.tables) ? manifest.tables : [];
    const tableNames = tables
      .map((entry) => entry?.name)
      .filter((name): name is string => typeof name === "string" && BACKUP_TABLES.includes(name));
    if (tableNames.length === 0) throw new Error("Arquivo de backup sem tabelas");

    const opfsFiles = Array.isArray(manifest.opfs) ? manifest.opfs : [];
    if (opfsFiles.length && (Platform.isDesktop || !isOpfsSupported())) {
      throw new Error(
        "Este backup foi feito no navegador e contém arquivos OPFS; importe-o no navegador."
      );
    }

    const total = opfsFiles.length * 2 + tableNames.length + 4;
    let step = 0;

    // 1) Tudo vai para staging; nada do destino é tocado ainda.
    for (const item of opfsFiles) {
      if (
        !item ||
        !isOpfsRel(item.path) ||
        item.path.startsWith("liturgy-temp/") ||
        typeof item.zipPath !== "string"
      )
        continue;
      const entry = byPath.get(item.zipPath.toLowerCase());
      if (!entry) throw new Error(`Arquivo OPFS ausente no backup: ${item.zipPath}`);
      step += 1;
      onProgress?.({ phase: "import", current: step, total, detail: item.path });
      const stagedRel = stagingRel(token, "restore", item.path);
      const stream = new TransformStream<Uint8Array, Uint8Array>();
      void entry.getData(stream.writable).catch((error: unknown) => {
        void stream.writable.abort(error).catch(() => {});
      });
      await writeOpfsStream(stagedRel, stream.readable, item.size);
      staged.push({ rel: item.path, stagedRel, size: item.size });
    }

    const data = new Map<string, Array<Record<string, unknown>>>();
    let totalRows = 0;
    const readBinary = async (path: string): Promise<ArrayBuffer | null> => {
      const entry = byPath.get(path.toLowerCase());
      if (!entry) return null;
      const bytes = await entry.getData(new Uint8ArrayWriter());
      return new Uint8Array(bytes).buffer;
    };

    for (const table of tableNames) {
      step += 1;
      onProgress?.({ phase: "import", current: step, total, detail: table });
      const entry = byPath.get(tableFileName(table).toLowerCase());
      if (!entry) throw new Error(`Tabela ausente no backup: ${table}`);
      const text = String(await entry.getData(new TextWriter()));
      const raw = JSON.parse(text);
      const rows = normalizeRows(await decodeBackupBinaryFrom(readBinary, raw), table);
      data.set(table, rows);
      totalRows += rows.length;
    }

    previous = await snapshotTables();

    // 2) Commit: preserva o antigo em rollback e só então troca.
    for (const item of staged) {
      step += 1;
      onProgress?.({ phase: "import", current: step, total, detail: item.rel });
      const existed = (await opfsInfo(item.rel)).exists;
      if (existed) await copyOpfsFile(item.rel, stagingRel(token, "rollback", item.rel));
      committed.push({ rel: item.rel, existed });
      await copyOpfsFile(item.stagedRel, item.rel);
    }

    step += 1;
    onProgress?.({ phase: "import", current: step, total, detail: "clearing" });
    for (const table of BACKUP_TABLES) await $idb.clear(table);

    step += 1;
    onProgress?.({ phase: "import", current: step, total, detail: "writing" });
    for (const [table, rows] of data) {
      for (const row of rows) await $idb.put(table, row as { id: string });
    }

    // 3) Sucesso: descarta o staging e remove arquivos sem registro novo.
    await removeStaging(token).catch(() => {});
    step += 1;
    onProgress?.({ phase: "import", current: step, total, detail: "cleaning" });
    await cleanupOpfsOrphans(data, opfsFiles.length > 0).catch((error) => {
      console.warn("[Backup] limpeza de OPFS falhou:", error);
    });
    onProgress?.({ phase: "import", current: total, total, detail: "done" });

    return { tables: data.size, rows: totalRows };
  } catch (error) {
    // Desfaz os arquivos já trocados: antigos voltam do rollback; novos somem.
    for (const item of committed.reverse()) {
      try {
        if (item.existed) {
          await copyOpfsFile(stagingRel(token, "rollback", item.rel), item.rel);
        } else {
          await removeOpfs(item.rel);
        }
      } catch (restoreError) {
        console.error("[Backup] rollback do arquivo OPFS falhou:", item.rel, restoreError);
      }
    }
    await removeStaging(token).catch(() => {});
    if (previous) {
      await restoreTables(previous).catch((restoreError) => {
        console.error("[Backup] rollback do banco falhou:", restoreError);
      });
    }
    throw error;
  }
}

export default {
  async exportAll(onProgress?: (_progress: BackupProgress) => void): Promise<BackupExportResult> {
    return exportStreaming(onProgress);
  },

  async importAll(
    file: File,
    onProgress?: (_progress: BackupProgress) => void
  ): Promise<BackupImportResult> {
    onProgress?.({ phase: "import", current: 0, total: 4, detail: "loading" });

    const { ZipReader, BlobReader, TextWriter } = await loadZipJs();
    const reader = new ZipReader(new BlobReader(file));
    try {
      const entries = await reader.getEntries();
      const manifestEntry = entries.find(
        (entry) => !entry.directory && entry.filename.toLowerCase() === manifestFileName()
      ) as import("@zip.js/zip.js").FileEntry | undefined;
      if (!manifestEntry) throw new Error("Backup sem manifest.json");
      const manifest = JSON.parse(
        String(await manifestEntry.getData(new TextWriter()))
      ) as Partial<BackupManifest> | null;
      if (
        !manifest ||
        manifest.format !== EXPORT_FORMAT ||
        ![1, 2, EXPORT_VERSION].includes(manifest.version ?? 0)
      ) {
        throw new Error("Arquivo de backup incompatível");
      }
      if (Number(manifest.version) === EXPORT_VERSION) {
        return await importStreaming(entries, manifest as BackupManifest, onProgress);
      }
      // Formato antigo: o JSZip lê o arquivo inteiro; o reader do zip.js não
      // participa dessa etapa e pode ser fechado no finally.
      return await importLegacy(file, manifest, onProgress);
    } finally {
      await reader.close().catch(() => {});
    }
  },
};
