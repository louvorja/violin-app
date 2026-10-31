import { ICONS } from "@/config/Icons";
import type { ProgramItem } from "@/types/Presentation";
import { canvaSiteItem, fileItem, fileTitle, onlineItem, bibleItem, songItem } from "./items";
import { kindFromPath } from "./liturgy";
import { KIND_ICONS } from "./kinds";
import type { MusicMode } from "./musicModes";
import { samePlayable, type Playable } from "./playable";

/**
 * "Já passou hoje": sem programa, o que foi ao ar fica anotado na coluna da
 * esquerda, na ordem, para apresentar de novo ou virar o programa do dia.
 * Só o que veio da biblioteca: com programa, a coluna já é o programa.
 */

export interface HistoryEntry {
  id: string;
  /** Quando entrou no ar (ms). */
  at: number;
  playable: Playable;
  mode?: MusicMode;
  muted?: boolean;
}

/** O que a biblioteca manda ao ar e dá para repetir (os do programa ficam no programa). */
export function isRecordable(playable: Playable): boolean {
  return ["file", "song", "bible", "online", "canva"].includes(playable.type);
}

/** Anota no fim; mandar de novo o que já está por último não repete a linha. */
export function recordEntry(list: readonly HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
  if (!isRecordable(entry.playable)) return [...list];
  const last = list[list.length - 1];
  if (last && samePlayable(last.playable, entry.playable)) return [...list];
  return [...list, entry];
}

export function historyTitle(playable: Playable): string {
  switch (playable.type) {
    case "file":
      return fileTitle(playable.entry);
    case "song":
    case "online":
    case "canva":
      return playable.title;
    case "bible":
      return playable.ref.reference;
    default:
      return "";
  }
}

export function historySubtitle(playable: Playable): string {
  switch (playable.type) {
    case "file":
      return playable.entry.name;
    case "song":
      return playable.subtitle ?? "";
    case "online":
      return playable.channel ?? "";
    case "canva":
      return "Canva";
    case "bible":
      return "";
    default:
      return "";
  }
}

export function historyIcon(playable: Playable): string {
  switch (playable.type) {
    case "file":
      return KIND_ICONS[kindFromPath(playable.entry.path)] ?? ICONS.UI.FILE;
    case "song":
      return KIND_ICONS.music;
    case "online":
      return KIND_ICONS.online_video;
    case "canva":
      return KIND_ICONS.site;
    case "bible":
      return KIND_ICONS.bible;
    default:
      return ICONS.UI.FILE;
  }
}

/** A linha do histórico como item do programa ("Guardar o que passou como programa"). */
export function historyItem(entry: HistoryEntry): ProgramItem | null {
  const p = entry.playable;
  switch (p.type) {
    case "file":
      return fileItem(p.entry, null);
    case "song":
      return songItem(
        {
          id_music: p.id_music,
          name: p.title,
          album: p.subtitle ?? "",
          has_instrumental_music: false,
          customId: p.customId,
        },
        // Duplo clique na biblioteca toca a versão cantada: é ela que passou.
        entry.mode ?? "sung",
        ""
      );
    case "online":
      return onlineItem({ id: p.videoId, title: p.title, duration: null, channel: p.channel });
    case "bible":
      return bibleItem(p.ref);
    case "canva":
      return canvaSiteItem({ id: p.designId, title: p.title, url: "" });
    default:
      return null;
  }
}
