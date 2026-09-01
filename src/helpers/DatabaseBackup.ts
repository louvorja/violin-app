import JSZip from "jszip";
import { DB_NAME, DB_TABLE } from "@/constants/DbTables";
import $idb from "@/helpers/IndexedDB";

const EXPORT_FORMAT = "louvorja-violin-db";
const EXPORT_VERSION = 1;

const BACKUP_TABLES = Array.from(new Set(Object.values(DB_TABLE)));

interface BackupManifestTable {
  name: string;
  rows: number;
}

interface BackupManifest {
  format: string;
  version: number;
  db_name: string;
  exported_at: string;
  app_version: string;
  tables: BackupManifestTable[];
}

export interface BackupExportResult {
  fileName: string;
  tables: number;
  rows: number;
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

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.rel = "noopener";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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

export default {
  async exportAll(onProgress?: (_progress: BackupProgress) => void): Promise<BackupExportResult> {
    const zip = new JSZip();
    const manifestTables: BackupManifestTable[] = [];
    let totalRows = 0;

    for (const table of BACKUP_TABLES) {
      onProgress?.({ phase: "export", current: manifestTables.length + 1, total: BACKUP_TABLES.length, detail: table });
      const rows = await $idb.getAll<Record<string, unknown>>(table);
      manifestTables.push({ name: table, rows: rows.length });
      totalRows += rows.length;
      zip.file(tableFileName(table), JSON.stringify(rows, null, 2));
    }

    const manifest: BackupManifest = {
      format: EXPORT_FORMAT,
      version: EXPORT_VERSION,
      db_name: DB_NAME,
      exported_at: new Date().toISOString(),
      app_version: import.meta.env.VITE_APP_VERSION || "",
      tables: manifestTables,
    };

    zip.file(manifestFileName(), JSON.stringify(manifest, null, 2));

    const blob = await zip.generateAsync({
      type: "blob",
      compression: "DEFLATE",
      compressionOptions: { level: 9 },
    });

    downloadBlob(blob, exportFileName());

    return {
      fileName: exportFileName(),
      tables: BACKUP_TABLES.length,
      rows: totalRows,
    };
  },

  async importAll(file: File, onProgress?: (_progress: BackupProgress) => void): Promise<BackupImportResult> {
    onProgress?.({ phase: "import", current: 0, total: 4, detail: "loading" });
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const manifestRaw = await readTextFile(zip, manifestFileName());
    const manifest = JSON.parse(manifestRaw) as Partial<BackupManifest>;

    if (manifest.format !== EXPORT_FORMAT || manifest.version !== EXPORT_VERSION) {
      throw new Error("Arquivo de backup incompatível");
    }

    const tables = Array.isArray(manifest.tables) ? manifest.tables : [];
    const tableNames = tables
      .map((entry) => entry?.name)
      .filter((name): name is string => typeof name === "string" && BACKUP_TABLES.includes(name));

    if (tableNames.length === 0) {
      throw new Error("Arquivo de backup sem tabelas");
    }

    const data = new Map<string, Array<Record<string, unknown>>>();
    let totalRows = 0;
    let step = 0;

    for (const table of tableNames) {
      step += 1;
      onProgress?.({ phase: "import", current: step, total: tableNames.length + 2, detail: table });
      const raw = JSON.parse(await readTextFile(zip, tableFileName(table)));
      const rows = normalizeRows(raw, table);
      data.set(table, rows);
      totalRows += rows.length;
    }

    step = tableNames.length + 1;
    onProgress?.({ phase: "import", current: step, total: tableNames.length + 2, detail: "clearing" });
    for (const table of BACKUP_TABLES) {
      await $idb.clear(table);
    }

    step = tableNames.length + 2;
    onProgress?.({ phase: "import", current: step, total: tableNames.length + 2, detail: "writing" });
    for (const [table, rows] of data) {
      for (const row of rows) {
        await $idb.put(table, row as { id: string });
      }
    }

    return {
      tables: data.size,
      rows: totalRows,
    };
  },
};
