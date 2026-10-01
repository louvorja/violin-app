import DateTime from "@/helpers/DateTime";
import { LiturgyItemTypeEnum } from "@/enums/LiturgyItemTypeEnum";
import type { ProgramBibleRef, ProgramItem } from "@/types/Presentation";
import type { LibrarySong } from "./song";
import type { LibraryEntry } from "../composables/useFileLibrary";
import type { MediaMeta } from "../composables/useMediaMeta";
import { newId } from "../composables/useProgram";
import { kindFromPath, liturgyItem } from "./liturgy";
import type { MusicMode } from "./musicModes";

/** Nome do arquivo sem a extensão — o título que o item do programa mostra. */
export function fileTitle(entry: LibraryEntry): string {
  return entry.name.replace(/\.[^.]+$/, "");
}

/** Música do acervo como item do programa. `modeLabel` vai no subtítulo quando não é o formato de sempre. */
export function songItem(song: LibrarySong, mode: MusicMode, modeLabel: string): ProgramItem {
  const seconds = DateTime.toNumber(song.duration);
  return {
    id: newId(),
    kind: "music",
    title: song.name,
    subtitle: [song.album, modeLabel].filter(Boolean).join(" · ") || undefined,
    plannedMinutes: seconds > 0 ? Math.ceil(seconds / 60) : 3,
    source: liturgyItem({
      id: newId(),
      tipo: LiturgyItemTypeEnum.MUSICA,
      subtipo: mode,
      id_music: song.id_music,
      musica: song.id_music,
      // Como a liturgia: id negativo + `ref_id` com o UUID da música personalizada.
      ...(song.customId ? { ref_id: song.customId } : {}),
      item: song.name,
      has_instrumental_music: song.has_instrumental_music,
    }),
  };
}

export function fileItem(entry: LibraryEntry, meta: MediaMeta | null): ProgramItem {
  const seconds = meta?.duration ?? 0;
  return {
    id: newId(),
    kind: kindFromPath(entry.path),
    title: fileTitle(entry),
    subtitle: entry.name,
    // Imagem não tem duração própria: um minuto é o ponto de partida mais comum.
    plannedMinutes: seconds > 0 ? Math.ceil(seconds / 60) : 1,
    source: liturgyItem({ id: newId(), tipo: LiturgyItemTypeEnum.ARQUIVO, dir: entry.path, item: fileTitle(entry) }),
  };
}

/** Vídeo do YouTube como item do programa: o motor da liturgia o abre pelo link. */
export function onlineItem(video: { id: string; title: string; duration: number | null; channel?: string }): ProgramItem {
  const seconds = video.duration ?? 0;
  return {
    id: newId(),
    kind: "online_video",
    title: video.title,
    subtitle: video.channel || undefined,
    plannedMinutes: seconds > 0 ? Math.ceil(seconds / 60) : 5,
    source: liturgyItem({
      id: newId(),
      tipo: LiturgyItemTypeEnum.VIDEO_ONLINE,
      url: `https://www.youtube.com/watch?v=${video.id}`,
      item: video.title,
    }),
  };
}

/** Trecho da Bíblia como item do programa: o título é a referência. */
export function bibleItem(ref: ProgramBibleRef): ProgramItem {
  return {
    id: newId(),
    kind: "bible",
    title: ref.reference,
    // Leitura curta: um minuto a cada três versículos, no mínimo um.
    plannedMinutes: Math.max(1, Math.ceil(ref.verses.length / 3)),
    bible: ref,
  };
}
