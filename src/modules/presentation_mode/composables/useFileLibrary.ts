import { computed, ref } from "vue";
import $userdata from "@/helpers/UserData";
import Platform from "@/helpers/Platform";
import Telemetry from "@/helpers/Telemetry";
import { KEYS } from "@/constants/UserDataKeys";
import { AUDIO_EXT, IMAGE_EXT, VIDEO_EXT } from "@/constants/FileTypes";
import { SLJA_EXT } from "@/helpers/SljaPlayer";
import { isPowerPoint, POWERPOINT_ENABLED } from "./usePowerPoint";

/**
 * Navegador de arquivos do Modo apresentação.
 *
 * As pastas são escolha do operador e ficam nas preferências; o conteúdo
 * delas é lido do disco a cada visita (um nível só). "Todos" junta o primeiro
 * nível de todas as pastas; "Favoritos" são arquivos marcados com estrela,
 * guardados com o que a grade precisa para mostrá-los sem reler o disco.
 *
 * Só aparece o que o app sabe projetar — o resto seria um clique que não faz
 * nada no meio do culto.
 *
 * As abas Arquivos, Mídia e Áudio olham as mesmas pastas, cada uma com o seu
 * recorte (`LibraryScope`) e a sua navegação: abrir uma subpasta em Mídia não
 * mexe em Arquivos. Pastas, favoritos e a fila de Anterior/Próximo são uma
 * coisa só.
 */

export interface LibraryFolder {
  path: string;
  label: string;
}

export interface LibraryEntry {
  name: string;
  path: string;
  isDir: boolean;
  ext: string;
  size: number;
  mtimeMs: number;
}

export type LibraryFileKind = "image" | "video" | "audio" | "pdf" | "powerpoint" | "slja";

/** O recorte de cada aba: Arquivos mostra tudo; Mídia, fotos e vídeos; Áudio, áudios. */
export type LibraryScope = "files" | "media" | "audio";

const SCOPE_KINDS: Record<LibraryScope, LibraryFileKind[] | null> = {
  files: null,
  media: ["image", "video"],
  audio: ["audio"],
};

/** O arquivo entra no recorte (pastas sempre entram: é por elas que se navega). */
export function inScope(entry: Pick<LibraryEntry, "isDir" | "ext">, scope: LibraryScope): boolean {
  if (entry.isDir) return true;
  const kinds = SCOPE_KINDS[scope];
  const kind = fileKind(entry.ext);
  return kind !== null && (!kinds || kinds.includes(kind));
}

export const ALL = "__all__";
export const FAVORITES = "__favorites__";

export function fileKind(ext: string): LibraryFileKind | null {
  if (IMAGE_EXT.includes(ext)) return "image";
  if (VIDEO_EXT.includes(ext)) return "video";
  if (AUDIO_EXT.includes(ext)) return "audio";
  if (ext === "pdf") return "pdf";
  if (POWERPOINT_ENABLED && isPowerPoint(`.${ext}`)) return "powerpoint";
  if (ext === SLJA_EXT) return "slja";
  return null;
}

function basename(p: string): string {
  return p.split(/[\\/]/).filter(Boolean).pop() || p;
}

function parentOf(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i > 0 ? p.slice(0, i) : p;
}

function byName(a: LibraryEntry, b: LibraryEntry): number {
  if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
}

export async function readFolder(dir: string): Promise<LibraryEntry[] | null> {
  const result = await Platform.listDir(dir);
  if (!result?.ok) return null;
  return (result.entries as LibraryEntry[])
    .filter((e) => e.isDir || fileKind(e.ext) !== null)
    .sort(byName);
}

const folders = computed<LibraryFolder[]>(
  () => $userdata.get<LibraryFolder[]>(KEYS.MODULES.PRESENTATION_MODE.LIBRARY_FOLDERS, []) ?? []
);
const favorites = computed<LibraryEntry[]>(
  () => $userdata.get<LibraryEntry[]>(KEYS.MODULES.PRESENTATION_MODE.LIBRARY_FAVORITES, []) ?? []
);

/**
 * Fila da pasta de onde o arquivo no ar saiu: Anterior e Próximo andam por
 * ela, como num carrossel de anúncios. É uma cópia — trocar de pasta na
 * grade não muda o que o telão está percorrendo.
 */
const _queue = ref<{ entries: LibraryEntry[]; index: number } | null>(null);

