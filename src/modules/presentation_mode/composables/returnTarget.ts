import $path from "@/helpers/Path";
import $snackbar from "@/helpers/Snackbar";
import * as OnlineVideo from "@/helpers/OnlineVideo";
import { i18nAtual } from "@/i18n";
import type { ProgramItem } from "@/types/Presentation";
import { kindFromPath } from "../program/liturgy";
import { filePathOf, type Playable } from "../program/playable";
import type { ReturnTarget } from "./useOutputs";

/**
 * O que vai só para o retorno de palco: foto ou vídeo — da biblioteca, do
 * programa, de um momento ou do YouTube. O retorno toca o vídeo mudo; o do
 * YouTube vem do mesmo endereço local que as telas usam (baixado ou baixando).
 */

/** Marca do vídeo on-line no retorno, no lugar do caminho de um arquivo. */
export const onlineReturnPath = (videoId: string) => `youtube:${videoId}`;

function say(key: string): string {
  const t = i18nAtual()?.global?.t as ((k: string) => unknown) | undefined;
  return t ? String(t(key)) : key;
}

function fromFile(path: string, title: string): ReturnTarget | null {
  const type = kindFromPath(path);
  return type === "image" || type === "video" ? { type, url: $path.local(path), title, path } : null;
}

async function fromOnline(videoId: string, title: string): Promise<ReturnTarget | null> {
  const res = await OnlineVideo.stream(videoId).catch(() => null);
  if (!res?.ok) {
    $snackbar.warning(say(OnlineVideo.messageKeyForStreamFailure(res?.ok === false ? res.error.kind : "unknown")));
    return null;
  }
  return { type: "video", url: res.video.url, title, path: onlineReturnPath(videoId) };
}

/** `item`: o item do programa de `program`/`child`. Null quando não há o que levar ao retorno. */
export async function returnOverrideFor(target: Playable, item: ProgramItem | null): Promise<ReturnTarget | null> {
  if (target.type === "online") return fromOnline(target.videoId, target.title);
  const path = filePathOf(target, item);
  if (!path) return null;
  const videoId = OnlineVideo.videoIdFromUrl(path);
  const title =
    target.type === "file" || target.type === "folderFile"
      ? target.entry.name
      : target.type === "child"
        ? (item?.children?.find((c) => c.id === target.childId)?.title ?? path)
        : (item?.title ?? path);
  return videoId ? fromOnline(videoId, title) : fromFile(path, title);
}
