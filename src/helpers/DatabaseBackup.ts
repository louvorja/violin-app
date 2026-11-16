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
  collectManagedLibraryRels,
  extractManagedLibraryRel,
  isManagedLibraryPath,
  openDesktopLibraryFile,
} from "@/helpers/LibraryFiles";
import {
  copyOpfsFile,
  isOpfsRel,
  isOpfsSupported,
  listOpfs,
  listOpfsStagingTokens,
  opfsInfo,
  opfsPathOf,
  opfsUrl,
  pruneOpfsStaging,
  readOpfsFile,
  readOpfsText,
  relOf,
  removeOpfs,
  removeStaging,
  stagingJournalRel,
  stagingRel,
  writeOpfsStream,
  writeOpfsText,
} from "@/helpers/OpfsStore";
import Path from "@/helpers/Path";
import { mimeForName } from "@/helpers/Mime";
import { assertWebQuota } from "@/helpers/StorageLimits";
import Platform from "@/helpers/Platform";

const EXPORT_FORMAT = "louvorja-violin-db";
const EXPORT_VERSION = 3;
const BACKUP_LOCK_KEY = "lj:opfs-backup-restore";
const BACKUP_COMMIT_MARKER_ID = "__backup_commit__";

const BACKUP_TABLES = Array.from(new Set(Object.values(DB_TABLE)));

interface BackupManifestTable {
  name: string;
  rows: number;
}

interface BackupManifestFile {
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
  platform?: "desktop" | "web";
  tables: BackupManifestTable[];
  opfs?: BackupManifestFile[];
  library?: BackupManifestFile[];
}

