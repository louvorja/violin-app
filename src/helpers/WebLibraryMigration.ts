/**
 * Migração única das bibliotecas web do IndexedDB para o OPFS.
 *
 * Antes do OPFS, os bytes ficavam em `data` (Blob/ArrayBuffer) no IndexedDB.
 * A migração copia cada arquivo para `louvorja/<pasta>/<id>/<nome>`, confere o
 * tamanho e troca o registro por `path: "opfs:..."` + `size` + `mime`. O
 * registro antigo só é substituído depois da cópia confirmada; uma falha deixa
 * o registro como estava e a próxima abertura tenta de novo.
 *
 * Roda depois do Service Worker assumir, porque a URL `__opfs/...` só é
 * servida quando ele está controlando a página.
 *
 * @category deve-virar-composable — usa IndexedDB e OPFS.
 */
import $idb from "@/helpers/IndexedDB";
import { DB_TABLE } from "@/constants/DbTables";
import Path from "@/helpers/Path";
import { blobOf } from "@/helpers/Bytes";
import { extensionForMime, mimeForName } from "@/helpers/Mime";
import { useBackgroundTasks } from "@/composables/useBackgroundTasks";
import { i18nAtual } from "@/i18n";
import { createHashTap } from "@/helpers/Hash";
import {
  isOpfsSupported,
  opfsActive,
  opfsInfo,
  opfsPathOf,
  pruneOpfsTemp,
  removeOpfs,
  safeStorageName,
  writeOpfsStream,
} from "@/helpers/OpfsStore";
import { recoverPendingBackupRestore } from "@/helpers/DatabaseBackup";

const FLAG_KEY = "lj:web-library-opfs-v1";
const LOCK_KEY = "lj:opfs-migration";

const TABLES: { table: string; kind: string }[] = [
  { table: DB_TABLE.MEDIA_LIBRARY, kind: "media-library" },
  { table: DB_TABLE.BACKGROUND_PROJECTION_LIBRARY, kind: "background-projection" },
  { table: DB_TABLE.BACKGROUND_SOUND_LIBRARY, kind: "background-sound" },
  { table: DB_TABLE.LITURGY_FILES, kind: "liturgy-files" },
];

export interface MigrationResult {
  moved: number;
  failed: number;
  skipped: number;
  canceled?: boolean;
}

function fileNameOf(row: Record<string, unknown>, kind: string): string {
  const raw =
    (kind === "background-sound" ? row.fileName : undefined) || row.fileName || row.name || row.id;
  let name = String(raw || "arquivo");
  // Registro renomeado pode ter perdido a extensão; sem ela o Service Worker
  // não acerta o MIME (e um <img> com octet-stream não renderiza).
  if (!/\.[a-z\d]{2,5}$/i.test(name) && row.mime) {
    name = `${name}.${extensionForMime(String(row.mime))}`;
  }
  return safeStorageName(name);
}

async function migrateTable(
  table: string,
  kind: string,
  onProgress?: (_fraction: number) => void,
  shouldStop?: () => boolean
): Promise<MigrationResult> {
  const result: MigrationResult = { moved: 0, failed: 0, skipped: 0 };
  const rows = await $idb.getAll<Record<string, unknown>>(table).catch(() => []);
  for (const [index, row] of rows.entries()) {
    if (shouldStop?.()) {
      result.canceled = true;
      return result;
    }
    onProgress?.(rows.length ? (index + 1) / rows.length : 1);
    if (!row || typeof row.id !== "string" || !row.id) {
      result.skipped += 1;
      continue;
    }
    if (typeof row.path === "string" && row.path.startsWith("opfs:")) {
      result.skipped += 1;
      continue;
    }
    const blob = blobOf(row.data, String(row.mime || ""));
    if (!blob || !blob.size) {
      result.skipped += 1;
      continue;
    }

    const name = fileNameOf(row, kind);
    const rel = `${kind}/${row.id}/${name}`;
    const path = opfsPathOf(rel);
    try {
      const hash = createHashTap(blob.stream() as ReadableStream<Uint8Array>);
      await writeOpfsStream(rel, hash.stream, blob.size, { shouldStop });
      const info = await opfsInfo(rel);
      if (!info.exists || info.size !== blob.size) throw new Error("opfs_size_mismatch");

      const next: Record<string, unknown> = {
        ...row,
        path,
        size: blob.size,
        mime: String(row.mime || blob.type || mimeForName(name)),
        sha256: hash.digest(),
      };
      delete next.data;
      if (
        (kind === "media-library" || kind === "background-projection") &&
        row.type === "image" &&
        (!row.thumb || String(row.thumb).startsWith("blob:"))
      ) {
        next.thumb = Path.media(path);
      }
      await $idb.put(table, next as { id: string });
      result.moved += 1;
    } catch (error) {
      await removeOpfs(rel).catch(() => {});
      if (shouldStop?.()) {
        result.canceled = true;
        return result;
      }
      console.warn("[OPFS] migração falhou:", kind, row.id, error);
      result.failed += 1;
    }
  }
  return result;
}

