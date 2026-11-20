import { LiturgyItemTypeEnum } from "@/enums/LiturgyItemTypeEnum";
import { AUDIO_EXT, IMAGE_EXT, VIDEO_EXT } from "@/constants/FileTypes";
import type { LiturgyItem, LiturgyItemKind } from "@/types/Liturgy";

/**
 * O item da liturgia como peça compartilhada: montar um item completo e dizer
 * o que ele projeta. A liturgia é a fonte da verdade do formato — os campos
 * em português vêm do `.ja` do Delphi —, e o programa do Modo apresentação
 * estende o item em vez de manter uma segunda tabela de tipos e padrões.
 */

const PRESENTATION_EXT = ["ppt", "pptx", "odp", "key", "pdf", "slja"];

const DEFAULT_COLOR = "#4F0000";

function extensionOf(path: string): string {
  const clean = path.split(/[?#]/)[0];
  const dot = clean.lastIndexOf(".");
  return dot >= 0 ? clean.slice(dot + 1).toLowerCase() : "";
}

export function isYoutube(url: string | null | undefined): boolean {
  return !!url && /youtu\.?be/i.test(url);
}

/** O que um arquivo projeta, pela extensão. Sem extensão conhecida: `file`. */
export function kindOfPath(path: string): LiturgyItemKind {
  const ext = extensionOf(path);
  if (IMAGE_EXT.includes(ext)) return "image";
  if (VIDEO_EXT.includes(ext)) return "video";
  if (AUDIO_EXT.includes(ext)) return "audio";
  if (PRESENTATION_EXT.includes(ext)) return "presentation";
  return "file";
}

/**
 * O que o item projeta. Lê só `tipo`, `subtipo`, `dir` e `url`; um tipo que
 * não projeta nada (anotação, bloco) ou desconhecido é `note`.
 */
export function kindOf(item: LiturgyItem): LiturgyItemKind {
  switch (item.tipo) {
    case LiturgyItemTypeEnum.MUSICA:
      return "music";
    case LiturgyItemTypeEnum.ARQUIVO:
      return kindOfPath(item.dir || "");
    case LiturgyItemTypeEnum.SITE:
      return isYoutube(item.url || item.subitem) ? "online_video" : "site";
    case LiturgyItemTypeEnum.VIDEO_ONLINE:
      return "online_video";
    case LiturgyItemTypeEnum.MEDIA_LIBRARY:
      if (item.subtipo === "image") return "image";
      if (item.subtipo === "video") return "video";
      if (item.subtipo === "pdf") return "presentation";
      return "file";
    case LiturgyItemTypeEnum.BG_SOUND:
      return "audio";
    case LiturgyItemTypeEnum.ANUNCIOS:
      return "announcements";
    case LiturgyItemTypeEnum.OVERLAY:
      return "overlay";
    case LiturgyItemTypeEnum.ITENS_AGENDADOS:
      return "scheduled";
    default:
      return "note";
  }
}

/**
 * Item completo a partir do essencial: o tipo e os campos que importam. O
 * resto vem com os padrões do formato; sem `id`, nasce um novo.
 */
export function newItem(tipo: LiturgyItemTypeEnum, fields: Partial<LiturgyItem> = {}): LiturgyItem {
  return {
    subtipo: "",
    item: "",
    subitem: "",
    cor: DEFAULT_COLOR,
    duration: 0,
    musica: -1,
    dir: "",
    dir_info: "E",
    url: "",
    escolha: false,
    has_instrumental_music: false,
    ...fields,
    id: fields.id || crypto.randomUUID(),
    tipo,
  };
}