interface OpfsRestoreJournal {
  token: string;
  status: "committing-files" | "committing-db" | "committed";
  hasLibraryFiles: boolean;
  files: Array<{ rel: string; existed: boolean }>;
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

function adaptStringForTarget(value: string, target: "desktop" | "web"): string {
  const rel = extractManagedLibraryRel(value);
  if (!rel) return value;
  const trimmed = value.trim();
  if (target === "desktop") {
    if (trimmed.startsWith("opfs:")) return rel;
    if (/(?:^|\/)__opfs\//.test(trimmed)) return Path.media(rel);
    return value;
  }
  if (/^louvorja:\/\/files\//i.test(trimmed)) return opfsUrl(rel);
  if (!trimmed.startsWith("opfs:") && isManagedLibraryPath(trimmed)) return opfsPathOf(rel);
  return value;
}

function adaptValueForTarget(value: unknown, target: "desktop" | "web"): unknown {
  if (typeof value === "string") return adaptStringForTarget(value, target);
  if (!value || typeof value !== "object") return value;
  if (value instanceof Blob || value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => adaptValueForTarget(item, target));
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = adaptValueForTarget(v, target);
  }
  return out;
}

function adaptRowsForTargetPlatform(
  data: Map<string, Array<Record<string, unknown>>>,
  target: "desktop" | "web" | null
): void {
  if (!target) return;
  for (const [table, rows] of data) {
    data.set(
      table,
      rows
        .filter((row) => !(table === DB_TABLE.CACHE && row.id === BACKUP_COMMIT_MARKER_ID))
        .map((row) => adaptValueForTarget(row, target) as Record<string, unknown>)
    );
  }
}

async function withBackupLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks =
    typeof navigator !== "undefined"
      ? (navigator as Navigator & { locks?: LockManager }).locks
      : undefined;
  if (!locks?.request) return fn();
  return locks.request(BACKUP_LOCK_KEY, { ifAvailable: true }, async (lock) => {
    if (!lock) {
      throw new Error("Já existe uma restauração de backup em andamento em outra aba.");
    }
    return fn();
  });
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
    const rows = await $idb.getAll<Record<string, unknown>>(table);
    rowsByTable.set(
      table,
      table === DB_TABLE.CACHE
        ? rows.filter((row) => row.id !== BACKUP_COMMIT_MARKER_ID)
        : rows
    );
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
  const opfsFiles: BackupManifestFile[] = [];
  const libraryFiles: BackupManifestFile[] = [];
  const seenFiles = new Set<string>();
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

      if (Platform.isDesktop) {
        for (const rel of collectManagedLibraryRels(rows)) {
          if (seenFiles.has(rel)) continue;
          seenFiles.add(rel);
          const source = await openDesktopLibraryFile(rel);
          if (!source) continue;
          const stream = await source.open().catch(() => null);
          if (!stream) continue;
          const zipPath = `library/${rel}`;
          await writer.add(
            zipPath,
            { readable: stream, size: source.size },
            { level: 0 }
          );
          libraryFiles.push({
            path: rel,
            zipPath,
            size: source.size,
            mime: source.mime || mimeForName(rel),
          });
        }
      } else {
        for (const rel of collectOpfsPaths(rows)) {
          if (seenFiles.has(rel) || !isOpfsRel(rel)) continue;
          seenFiles.add(rel);
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
    }

    const manifest: BackupManifest = {
      format: EXPORT_FORMAT,
      version: EXPORT_VERSION,
      db_name: DB_NAME,
      exported_at: new Date().toISOString(),
      app_version: import.meta.env.VITE_APP_VERSION || "",
      platform: Platform.isDesktop ? "desktop" : "web",
      tables: manifestTables,
      opfs: opfsFiles,
      ...(libraryFiles.length ? { library: libraryFiles } : {}),
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

async function commitDatabaseTables(
  data: Map<string, Array<Record<string, unknown>>>,
  commitMarker?: { table: string; row: { id: string; token: string } }
): Promise<Map<string, Array<Record<string, unknown>>> | null> {
  const idbWithBatch = $idb as typeof $idb & {
    replaceAllTables?: (
      _data: ReadonlyMap<string, ReadonlyArray<{ id: string }>>,
      _clearTables: readonly string[],
      _commitMarker?: { table: string; row: { id: string } }
    ) => Promise<void>;
  };

  if (typeof idbWithBatch.replaceAllTables === "function") {
    await idbWithBatch.replaceAllTables(
      data as unknown as ReadonlyMap<string, ReadonlyArray<{ id: string }>>,
      BACKUP_TABLES,
      commitMarker
    );
    return null;
  }

  const previous = await snapshotTables();
  try {
    for (const table of BACKUP_TABLES) await $idb.clear(table);
    for (const [table, rows] of data) {
      for (const row of rows) await $idb.put(table, row as { id: string });
    }
    if (commitMarker) {
      await $idb.put(commitMarker.table, commitMarker.row);
    }
    return previous;
  } catch (error) {
    await restoreTables(previous).catch((restoreError) => {
      console.error("[Backup] rollback do banco falhou:", restoreError);
    });
    throw error;
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

  onProgress?.({
    phase: "import",
    current: tableNames.length + 1,
    total: tableNames.length + 2,
    detail: "writing",
  });
  await commitDatabaseTables(data);

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
  // Backup sem OPFS não deve apagar um acervo OPFS pré-existente sem solicitação.
  if (!known.size && !force) return 0;
  let removed = 0;
  for (const entry of await listOpfs()) {
    if (known.has(entry.rel)) continue;
    if (await removeOpfs(entry.rel).catch(() => false)) removed += 1;
  }
  return removed;
}

function entryReadableStream(entry: import("@zip.js/zip.js").FileEntry): ReadableStream<Uint8Array> {
  const stream = new TransformStream<Uint8Array, Uint8Array>();
  void entry.getData(stream.writable).catch((error: unknown) => {
    void stream.writable.abort(error).catch(() => {});
  });
  return stream.readable;
}

async function writeStreamToDesktopStaging(
  restoreToken: string,
  rel: string,
  size: number,
  stream: ReadableStream<Uint8Array>
): Promise<void> {
  const desktop = (Platform.api as LouvorjaApi | null)?.libraryFiles;
  if (!desktop?.stageBegin) {
    throw new Error("API desktop indisponível para restaurar arquivos da biblioteca.");
  }
  const { token } = await desktop.stageBegin({ restoreToken, rel, size });
  const reader = stream.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      await desktop.write(token, value);
    }
    await desktop.end(token);
  } catch (error) {
    await desktop.abort(token).catch(() => {});
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}

async function rollbackOpfsJournal(journal: OpfsRestoreJournal): Promise<void> {
  for (const item of [...journal.files].reverse()) {
    try {
      if (item.existed) {
        const rbRel = stagingRel(journal.token, "rollback", item.rel);
        if ((await opfsInfo(rbRel)).exists) {
          await copyOpfsFile(rbRel, item.rel);
        }
      } else {
        await removeOpfs(item.rel);
      }
    } catch (error) {
      console.error("[Backup] rollback do arquivo OPFS falhou:", item.rel, error);
    }
  }
}

async function clearBackupCommitMarker(expectedToken?: string): Promise<void> {
  try {
    const idb = $idb as typeof $idb & {
      get?: <T>(_table: string, _id: string) => Promise<T | undefined>;
      del?: (_table: string, _id: string) => Promise<void>;
    };
    if (typeof idb.del !== "function") return;
    if (expectedToken && typeof idb.get === "function") {
      const current = await idb
        .get<{ id: string; token?: string }>(DB_TABLE.CACHE, BACKUP_COMMIT_MARKER_ID)
        .catch(() => undefined);
      if (current && current.token !== expectedToken) return;
    }
    await idb.del(DB_TABLE.CACHE, BACKUP_COMMIT_MARKER_ID);
  } catch {
    /* melhor esforço após commit */
  }
}

/**
 * Recupera ou limpa uma restauração web interrompida no boot, respeitando o
 * bloqueio entre abas para nunca apagar staging de uma restauração ativa.
 */
export async function recoverPendingBackupRestore(): Promise<void> {
  if (Platform.isDesktop || !isOpfsSupported()) return;
  await withBackupLock(async () => {
    const tokens = await listOpfsStagingTokens();
    const idb = $idb as typeof $idb & {
      get?: <T>(_table: string, _id: string) => Promise<T | undefined>;
    };
    const commitMarker =
      typeof idb.get === "function"
        ? await idb
            .get<{ id: string; token?: string }>(DB_TABLE.CACHE, BACKUP_COMMIT_MARKER_ID)
            .catch(() => undefined)
        : undefined;

    for (const token of tokens) {
      const raw = await readOpfsText(stagingJournalRel(token)).catch(() => null);
      if (!raw) {
        await removeStaging(token).catch(() => {});
        continue;
      }
      let journal: OpfsRestoreJournal | null = null;
      try {
        journal = JSON.parse(raw) as OpfsRestoreJournal;
      } catch {
        journal = null;
      }
      if (!journal || journal.token !== token) {
        await removeStaging(token).catch(() => {});
        continue;
      }
      const dbCommitted =
        journal.status === "committed" ||
        (commitMarker?.token !== undefined && commitMarker.token === token);
      if (!dbCommitted && journal.status !== "committing-files" && journal.status !== "committing-db") {
        await removeStaging(token).catch(() => {});
        continue;
      }
      if (!dbCommitted) {
        await rollbackOpfsJournal(journal);
      } else {
        await clearBackupCommitMarker(token);
      }
      await removeStaging(token).catch(() => {});
    }
    await pruneOpfsStaging().catch(() => false);
  }).catch(() => {});
}

function collectIncomingManifestFiles(manifest: BackupManifest): BackupManifestFile[] {
  const seen = new Set<string>();
  const out: BackupManifestFile[] = [];
  for (const list of [manifest.opfs, manifest.library]) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (
        !item ||
        typeof item.path !== "string" ||
        !isManagedLibraryPath(item.path) ||
        !isOpfsRel(item.path) ||
        item.path.startsWith("liturgy-temp/") ||
        typeof item.zipPath !== "string"
      ) {
        continue;
      }
      const normalizedRel = item.path.replace(/\\/g, "/");
      if (seen.has(normalizedRel)) continue;
      seen.add(normalizedRel);
      out.push({ ...item, path: normalizedRel });
    }
  }
  return out;
}

async function importStreaming(
  entries: import("@zip.js/zip.js").Entry[],
  manifest: BackupManifest,
  onProgress?: (_progress: BackupProgress) => void
): Promise<BackupImportResult> {
  const { TextWriter, Uint8ArrayWriter } = await loadZipJs();
  const token = crypto.randomUUID();
  const stagedOpfs: { rel: string; stagedRel: string; size: number }[] = [];
  const committedOpfs: { rel: string; existed: boolean }[] = [];
  const stagedDesktopRels: string[] = [];
  let desktopCommitted: Array<{ rel: string; existed: boolean }> = [];
  let previousFallback: Map<string, Array<Record<string, unknown>>> | null = null;
  let opfsJournal: OpfsRestoreJournal | null = null;
  let dbCommitted = false;

  try {
    const byPath = new Map(
      entries
        .filter((entry) => !entry.directory)
        .map((entry) => [
          entry.filename.replace(/\\/g, "/").toLowerCase(),
          entry as import("@zip.js/zip.js").FileEntry,
        ])
    );

    const tables = Array.isArray(manifest.tables) ? manifest.tables : [];
    const tableNames = tables
      .map((entry) => entry?.name)
      .filter((name): name is string => typeof name === "string" && BACKUP_TABLES.includes(name));
    if (tableNames.length === 0) throw new Error("Arquivo de backup sem tabelas");

    const incomingFiles = collectIncomingManifestFiles(manifest);
    if (incomingFiles.length && !Platform.isDesktop && !isOpfsSupported()) {
      throw new Error(
        "Este navegador não suporta OPFS para restaurar arquivos da biblioteca; use um navegador compatível ou o aplicativo desktop."
      );
    }

    const total = incomingFiles.length * 2 + tableNames.length + 4;
    let step = 0;

    // Confere todas as entradas antes de gravar qualquer arquivo.
    for (const item of incomingFiles) {
      if (!byPath.has(item.zipPath.toLowerCase())) {
        throw new Error(`Arquivo da biblioteca ausente no backup: ${item.zipPath}`);
      }
    }

    // Decodifica e valida todas as tabelas antes de tocar no destino.
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

    const targetPlatform = Platform.isDesktop
      ? "desktop"
      : isOpfsSupported()
        ? "web"
        : null;
    adaptRowsForTargetPlatform(data, targetPlatform);

    // 1) Tudo vai primeiro para staging; nada do destino foi alterado ainda.
    for (const item of incomingFiles) {
      const entry = byPath.get(item.zipPath.toLowerCase())!;
      step += 1;
      onProgress?.({ phase: "import", current: step, total, detail: item.path });
      if (Platform.isDesktop) {
        await writeStreamToDesktopStaging(token, item.path, item.size, entryReadableStream(entry));
        stagedDesktopRels.push(item.path);
      } else {
        const stagedRelPath = stagingRel(token, "restore", item.path);
        await writeOpfsStream(stagedRelPath, entryReadableStream(entry), item.size);
        stagedOpfs.push({ rel: item.path, stagedRel: stagedRelPath, size: item.size });
      }
    }

    // 2) Commit dos arquivos preservando cópia/rename para rollback.
    if (Platform.isDesktop) {
      if (stagedDesktopRels.length) {
        const desktop = (Platform.api as LouvorjaApi | null)?.libraryFiles;
        const result = await desktop!.commitRestore(token, stagedDesktopRels);
        desktopCommitted = result.committed;
      }
    } else if (stagedOpfs.length) {
      const planned: Array<{ rel: string; existed: boolean }> = [];
      for (const item of stagedOpfs) {
        planned.push({ rel: item.rel, existed: (await opfsInfo(item.rel)).exists });
      }
      opfsJournal = {
        token,
        status: "committing-files",
        hasLibraryFiles: true,
        files: planned,
      };
      await writeOpfsText(stagingJournalRel(token), JSON.stringify(opfsJournal));

      for (let i = 0; i < stagedOpfs.length; i++) {
        const item = stagedOpfs[i];
        const { existed } = planned[i];
        step += 1;
        onProgress?.({ phase: "import", current: step, total, detail: item.rel });
        if (existed) await copyOpfsFile(item.rel, stagingRel(token, "rollback", item.rel));
        committedOpfs.push({ rel: item.rel, existed });
        await copyOpfsFile(item.stagedRel, item.rel);
      }

      opfsJournal = { ...opfsJournal, status: "committing-db" };
      await writeOpfsText(stagingJournalRel(token), JSON.stringify(opfsJournal));
    }

    // 3) Commit atômico do IndexedDB com marcador da transação.
    step += 1;
    onProgress?.({ phase: "import", current: step, total, detail: "writing" });
    const marker =
      !Platform.isDesktop && opfsJournal
        ? { table: DB_TABLE.CACHE, row: { id: BACKUP_COMMIT_MARKER_ID, token } }
        : undefined;
    previousFallback = await commitDatabaseTables(data, marker);
    dbCommitted = true;

    // 4) Limpeza pós-commit.
    if (Platform.isDesktop) {
      await (Platform.api as LouvorjaApi | null)?.libraryFiles
        ?.cleanupRestore(token)
        .catch(() => {});
    } else {
      if (opfsJournal) {
        await writeOpfsText(
          stagingJournalRel(token),
          JSON.stringify({ ...opfsJournal, status: "committed" })
        ).catch(() => {});
      }
      await removeStaging(token).catch(() => {});
      await clearBackupCommitMarker(token);
      step += 1;
      onProgress?.({ phase: "import", current: step, total, detail: "cleaning" });
      await cleanupOpfsOrphans(data, incomingFiles.length > 0).catch((error) => {
        console.warn("[Backup] limpeza de OPFS falhou:", error);
      });
    }
    onProgress?.({ phase: "import", current: total, total, detail: "done" });

    return { tables: data.size, rows: totalRows };
  } catch (error) {
    if (!dbCommitted) {
      if (Platform.isDesktop) {
        const desktop = (Platform.api as LouvorjaApi | null)?.libraryFiles;
        if (desktopCommitted.length) {
          await desktop?.rollbackRestore(token, desktopCommitted).catch(() => {});
        } else {
          await desktop?.cleanupRestore(token).catch(() => {});
        }
      } else {
        for (const item of committedOpfs.reverse()) {
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
      }
      if (previousFallback) {
        await restoreTables(previousFallback).catch((restoreError) => {
          console.error("[Backup] rollback do banco falhou:", restoreError);
        });
      }
    }
    throw error;
  }
}

export default {
  recoverPendingBackupRestore,

  async exportAll(onProgress?: (_progress: BackupProgress) => void): Promise<BackupExportResult> {
    return exportStreaming(onProgress);
  },

  async importAll(
    file: File,
    onProgress?: (_progress: BackupProgress) => void
  ): Promise<BackupImportResult> {
    return withBackupLock(async () => {
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
    });
  },
};