/** Copia tudo o que ainda estiver no IndexedDB. Idempotente. */
export async function migrateWebLibrariesToOpfs(
  onProgress?: (_percent: number) => void,
  shouldStop?: () => boolean
): Promise<MigrationResult> {
  const total: MigrationResult = { moved: 0, failed: 0, skipped: 0 };
  if (!isOpfsSupported() || !opfsActive()) return total;
  for (const [index, { table, kind }] of TABLES.entries()) {
    const part = await migrateTable(
      table,
      kind,
      (fraction) => {
        onProgress?.(((index + fraction) / TABLES.length) * 100);
      },
      shouldStop
    );
    total.moved += part.moved;
    total.failed += part.failed;
    total.skipped += part.skipped;
    if (part.canceled) {
      total.canceled = true;
      break;
    }
  }
  if (total.canceled) return total;
  onProgress?.(100);
  if (total.moved > 0) {
    console.info("[OPFS] bibliotecas migradas:", total);
    await pruneOpfsTemp().catch(() => {});
  }
  return total;
}

function once(flag: string): boolean {
  try {
    return localStorage.getItem(flag) === "1";
  } catch {
    return false;
  }
}

function mark(flag: string): void {
  try {
    localStorage.setItem(flag, "1");
  } catch {
    /* modo privado sem storage: tenta de novo na próxima */
  }
}

/**
 * Agenda a migração para depois da primeira pintura. Não bloqueia o boot:
 * uma biblioteca grande pode levar alguns segundos.
 */
export function scheduleWebLibraryMigration(): void {
  if (!isOpfsSupported()) return;
  // Temporários de exportação e recuperação/limpeza de staging de backup.
  void pruneOpfsTemp().catch(() => {});
  void recoverPendingBackupRestore().catch(() => {});
  if (once(FLAG_KEY)) return;

  const run = () => {
    void (async () => {
      try {
        await navigator.serviceWorker?.ready;
      } catch {
        return;
      }
      if (!opfsActive()) return;

      const work = async (): Promise<void> => {
        if (once(FLAG_KEY)) return;
        const tasks = useBackgroundTasks();
        const id = "web-library-opfs";
        const translate = i18nAtual()?.global?.t;
        const label =
          (translate?.("shell.background_tasks.opfs_migration") as string | undefined) ||
          "Migrando biblioteca para o armazenamento do navegador";
        let canceled = false;
        tasks.registerTask(id, label, () => {
          canceled = true;
        });
        try {
          const result = await migrateWebLibrariesToOpfs(
            (percent) => {
              tasks.updateTask(id, { progress: Math.round(percent) });
            },
            () => canceled
          );
          if (result.canceled) return;
          if (result.failed === 0) {
            mark(FLAG_KEY);
            tasks.completeTask(id);
          } else {
            const message =
              (translate?.("shell.background_tasks.opfs_migration_failed") as string | undefined) ||
              "Alguns arquivos não puderam ser migrados. A próxima abertura tenta de novo.";
            tasks.updateTask(id, { status: "error", detail: message, error: message });
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          tasks.updateTask(id, { status: "error", detail: message, error: message });
          throw error;
        }
      };

      const locks = (navigator as Navigator & { locks?: LockManager }).locks;
      if (locks?.request) {
        await locks
          .request(LOCK_KEY, { ifAvailable: true }, async (lock) => {
            if (!lock) return;
            await work();
          })
          .catch(() => {});
      } else {
        await work();
      }
    })();
  };

  const idle = (window as Window & { requestIdleCallback?: (cb: () => void) => number })
    .requestIdleCallback;
  if (idle) idle(run);
  else setTimeout(run, 3000);
}
