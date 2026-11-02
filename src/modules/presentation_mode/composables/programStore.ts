import { reactive } from "vue";
import $docs from "@/helpers/DocStore";
import Telemetry from "@/helpers/Telemetry";
import { DB_TABLE } from "@/constants/DbTables";
import type { Program } from "@/types/Presentation";
import { fromPortable, mapPaths, toPortable } from "../program/portable";
import { churchFiles, computerName, useChurchFolder } from "./useChurchFolder";

/**
 * Onde o programa do culto mora.
 *
 * Sem pasta da igreja, como sempre: um documento por data no DocStore deste
 * computador. Com ela, o arquivo `LouvorJA/programas/AAAA-MM-DD.json` da pasta
 * é a versão que vale — o DocStore fica como cópia local, para abrir o
 * programa mesmo com o OneDrive fora do ar.
 *
 * Nada de um computador apaga o trabalho do outro: a gravação só acontece se
 * o arquivo ainda for o que se leu (`expectMtime`). Se o outro computador
 * salvou no meio de uma edição daqui, ou se o OneDrive criou cópias em
 * conflito, o estado vira `conflict` e o operador escolhe a versão.
 */

const TABLE = DB_TABLE.PRESENTATION_PROGRAMS;
/** As edições vêm em rajada (arrastar, digitar): grava depois que assentam. */
const SAVE_DELAY_MS = 500;

export interface ChurchProgramFile {
  version: 1;
  savedBy: string;
  savedAt: string;
  /** Com os caminhos da pasta da igreja como `igreja:…`. */
  program: Program;
}

export type SyncState = "local" | "saving" | "saved" | "unavailable" | "conflict" | "error";

export const sync = reactive({
  state: "local" as SyncState,
  savedAt: "",
  savedBy: "",
  /** Quando o programa foi recarregado com o que outro computador salvou. */
  externalAt: 0,
  /** O arquivo mudou no disco enquanto havia edição daqui por gravar. */
  diskChanged: false,
  /** Cópias em conflito que o sincronizador criou ao lado do arquivo. */
  conflicts: [] as string[],
});

let _date: string | null = null;
/** mtime do arquivo como foi lido/gravado; `null`: não existia; `undefined`: não deu para ler. */
let _mtime: number | null | undefined;
let _pending: Program | null = null;
let _timer: ReturnType<typeof setTimeout> | null = null;
let _writing: Promise<boolean> | null = null;

const rootOf = () => useChurchFolder().root.value;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const toFile = (p: Program) => mapPaths(clone(p), (x) => toPortable(x, rootOf()));
const fromFile = (p: Program) => mapPaths(p, (x) => fromPortable(x, rootOf()));

function validFile(doc: unknown): doc is ChurchProgramFile {
  const p = (doc as ChurchProgramFile | null)?.program;
  return !!p && typeof p.date === "string" && Array.isArray(p.sessions);
}

async function cacheLocal(program: Program): Promise<void> {
  try {
    await $docs.put(TABLE, clone(program));
  } catch (e) {
    Telemetry.captureException(e, { source: "presentation_program_save" });
  }
}

function stamp(file: ChurchProgramFile): void {
  sync.savedAt = file.savedAt;
  sync.savedBy = file.savedBy;
}

async function writeNow(program: Program, force = false): Promise<boolean> {
  const file: ChurchProgramFile = {
    version: 1,
    savedBy: await computerName(),
    savedAt: new Date().toISOString(),
    program: toFile(program),
  };
  const expect = force || _mtime === undefined ? undefined : _mtime;
  const res = await churchFiles.write("program", program.date, file, expect);
  if (res.ok) {
    _mtime = res.mtimeMs;
    stamp(file);
    if (force) sync.diskChanged = false;
    sync.state = sync.conflicts.length || sync.diskChanged ? "conflict" : "saved";
    return true;
  }
  if (res.error === "changed") {
    // Outro computador salvou depois da nossa leitura: não sobrescreve.
    sync.diskChanged = true;
    sync.state = "conflict";
    _pending = program;
    return false;
  }
  sync.state = res.error === "missing_root" ? "unavailable" : "error";
  Telemetry.track("presentation_church_save_failed", { error: res.error });
  return false;
}

/** Grava já o que está esperando (troca de data, fechar o módulo). */
export async function flushProgram(): Promise<void> {
  if (_timer) clearTimeout(_timer);
  _timer = null;
  const program = _pending;
  if (!program || sync.diskChanged || !rootOf()) return;
  _pending = null;
  _writing = writeNow(program);
  await _writing;
  _writing = null;
}

async function refreshConflicts(date: string): Promise<void> {
  const st = await churchFiles.stat("program", date);
  sync.conflicts = st.ok ? st.conflicts : [];
  if (sync.conflicts.length) sync.state = "conflict";
}

