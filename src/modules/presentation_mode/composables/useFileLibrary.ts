import { computed, ref } from "vue";
import $userdata from "@/helpers/UserData";
import Platform from "@/helpers/Platform";
import Telemetry from "@/helpers/Telemetry";
import { KEYS } from "@/constants/UserDataKeys";
import { AUDIO_EXT, IMAGE_EXT, VIDEO_EXT } from "@/constants/FileTypes";
import { SLJA_EXT } from "@/helpers/SljaPlayer";

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

export type LibraryFileKind = "image" | "video" | "audio" | "pdf" | "slja";

export const ALL = "__all__";
export const FAVORITES = "__favorites__";

export function fileKind(ext: string): LibraryFileKind | null {
  if (IMAGE_EXT.includes(ext)) return "image";
  if (VIDEO_EXT.includes(ext)) return "video";
  if (AUDIO_EXT.includes(ext)) return "audio";
  if (ext === "pdf") return "pdf";
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

async function readFolder(dir: string): Promise<LibraryEntry[] | null> {
  const result = await Platform.listDir(dir);
  if (!result?.ok) return null;
  return (result.entries as LibraryEntry[]).filter((e) => e.isDir || fileKind(e.ext) !== null).sort(byName);
}

const folders = computed<LibraryFolder[]>(
  () => $userdata.get<LibraryFolder[]>(KEYS.MODULES.PRESENTATION_MODE.LIBRARY_FOLDERS, []) ?? []
);
const favorites = computed<LibraryEntry[]>(
  () => $userdata.get<LibraryEntry[]>(KEYS.MODULES.PRESENTATION_MODE.LIBRARY_FAVORITES, []) ?? []
);

/** `ALL`, `FAVORITES` ou o caminho de uma das pastas. */
const _source = ref<string>(ALL);
/** Pasta aberta dentro da fonte (subpasta), quando a fonte é uma pasta. */
const _dir = ref<string | null>(null);
const _entries = ref<LibraryEntry[]>([]);
const _loading = ref(false);
const _missing = ref(false);
const _selectedPath = ref<string | null>(null);
const _counts = ref<Record<string, number>>({});
let _loadSeq = 0;

/**
 * Fila da pasta de onde o arquivo no ar saiu: Anterior e Próximo andam por
 * ela, como num carrossel de anúncios. É uma cópia — trocar de pasta na
 * grade não muda o que o telão está percorrendo.
 */
const _queue = ref<{ entries: LibraryEntry[]; index: number } | null>(null);

export type QueueStep = "first" | "prev" | "next" | "last";

async function _reload(): Promise<void> {
  const seq = ++_loadSeq;
  _loading.value = true;
  _missing.value = false;
  let entries: LibraryEntry[] = [];
  try {
    if (_source.value === FAVORITES) {
      entries = [...favorites.value].sort(byName);
    } else if (_source.value === ALL) {
      const lists = await Promise.all(folders.value.map((f) => readFolder(f.path)));
      entries = lists.flatMap((list) => (list ?? []).filter((e) => !e.isDir)).sort(byName);
    } else {
      const list = await readFolder(_dir.value ?? _source.value);
      _missing.value = list === null;
      entries = list ?? [];
    }
  } catch (e) {
    Telemetry.captureException(e, { source: "presentation_mode.library.read" });
  }
  if (seq !== _loadSeq) return;
  _entries.value = entries;
  _loading.value = false;
  if (_selectedPath.value && !entries.some((e) => e.path === _selectedPath.value)) _selectedPath.value = null;
}

async function _refreshCounts(): Promise<void> {
  const counts: Record<string, number> = {};
  await Promise.all(
    folders.value.map(async (f) => {
      const list = await readFolder(f.path);
      counts[f.path] = list ? list.filter((e) => !e.isDir).length : 0;
    })
  );
  counts[ALL] = Object.values(counts).reduce((a, b) => a + b, 0);
  counts[FAVORITES] = favorites.value.length;
  _counts.value = counts;
}

export function useFileLibrary() {
  const selected = computed(() => _entries.value.find((e) => e.path === _selectedPath.value) ?? null);

  /** Caminho mostrado no rodapé: a pasta aberta, ou o nome da fonte especial. */
  const location = computed(() => (_source.value === ALL || _source.value === FAVORITES ? null : (_dir.value ?? _source.value)));

  const canGoUp = computed(
    () => !!_dir.value && _source.value !== ALL && _source.value !== FAVORITES && _dir.value !== _source.value
  );

  const fileCount = computed(() => _entries.value.filter((e) => !e.isDir).length);

  return {
    supported: Platform.isDesktop,
    folders,
    favorites,
    source: _source,
    entries: _entries,
    loading: _loading,
    missing: _missing,
    selected,
    counts: _counts,
    location,
    canGoUp,
    fileCount,

    async load(): Promise<void> {
      await Promise.all([_reload(), _refreshCounts()]);
    },

    async openSource(source: string): Promise<void> {
      _source.value = source;
      _dir.value = null;
      _selectedPath.value = null;
      await _reload();
    },

    async enter(entry: LibraryEntry): Promise<void> {
      if (!entry.isDir) return;
      _dir.value = entry.path;
      _selectedPath.value = null;
      await _reload();
    },

    async goUp(): Promise<void> {
      if (!_dir.value) return;
      const up = parentOf(_dir.value);
      _dir.value = up === _source.value ? null : up;
      _selectedPath.value = null;
      await _reload();
    },

    select(entry: LibraryEntry | null): void {
      _selectedPath.value = entry && !entry.isDir ? entry.path : null;
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
      await _refreshCounts();
      _source.value = chosen;
      _dir.value = null;
      _selectedPath.value = null;
      await _reload();
    },

    async removeFolder(path: string): Promise<void> {
      $userdata.set(
        KEYS.MODULES.PRESENTATION_MODE.LIBRARY_FOLDERS,
        folders.value.filter((f) => f.path !== path)
      );
      if (_source.value === path) {
        _source.value = ALL;
        _dir.value = null;
      }
      await Promise.all([_reload(), _refreshCounts()]);
    },

    reorderFolders(list: LibraryFolder[]): void {
      $userdata.set(KEYS.MODULES.PRESENTATION_MODE.LIBRARY_FOLDERS, list);
    },

    /** O arquivo foi para a tela: a pasta aberta vira a fila de Anterior/Próximo. */
    startQueue(entry: LibraryEntry): void {
      const files = _entries.value.filter((e) => !e.isDir);
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
      _counts.value = { ..._counts.value, [FAVORITES]: next.length };
      if (_source.value === FAVORITES) void _reload();
    },
  };
}
