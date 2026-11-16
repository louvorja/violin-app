/**
 * Limpeza manual das pastas de arquivos das bibliotecas.
 *
 * Monta a lista de caminhos que ainda têm registro no IndexedDB e deixa o
 * prune apagar só o que não é mais referenciado.
 *
 * @category helper-puro — usa IndexedDB e o adaptador OPFS.
 */
import $idb from "@/helpers/IndexedDB";
import { DB_TABLE } from "@/constants/DbTables";
import { managedLibraryRel, pruneLibraryFiles } from "@/helpers/LibraryFiles";

const TABLES = [
  DB_TABLE.MEDIA_LIBRARY,
  DB_TABLE.BACKGROUND_PROJECTION_LIBRARY,
  DB_TABLE.BACKGROUND_SOUND_LIBRARY,
  DB_TABLE.LITURGY_FILES,
  DB_TABLE.LITURGY_LIBRARY,
] as const;

function collect(value: unknown, out: Set<string>): void {
  if (typeof value === "string") {
    const rel = managedLibraryRel(value);
    if (rel) out.add(rel);
    return;
  }
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collect(item, out);
    return;
  }
  for (const item of Object.values(value as Record<string, unknown>)) collect(item, out);
}

export async function pruneOrphanLibraryFiles(): Promise<number> {
  const known = new Set<string>();
  for (const table of TABLES) {
    const rows = await $idb.getAll<Record<string, unknown>>(table).catch(() => []);
    for (const row of rows) collect(row, known);
  }
  return pruneLibraryFiles([...known]);
}
