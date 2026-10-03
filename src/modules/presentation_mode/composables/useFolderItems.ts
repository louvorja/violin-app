import { reactive } from "vue";
import { kindFromPath } from "../program/liturgy";
import { progressOf } from "../program/series";
import { readFolder, type LibraryEntry } from "./useFileLibrary";
import { useSeries } from "./useSeries";

/**
 * As pastas da biblioteca que estão no programa. O item guarda só o caminho:
 * o conteúdo é o que estiver na pasta na hora — o vídeo novo da série que
 * alguém pôs no OneDrive na sexta já aparece no sábado.
 */

/** Pasta → arquivos (sem subpastas), na ordem da biblioteca. */
const listings = reactive(new Map<string, LibraryEntry[]>());
const loading = new Map<string, Promise<LibraryEntry[]>>();

function load(dir: string): Promise<LibraryEntry[]> {
  const pending = loading.get(dir);
  if (pending) return pending;
  const job = readFolder(dir)
    .then((list) => {
      const files = (list ?? []).filter((e) => !e.isDir);
      listings.set(dir, files);
      return files;
    })
    .finally(() => loading.delete(dir));
  loading.set(dir, job);
  return job;
}

/** Pastas cuja série (se houver) já foi pedida ao disco. */
const seriesAsked = new Set<string>();

/** Os arquivos da pasta; dispara a leitura (da pasta e da série) na primeira vez. */
function filesOf(dir: string): LibraryEntry[] | undefined {
  if (!listings.has(dir)) void load(dir);
  if (!seriesAsked.has(dir)) {
    seriesAsked.add(dir);
    void useSeries().load(dir);
  }
  return listings.get(dir);
}

/** Os que contam para a série — o mesmo critério da barra de série da biblioteca. */
const seriesFiles = (files: LibraryEntry[]) => files.filter((e) => ["video", "image"].includes(kindFromPath(e.path)));

/** O próximo da série, ou null se a pasta não é série (ou a série terminou). */
async function nextOf(dir: string): Promise<LibraryEntry | null> {
  const series = useSeries();
  const [files] = await Promise.all([load(dir), series.load(dir)]);
  const doc = series.of(dir);
  if (!doc) return null;
  const candidates = seriesFiles(files);
  const next = progressOf(doc, candidates.map((e) => e.name)).next;
  return candidates.find((e) => e.name === next) ?? null;
}

/** Resumo para a linha do programa: quantos arquivos e, se for série, o próximo. */
function summaryOf(dir: string): { count: number; next: string | null; isSeries: boolean } | null {
  const files = filesOf(dir);
  if (!files) return null;
  const doc = useSeries().of(dir);
  const next = doc ? progressOf(doc, seriesFiles(files).map((e) => e.name)).next : null;
  return { count: files.length, next, isSeries: !!doc };
}

/**
 * O que o programa precisa ter no computador desta pasta: numa série, só o
 * próximo (a série inteira pode ter um gigabyte); numa pasta comum, tudo.
 */
function neededPathsOf(dir: string): string[] {
  const files = filesOf(dir);
  if (!files) return [];
  const summary = summaryOf(dir);
  if (!summary?.isSeries) return files.map((e) => e.path);
  const next = files.find((e) => e.name === summary.next);
  return next ? [next.path] : [];
}

export function useFolderItems() {
  return { filesOf, reload: load, nextOf, summaryOf, neededPathsOf };
}