export type QueueStep = "first" | "prev" | "next" | "last";

/** A navegação de uma aba: a fonte aberta, a subpasta, o que a grade mostra. */
function _createNav(scope: LibraryScope) {
  /** `ALL`, `FAVORITES` ou o caminho de uma das pastas. */
  const source = ref<string>(ALL);
  /** Pasta aberta dentro da fonte (subpasta), quando a fonte é uma pasta. */
  const dir = ref<string | null>(null);
  const entries = ref<LibraryEntry[]>([]);
  const loading = ref(false);
  const missing = ref(false);
  const selectedPath = ref<string | null>(null);
  const counts = ref<Record<string, number>>({});
  let loadSeq = 0;

  const fits = (e: LibraryEntry) => inScope(e, scope);
  const files = (list: LibraryEntry[] | null) => (list ?? []).filter((e) => !e.isDir && fits(e));

  async function reload(): Promise<void> {
    const seq = ++loadSeq;
    loading.value = true;
    missing.value = false;
    let next: LibraryEntry[] = [];
    try {
      if (source.value === FAVORITES) {
        next = favorites.value.filter(fits).sort(byName);
      } else if (source.value === ALL) {
        const lists = await Promise.all(folders.value.map((f) => readFolder(f.path)));
        next = lists.flatMap(files).sort(byName);
      } else {
        const list = await readFolder(dir.value ?? source.value);
        missing.value = list === null;
        next = (list ?? []).filter(fits);
      }
    } catch (e) {
      Telemetry.captureException(e, { source: "presentation_mode.library.read" });
    }
    if (seq !== loadSeq) return;
    entries.value = next;
    loading.value = false;
    if (selectedPath.value && !next.some((e) => e.path === selectedPath.value))
      selectedPath.value = null;
  }

  async function refreshCounts(): Promise<void> {
    const next: Record<string, number> = {};
    await Promise.all(
      folders.value.map(async (f) => {
        next[f.path] = files(await readFolder(f.path)).length;
      })
    );
    next[ALL] = Object.values(next).reduce((a, b) => a + b, 0);
    next[FAVORITES] = favorites.value.filter(fits).length;
    counts.value = next;
  }

  async function open(nextSource: string, nextDir: string | null = null): Promise<void> {
    source.value = nextSource;
    dir.value = nextDir;
    selectedPath.value = null;
    await reload();
  }

  return {
    scope,
    source,
    dir,
    entries,
    loading,
    missing,
    selectedPath,
    counts,
    reload,
    refreshCounts,
    open,
  };
}

type Nav = ReturnType<typeof _createNav>;
const _navs = new Map<LibraryScope, Nav>();

function _nav(scope: LibraryScope): Nav {
  let nav = _navs.get(scope);
  if (!nav) {
    nav = _createNav(scope);
    _navs.set(scope, nav);
  }
  return nav;
}

/** Pastas e favoritos mudaram: toda aba já aberta relê. */
async function _refreshAll(reload: (_nav: Nav) => boolean): Promise<void> {
  await Promise.all(
    [..._navs.values()].flatMap((nav) => [nav.refreshCounts(), reload(nav) ? nav.reload() : null])
  );
}

