import { AUDIO_EXT, IMAGE_EXT, VIDEO_EXT } from "@/constants/FileTypes";
import { LiturgyItemTypeEnum } from "@/enums/LiturgyItemTypeEnum";
import type { LiturgyItem } from "@/types/Liturgy";

type ProjectedFileKind = "image" | "video" | "pdf" | "slja";

export interface OverlayLinkContext {
  scheduledPath?: string;
  availableAnnouncementIds?: readonly string[];
  systemMediaPlayer?: boolean;
}

export function projectedFileKind(
  path: string | undefined,
  hint = "",
  systemMediaPlayer = false
): ProjectedFileKind | null {
  if (!path && !hint) return null;
  const ext = (path || "").split(/[?#]/)[0].split(".").pop()?.toLowerCase() || "";
  const kind = IMAGE_EXT.includes(ext)
    ? "image"
    : VIDEO_EXT.includes(ext)
      ? "video"
      : ext === "pdf" || ext === "slja"
        ? ext
        : AUDIO_EXT.includes(ext) ? "" : hint;
  if (kind === "video" && systemMediaPlayer) return null;
  return kind === "image" || kind === "video" || kind === "pdf" || kind === "slja"
    ? kind
    : null;
}

export function youtubeVideoId(url: string | undefined): string | null {
  const match = (url || "").match(
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/)([a-zA-Z0-9_-]{11})/
  );
  return match?.[1] || null;
}

/** Oferece o vínculo só quando o item tem uma projeção configurada. */
export function canLinkOverlay(item: LiturgyItem, context: OverlayLinkContext = {}): boolean {
  switch (item.tipo) {
    case LiturgyItemTypeEnum.MUSICA: {
      /*
       * "Escolher na hora": a música e a versão só existem na execução. O
       * vínculo é do item — a ativação continua condicionada à projeção real
       * (`projected` + modo), que decide se o hino escolhido mostra slides.
       */
      if (item.escolha) return true;
      const musicId = Number(item.id_music);
      const hasMusic = Number.isFinite(musicId) &&
        (musicId > 0 || (musicId < 0 && !!item.ref_id));
      const mode = item.subtipo || "sung";
      return hasMusic && ["sung", "pb", "lyric", "no_audio"].includes(mode);
    }
    case LiturgyItemTypeEnum.ARQUIVO:
      return !!item.dir && !!projectedFileKind(item.dir, "", context.systemMediaPlayer);
    case LiturgyItemTypeEnum.MEDIA_LIBRARY:
      return !!item.ref_id && !!projectedFileKind(item.dir, item.subtipo, context.systemMediaPlayer);
    case LiturgyItemTypeEnum.ITENS_AGENDADOS:
      return !!projectedFileKind(context.scheduledPath, "", context.systemMediaPlayer);
    case LiturgyItemTypeEnum.VIDEO_ONLINE:
      return !!youtubeVideoId(item.url);
    case LiturgyItemTypeEnum.ANUNCIOS: {
      const available = context.availableAnnouncementIds;
      if (available) {
        if (!available.length) return false;
        if (!Array.isArray(item.anuncios_ids)) return true;
        return item.anuncios_ids.some((id) => available.includes(String(id)));
      }
      return !Array.isArray(item.anuncios_ids) || item.anuncios_ids.length > 0;
    }
    default:
      return false;
  }
}
