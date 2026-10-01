import $path from "@/helpers/Path";
import { youtubeThumb } from "@/helpers/OnlineVideo";
import { LiturgyItemTypeEnum } from "@/enums/LiturgyItemTypeEnum";
import type { ProgramItem } from "@/types/Presentation";
import type { PreviewView } from "../components/StagePreview.vue";
import { KIND_ICONS } from "./kinds";
import { kindFromPath } from "./liturgy";
import type { Playable } from "./playable";

export function fileView(path: string, title: string): PreviewView {
  const kind = kindFromPath(path);
  if (kind === "image") return { kind: "image", title, icon: KIND_ICONS.image, playable: true, url: $path.local(path) };
  if (kind === "video") return { kind: "video", title, icon: KIND_ICONS.video, playable: true, url: $path.local(path) };
  return { kind: "other", title, icon: KIND_ICONS[kind], playable: true };
}

export function programView(item: ProgramItem): PreviewView {
  const src = item.source;
  if (src?.tipo === LiturgyItemTypeEnum.MUSICA && src.id_music && src.id_music > 0 && !src.escolha) {
    return { kind: "song", title: item.title, icon: KIND_ICONS.music, playable: true, songId: src.id_music };
  }
  if (item.children?.length) {
    return { kind: "list", title: item.title, icon: KIND_ICONS[item.kind], playable: false, items: item.children.map((c) => c.title) };
  }
  if (item.bible) {
    return { kind: "text", title: item.title, icon: KIND_ICONS.bible, playable: true, text: item.bible.text, reference: item.bible.reference };
  }
  if (item.kind === "note") {
    return { kind: "text", title: item.title, icon: KIND_ICONS.note, playable: true, text: item.notes ?? src?.subitem ?? item.title };
  }
  if (src?.tipo === LiturgyItemTypeEnum.ARQUIVO && src.dir) return fileView(src.dir, item.title);
  return { kind: "other", title: item.title, icon: KIND_ICONS[item.kind], playable: true };
}

/** Como o palco mostra um Playable em prévia. `item` é o do programa, quando o alvo é um. */
export function previewViewOf(target: Playable, item: ProgramItem | null): PreviewView | null {
  if (target.type === "program") return item ? programView(item) : null;
  if (target.type === "file") return fileView(target.entry.path, target.entry.name);
  if (target.type === "online") {
    return { kind: "image", title: target.title, icon: KIND_ICONS.online_video, playable: true, url: youtubeThumb(target.videoId) };
  }
  if (target.type === "bible") {
    const { reference, text } = target.ref;
    return { kind: "text", title: reference, icon: KIND_ICONS.bible, playable: true, text, reference };
  }
  // A grade de prévia lê os slides do acervo; a música personalizada mostra só o título e o ▶.
  if (target.customId) return { kind: "other", title: target.title, icon: KIND_ICONS.music, playable: true };
  return { kind: "song", title: target.title, icon: KIND_ICONS.music, playable: true, songId: target.id_music, chooseMode: true };
}