export function useFileLibrary(scope: LibraryScope = "files") {
  const nav = _nav(scope);
  const { source, dir, entries, selectedPath } = nav;

  const selected = computed(() => entries.value.find((e) => e.path === selectedPath.value) ?? null);

  /** Caminho mostrado no rodapé: a pasta aberta, ou o nome da fonte especial. */
  const location = computed(() =>
    source.value === ALL || source.value === FAVORITES ? null : (dir.value ?? source.value)
  );

  const canGoUp = computed(
    () =>
      !!dir.value &&
      source.value !== ALL &&
      source.value !== FAVORITES &&
      dir.value !== source.value
  );

  const fileCount = computed(() => entries.value.filter((e) => !e.isDir).length);

  return {
    supported: Platform.isDesktop,
    scope,
    folders,
    favorites,
    source,
    entries,
    loading: nav.loading,
    missing: nav.missing,
    selected,
    counts: nav.counts,
    location,
    canGoUp,
    fileCount,

    async load(): Promise<void> {
      await Promise.all([nav.reload(), nav.refreshCounts()]);
    },

    openSource(next: string): Promise<void> {
      return nav.open(next);
    },

    /** Abre uma pasta pelo caminho: a pasta da biblioteca que a contém, já dentro dela. */
    openPath(path: string): Promise<void> {
      const inside = (root: string) =>
        path === root ||
        path.startsWith(root.replace(/[\\/]$/, "") + (root.includes("\\") ? "\\" : "/"));
      const root = folders.value
        .map((f) => f.path)
        .filter(inside)
        .sort((a, b) => b.length - a.length)[0];
      return nav.open(root ?? path, root && root !== path ? path : null);
    },

    async enter(entry: LibraryEntry): Promise<void> {
      if (!entry.isDir) return;
      dir.value = entry.path;
      selectedPath.value = null;
      await nav.reload();
    },

    async goUp(): Promise<void> {
      if (!dir.value) return;
      const up = parentOf(dir.value);
      dir.value = up === source.value ? null : up;
      selectedPath.value = null;
      await nav.reload();
    },

    select(entry: LibraryEntry | null): void {
      selectedPath.value = entry && !entry.isDir ? entry.path : null;
    },

    async addFolder(): Promise<void> {
      const chosen = (await Platform.api?.storage?.chooseDir?.()) as string | null | undefined;
      if (!chosen) return;
      if (!folders.value.some((f) => f.path === chosen)) {
        $userdata.set(KEYS.MODULES.PRESENTATION_MODE.LIBRARY_FOLDERS, [
          ...folders.value,
          { path: chosen, label: basename(chosen) },
        ]);
      }
      await Promise.all([_refreshAll((n) => n.source.value === ALL), nav.open(chosen)]);
    },

    /** Põe a pasta na biblioteca sem perguntar (a pasta da igreja). Já coberta por outra, nada muda. */
    async includeFolder(path: string): Promise<void> {
      const covered = folders.value.some(
        (f) => path === f.path || path.startsWith(f.path.replace(/[\\/]$/, "") + (f.path.includes("\\") ? "\\" : "/"))
      );
      if (covered) return;
      $userdata.set(KEYS.MODULES.PRESENTATION_MODE.LIBRARY_FOLDERS, [
        ...folders.value,
        { path, label: basename(path) },
      ]);
      await _refreshAll((n) => n.source.value === ALL);
    },

    async removeFolder(path: string): Promise<void> {
      $userdata.set(
        KEYS.MODULES.PRESENTATION_MODE.LIBRARY_FOLDERS,
        folders.value.filter((f) => f.path !== path)
      );
      for (const n of _navs.values()) {
        if (n.source.value === path) {
          n.source.value = ALL;
          n.dir.value = null;
        }
      }
      await _refreshAll((n) => n.source.value === ALL);
    },

    reorderFolders(list: LibraryFolder[]): void {
      $userdata.set(KEYS.MODULES.PRESENTATION_MODE.LIBRARY_FOLDERS, list);
    },

    /**
     * O arquivo foi para a tela: a pasta de onde ele saiu vira a fila de
     * Anterior/Próximo — a aberta na grade ou, para a pasta do programa, `from`.
     */
    startQueue(entry: LibraryEntry, from?: LibraryEntry[]): void {
      const files = (from ?? entries.value).filter((e) => !e.isDir);
      const index = files.findIndex((e) => e.path === entry.path);
      _queue.value = index >= 0 ? { entries: files, index } : { entries: [entry], index: 0 };
    },

    queue: _queue,

    /** Move a fila e devolve o arquivo da nova posição; `null` se já está na ponta. */
    stepQueue(step: QueueStep): LibraryEntry | null {
      const q = _queue.value;
      if (!q) return null;
      const last = q.entries.length - 1;
      const target =
        step === "first" ? 0 : step === "last" ? last : step === "next" ? q.index + 1 : q.index - 1;
      if (target < 0 || target > last || target === q.index) return null;
      _queue.value = { ...q, index: target };
      return q.entries[target];
    },

    isFavorite(entry: LibraryEntry): boolean {
      return favorites.value.some((f) => f.path === entry.path);
    },

    toggleFavorite(entry: LibraryEntry): void {
      const exists = favorites.value.some((f) => f.path === entry.path);
      const next = exists
        ? favorites.value.filter((f) => f.path !== entry.path)
        : [...favorites.value, { ...entry }];
      $userdata.set(KEYS.MODULES.PRESENTATION_MODE.LIBRARY_FAVORITES, next);
      void _refreshAll((n) => n.source.value === FAVORITES);
    },
  };
}
