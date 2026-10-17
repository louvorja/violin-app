import { computed, reactive } from "vue";
import $database from "@/helpers/Database";
import { fetchWithTimeout, NET_TIMEOUT } from "@/helpers/Http";
import $path from "@/helpers/Path";
import Platform from "@/helpers/Platform";
import Telemetry from "@/helpers/Telemetry";
import { resolveMediaReference } from "@/helpers/MediaUrl";
import { LiturgyItemTypeEnum } from "@/enums/LiturgyItemTypeEnum";
import type { Music } from "@/types/Music";
import type { Program, ProgramItem } from "@/types/Presentation";
import { isUrl, programFilePaths } from "../program/paths";
import { pendingItems } from "../program/models";
import { allPaths, isInside, isPortable } from "../program/portable";
import { readFolder } from "./useFileLibrary";
import { useChurchFolder } from "./useChurchFolder";
import { useCloudFiles } from "./useCloudFiles";

/**
 * "Pronto para o culto": o que falta neste computador para o programa rodar
 * sem susto — escolher o que ainda está pendente, hinos que não estão no
 * disco, arquivos só na nuvem, pastas vazias ou que não existem aqui, e o que
 * está fora da pasta da igreja (não vai existir no outro computador).
 * "Preparar tudo" baixa o que dá para baixar.
 */

interface SongNeed {
  item: ProgramItem;
  /** Caminho remoto (`/musics/pt/…`) e endereço para baixar. */
  remote: string;
  url: string;
}

const state = reactive({
  checking: false,
  preparing: false,
  checkedAt: 0,
  pending: [] as ProgramItem[],
  songs: [] as SongNeed[],
  cloud: [] as string[],
  missing: [] as string[],
  empty: [] as ProgramItem[],
  outside: [] as string[],
  /** Programa sem pasta da igreja configurada: tudo vale só neste computador. */
  noFolder: false,
});

/** Os arquivos de áudio que a versão escolhida usa; "escolher na hora" precisa dos dois. */
function songUrls(item: ProgramItem, music: Music): string[] {
  const mode = item.source?.subtipo ?? "";
  const sung = music.url_music ?? "";
  const pb = music.url_instrumental_music ?? "";
  if (mode === "lyric") return [];
  if (mode === "pb" || mode === "audio_pb") return [pb];
  if (mode === "sung" || mode === "audio") return [sung];
  return [sung, pb];
}

async function songsToDownload(program: Program): Promise<SongNeed[]> {
  const checkLocal = Platform.storage?.checkLocal;
  if (!checkLocal) return [];
  const items = program.sessions
    .flatMap((s) => s.items)
    .filter((i) => i.source?.tipo === LiturgyItemTypeEnum.MUSICA && Number(i.source.id_music) > 0);
  const needs: SongNeed[] = [];
  for (const item of items) {
    const music = await $database.get<Music>(`music_${item.source!.id_music}`).catch(() => null);
    if (!music) continue;
    for (const url of songUrls(item, music)) {
      const remote = resolveMediaReference(url)?.relativePath;
      if (remote) needs.push({ item, remote, url });
    }
  }
  if (!needs.length) return [];
  const local = (await checkLocal(needs.map((n) => n.remote))) as Record<string, unknown>;
  return needs.filter((n) => !local[n.remote]);
}

/** Existe aqui? Lê cada pasta-mãe uma vez. */
async function missingPaths(paths: string[]): Promise<string[]> {
  const parents = new Map<string, Set<string> | null>();
  const parentOf = (p: string) => p.replace(/[\\/][^\\/]*$/, "");
  const nameOf = (p: string) => p.split(/[\\/]/).pop() ?? p;
  for (const p of paths) {
    const dir = parentOf(p);
    if (!parents.has(dir)) {
      const res = await Platform.listDir(dir).catch(() => null);
      parents.set(dir, res?.ok ? new Set(res.entries.map((e) => e.name)) : null);
    }
  }
  return paths.filter((p) => !parents.get(parentOf(p))?.has(nameOf(p)));
}

async function check(program: Program): Promise<void> {
  if (state.checking) return;
  state.checking = true;
  try {
    const folder = useChurchFolder();
    const root = folder.root.value;
    const files = programFilePaths(program);
    const folders = [
      ...new Set(
        program.sessions
          .flatMap((s) => s.items)
          .map((i) => i.folder)
          .filter((f): f is string => !!f)
      ),
    ];
    const local = [...files, ...folders].filter((p) => !isUrl(p) && !isPortable(p));

    const folderFiles = new Map<string, string[]>();
    for (const dir of folders) {
      const list = await readFolder(dir).catch(() => null);
      folderFiles.set(
        dir,
        (list ?? []).filter((e) => !e.isDir).map((e) => e.path)
      );
    }
    const cloud = useCloudFiles();
    const toCheck = [...files.filter((p) => !isUrl(p)), ...[...folderFiles.values()].flat()];
    await cloud.refresh(toCheck);

    state.pending = pendingItems(program);
    state.songs = await songsToDownload(program);
    state.cloud = toCheck.filter((p) => cloud.stateOf(p) === "cloud");
    state.missing = Platform.isDesktop ? await missingPaths(local) : [];
    state.empty = program.sessions
      .flatMap((s) => s.items)
      .filter(
        (i) => i.folder && !state.missing.includes(i.folder) && !folderFiles.get(i.folder)?.length
      );
    state.noFolder = !root;
    state.outside = root
      ? allPaths(program).filter((p) => !isUrl(p) && !isPortable(p) && !isInside(p, root))
      : [];
    state.checkedAt = Date.now();
  } catch (e) {
    Telemetry.captureException(e, { source: "presentation_readiness_check" });
  } finally {
    state.checking = false;
  }
}

/** Baixa os hinos (inteiros: o app guarda o que baixou) e o que está só na nuvem. */
async function prepare(program: Program, label: string): Promise<void> {
  if (state.preparing) return;
  state.preparing = true;
  try {
    if (state.cloud.length) void useCloudFiles().downloadAll([...state.cloud], label);
    for (const need of state.songs) {
      try {
        const res = await fetchWithTimeout($path.file(need.url), {
          timeout: NET_TIMEOUT.MEDIA,
          source: "presentation_readiness",
        });
        await res.arrayBuffer();
      } catch (e) {
        Telemetry.captureException(e, { source: "presentation_readiness_song" });
      }
    }
    Telemetry.track("presentation_readiness_prepared", {
      songs: state.songs.length,
      cloud: state.cloud.length,
    });
  } finally {
    state.preparing = false;
  }
  await check(program);
}

const problems = computed(
  () =>
    state.pending.length +
    state.songs.length +
    state.cloud.length +
    state.missing.length +
    state.empty.length +
    state.outside.length
);

export function useReadiness() {
  return { state, problems, check, prepare };
}