export async function loadProgram(date: string): Promise<Program | undefined> {
  await flushProgram();
  _date = date;
  _mtime = undefined;
  _pending = null;
  Object.assign(sync, {
    diskChanged: false,
    conflicts: [],
    externalAt: 0,
    savedAt: "",
    savedBy: "",
  });

  const cached = await $docs.get<Program>(TABLE, date).catch(() => undefined);
  if (!rootOf()) {
    sync.state = "local";
    return cached;
  }
  const res = await churchFiles.read<ChurchProgramFile>("program", date);
  if (!res.ok || (res.doc && !validFile(res.doc))) {
    // Pasta fora do ar ou arquivo meio sincronizado: abre a cópia deste computador.
    sync.state = "unavailable";
    return cached;
  }
  _mtime = res.mtimeMs;
  if (!res.doc) {
    sync.state = "saved";
    // Ainda não existe na pasta: o que este computador já tinha vai para lá.
    if (cached?.sessions.length) await writeNow(cached);
    return cached;
  }
  stamp(res.doc);
  sync.state = "saved";
  const program = fromFile(res.doc.program);
  void cacheLocal(program);
  await refreshConflicts(date);
  return program;
}

export function saveProgram(program: Program): void {
  void cacheLocal(program);
  if (!rootOf() || program.date !== _date) return;
  _pending = program;
  if (sync.state !== "conflict") sync.state = "saving";
  if (sync.diskChanged) return;
  if (_timer) clearTimeout(_timer);
  _timer = setTimeout(() => void flushProgram(), SAVE_DELAY_MS);
}

/**
 * Confere a pasta: chegou versão de outro computador? Devolve o programa novo
 * para pôr no lugar (só quando não há edição daqui por gravar).
 */
export async function checkRemote(): Promise<Program | null> {
  const date = _date;
  if (!rootOf() || !date || _writing) return null;
  const st = await churchFiles.stat("program", date);
  if (date !== _date) return null;
  if (!st.ok) {
    sync.state = "unavailable";
    return null;
  }
  sync.conflicts = st.conflicts;
  if (st.conflicts.length) sync.state = "conflict";
  else if (sync.state === "unavailable" || (sync.state === "conflict" && !sync.diskChanged))
    sync.state = "saved";
  if (_mtime === undefined || st.mtimeMs === _mtime) return null;
  if (_pending) {
    sync.diskChanged = true;
    sync.state = "conflict";
    return null;
  }
  const res = await churchFiles.read<ChurchProgramFile>("program", date);
  if (!res.ok || !res.doc || !validFile(res.doc) || date !== _date) return null;
  _mtime = res.mtimeMs;
  stamp(res.doc);
  sync.externalAt = Date.now();
  const program = fromFile(res.doc.program);
  void cacheLocal(program);
  return program;
}

export interface ProgramVersion {
  /** `local` (este computador, não salvo), `main` (o arquivo) ou o nome da cópia. */
  key: string;
  savedBy: string;
  savedAt: string;
  program: Program;
}

/** As versões em disputa, para o operador escolher. */
export async function conflictVersions(current: Program): Promise<ProgramVersion[]> {
  const date = current.date;
  const out: ProgramVersion[] = [];
  if (sync.diskChanged) {
    out.push({
      key: "local",
      savedBy: await computerName(),
      savedAt: current.updatedAt,
      program: current,
    });
  }
  const main = await churchFiles.read<ChurchProgramFile>("program", date);
  if (main.ok && main.doc && validFile(main.doc)) {
    out.push({
      key: "main",
      savedBy: main.doc.savedBy,
      savedAt: main.doc.savedAt,
      program: fromFile(main.doc.program),
    });
  }
  const copies = await churchFiles.conflicts<ChurchProgramFile>("program", date);
  if (copies.ok) {
    for (const c of copies.copies) {
      if (c.doc && validFile(c.doc)) {
        out.push({
          key: c.file,
          savedBy: c.doc.savedBy,
          savedAt: c.doc.savedAt,
          program: fromFile(c.doc.program),
        });
      }
    }
  }
  return out;
}

/** Fica com uma versão: ela passa a ser o arquivo, e as cópias somem. */
export async function resolveConflict(key: string, current: Program): Promise<Program | null> {
  const date = current.date;
  if (key === "local") {
    if (!(await writeNow(current, true))) return null;
    await churchFiles.resolve("program", date, "main");
    _pending = null;
    sync.conflicts = [];
    sync.state = "saved";
    return current;
  }
  const res = await churchFiles.resolve("program", date, key);
  if (!res.ok) return null;
  _pending = null;
  sync.diskChanged = false;
  return (await loadProgram(date)) ?? null;
}
