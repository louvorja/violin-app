import $idb from "@/helpers/IndexedDB";
import { DB_TABLE } from "@/constants/DbTables";
import Telemetry from "@/helpers/Telemetry";

const TABLE = DB_TABLE.ANNOUNCEMENTS;

interface StoredAnnouncement {
  ordem?: number;
  imageData?: unknown;
  imageMime?: unknown;
  videoData?: unknown;
  videoMime?: unknown;
}

function asBlob(data: unknown, mime: unknown, fallback: string): unknown {
  if (!(data instanceof ArrayBuffer)) return data;
  return new Blob([data], { type: typeof mime === "string" && mime ? mime : fallback });
}

/**
 * Mídia guardada como ArrayBuffer entra inteira na memória da tela a cada leitura e é
 * copiada a cada gravação e a cada envio ao telão; como Blob, o IndexedDB a deixa no
 * disco e lê, grava e transmite só a referência.
 */
export function withBlobMedia<T>(value: T): T {
  if (!value || typeof value !== "object") return value;
  const record = value as StoredAnnouncement;
  if (!(record.imageData instanceof ArrayBuffer) && !(record.videoData instanceof ArrayBuffer))
    return value;
  return {
    ...value,
    imageData: asBlob(record.imageData, record.imageMime, "image/jpeg"),
    videoData: asBlob(record.videoData, record.videoMime, "video/mp4"),
  };
}

let migration: Promise<void> | null = null;

function migrateLegacyMedia(): Promise<void> {
  // Registro a registro: um getAll traria todos os vídeos antigos para a memória de uma vez.
  migration ??= $idb
    .rewriteRecords(TABLE, withBlobMedia)
    .then(() => undefined)
    .catch((error) => {
      migration = null;
      Telemetry.captureException(error, { operation: "announcements_media_migration" });
    });
  return migration;
}

export async function loadAnnouncements<T extends { ordem?: number }>(): Promise<T[]> {
  await migrateLegacyMedia();
  const rows = await $idb.getAll<T>(TABLE);
  return rows.map(withBlobMedia).sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
}
