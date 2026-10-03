import { LiturgyItemTypeEnum } from "@/enums/LiturgyItemTypeEnum";
import type { ProgramBibleRef, ProgramItem } from "@/types/Presentation";
import type { LibraryEntry } from "../composables/useFileLibrary";
import type { LiveKind } from "../composables/useLiveContent";
import type { MusicMode } from "./musicModes";
import { videoIdFromUrl } from "@/helpers/OnlineVideo";
import { samePassage, type BiblePassage } from "./bible";
import { kindFromPath } from "./liturgy";

/**
 * Algo que o operador pode pôr no palco e mandar ao ar: um item do programa,
 * um arquivo da biblioteca, uma música do acervo, um trecho da Bíblia ou um
 * vídeo do YouTube.
 *
 * O módulo guarda qual deles foi mandado ao ar — não tenta reconhecê-lo pelo
 * título que a projeção anuncia, que muda de formato conforme a origem (com ou
 * sem extensão) e se repete entre pastas.
 */
export type Playable =
  | { type: "program"; itemId: string }
  | { type: "file"; entry: LibraryEntry }
  /** `customId`: música personalizada — o `id_music` dela é só um número provisório da lista. */
  | { type: "song"; id_music: number; title: string; subtitle?: string; customId?: string }
  | { type: "bible"; ref: ProgramBibleRef }
  | { type: "online"; videoId: string; title: string; channel?: string }
  /** Um arquivo ou anúncio de dentro de um momento do programa. */
  | { type: "child"; itemId: string; childId: string }
  /** Um arquivo de uma pasta da biblioteca que está no programa (item `folder`). */
  | { type: "folderFile"; itemId: string; entry: LibraryEntry };

/** O item do programa por trás do Playable (o próprio, o momento ou a pasta), se houver. */
export function itemIdOf(playable: Playable | null | undefined): string | null {
  return playable?.type === "program" || playable?.type === "child" || playable?.type === "folderFile"
    ? playable.itemId
    : null;
}

export function samePlayable(a: Playable, b: Playable): boolean {
  if (a.type === "program" && b.type === "program") return a.itemId === b.itemId;
  if (a.type === "file" && b.type === "file") return a.entry.path === b.entry.path;
  if (a.type === "song" && b.type === "song") {
    return a.customId || b.customId ? a.customId === b.customId : a.id_music === b.id_music;
  }
  if (a.type === "bible" && b.type === "bible") return samePassage(a.ref, b.ref);
  if (a.type === "online" && b.type === "online") return a.videoId === b.videoId;
  if (a.type === "child" && b.type === "child") return a.itemId === b.itemId && a.childId === b.childId;
  if (a.type === "folderFile" && b.type === "folderFile") return a.itemId === b.itemId && a.entry.path === b.entry.path;
  return false;
}

/**
 * O que deve aparecer no ar quando um Playable foi mandado. `kind: null` é
 * "qualquer coisa": itens cujo efeito o módulo não acompanha (site, overlay).
 */
export interface LiveExpectation {
  kind: LiveKind | "audio" | null;
  /** Música: os slides no ar têm de ser desta. */
  songId?: number;
  /** Música personalizada: os slides dela trazem o UUID, não `id_music`. */
  customSongId?: string;
  /** Bíblia: o trecho no ar tem de ser este. */
  passage?: BiblePassage;
  /**
   * Vídeo do YouTube: o vídeo no ar tem de ser este. Ele pode estar no ar como
   * player embutido ou como arquivo (transmitido ou baixado) — o ID é o mesmo.
   */
  videoId?: string;
}

/** O que está no ar agora, do ponto de vista do palco. */
export interface LiveSignal {
  kind: LiveKind | null;
  audio: boolean;
  songId: number | null;
  customSongId: string | null;
  passage: BiblePassage | null;
  videoId: string | null;
}

function fromPath(path: string): LiveExpectation {
  const kind = kindFromPath(path);
  if (kind === "image" || kind === "video") return { kind: "file" };
  if (kind === "audio") return { kind: "audio" };
  return { kind: null };
}

function fromMusic(idMusic: number, mode: MusicMode | string | undefined): LiveExpectation {
  if (mode === "audio" || mode === "audio_pb") return { kind: "audio" };
  return { kind: "music", songId: idMusic };
}

function fromCustomMusic(customSongId: string, mode: MusicMode | string | undefined): LiveExpectation {
  if (mode === "audio" || mode === "audio_pb") return { kind: "audio" };
  return { kind: "music", customSongId };
}

/**
 * O arquivo do disco por trás do que está no palco, se houver. `item` é o
 * item do programa de `program`/`child`.
 */
export function filePathOf(playable: Playable | null, item: ProgramItem | null): string | null {
  if (playable?.type === "file" || playable?.type === "folderFile") return playable.entry.path;
  if (playable?.type === "child") return item?.children?.find((c) => c.id === playable.childId)?.path ?? null;
  if (playable?.type === "program") return item?.source?.dir ?? null;
  return null;
}

export function expectationOf(
  playable: Playable,
  item: ProgramItem | null,
  mode?: MusicMode
): LiveExpectation {
  if (playable.type === "file" || playable.type === "folderFile") return fromPath(playable.entry.path);
  if (playable.type === "song") {
    return playable.customId ? fromCustomMusic(playable.customId, mode) : fromMusic(playable.id_music, mode);
  }
  if (playable.type === "bible") return { kind: "bible", passage: playable.ref };
  if (playable.type === "online") return { kind: "online_video", videoId: playable.videoId };
  if (playable.type === "child") {
    const child = item?.children?.find((c) => c.id === playable.childId);
    if (child?.path) return fromPath(child.path);
    return child?.ref ? { kind: "announcements" } : { kind: null };
  }
  if (!item) return { kind: null };
  if (item.bible) return { kind: "bible", passage: item.bible };
  const src = item.source;
  switch (src?.tipo) {
    case LiturgyItemTypeEnum.MUSICA:
      if (src.escolha || !src.id_music) return { kind: null };
      if (src.id_music < 0) return src.ref_id ? fromCustomMusic(src.ref_id, src.subtipo) : { kind: null };
      return fromMusic(src.id_music, src.subtipo);
    case LiturgyItemTypeEnum.ARQUIVO:
      return src.dir ? fromPath(src.dir) : { kind: null };
    case LiturgyItemTypeEnum.ANUNCIOS:
      return { kind: "announcements" };
    case LiturgyItemTypeEnum.VIDEO_ONLINE: {
      const videoId = videoIdFromUrl(src.url);
      return videoId ? { kind: "online_video", videoId } : { kind: "online_video" };
    }
    default:
      return { kind: null };
  }
}

/** O que foi mandado ao ar ainda é o que está no ar? */
export function isOnAir(expected: LiveExpectation, signal: LiveSignal): boolean {
  if (!signal.kind && !signal.audio) return false;
  if (expected.kind === null) return true;
  if (expected.kind === "audio") return signal.audio;
  if (expected.videoId !== undefined) return signal.videoId === expected.videoId;
  if (signal.kind !== expected.kind) return false;
  if (expected.passage && !(signal.passage && samePassage(expected.passage, signal.passage))) return false;
  if (expected.customSongId !== undefined && signal.customSongId !== expected.customSongId) return false;
  return expected.songId === undefined || signal.songId === expected.songId;
}
