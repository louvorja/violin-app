import { computed, reactive, ref } from "vue";
import Broadcast from "@/helpers/Broadcast";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import { useSlides } from "@/composables/useSlides";
import { videoIdFromPlaybackUrl } from "@/helpers/OnlineVideo";
import type { BiblePassage } from "../program/bible";

/**
 * O que está na tela principal agora, para os espelhos do módulo.
 *
 * Não há uma fonte única: cada conteúdo anuncia o próprio estado (música,
 * versículo, arquivo, vídeo on-line, anúncios). Vale o último que entrou no
 * ar — é o que ficou por cima para quem está olhando o telão.
 *
 * A música vem do `useSlides` da própria janela principal, que é quem a toca;
 * os demais, do Broadcast. O ouvinte é fixo (não de componente) para não
 * perder anúncios enquanto a aba do módulo está em segundo plano.
 */

export type LiveKind = "music" | "bible" | "file" | "online_video" | "announcements";

export interface LiveFile {
  type: "image" | "video" | "pdf" | string;
  url: string;
  title: string;
  playback_id?: string;
}

interface AnnouncementSlide {
  id: string;
  nome?: string;
  texto?: string;
  imageData?: ArrayBuffer;
  imageMime?: string;
  style?: { bgColor?: string; textColor?: string };
}

const _stamps = reactive<Partial<Record<LiveKind, number>>>({});
const _bible = ref<
  ({ text: string; reference: string; nextReference: string } & { passage: BiblePassage | null }) | null
>(null);

/** O trecho que a projeção anuncia, quando o pacote traz livro, capítulo e versículos. */
function passageOf(p: Record<string, unknown>): BiblePassage | null {
  const book = Number(p.book_id);
  const chapter = Number(p.chapter);
  const verses = Array.isArray(p.verses) ? p.verses.map(Number).filter(Number.isInteger) : [];
  if (!Number.isInteger(book) || !Number.isInteger(chapter) || !verses.length) return null;
  const version = Number(p.version_id);
  return { book_id: book, chapter, verses, version_id: Number.isInteger(version) ? version : undefined };
}
const _file = ref<LiveFile | null>(null);
const _onlineTitle = ref("");
/** O vídeo do YouTube no ar — embutido, transmitido ou já baixado. */
const _onlineVideoId = ref<string | null>(null);
const _announcements = ref<{ slides: AnnouncementSlide[]; index: number } | null>(null);
let _seq = 0;
let _installed = false;

function _on(kind: LiveKind): void {
  _stamps[kind] = ++_seq;
}

function _off(...kinds: LiveKind[]): void {
  for (const kind of kinds) delete _stamps[kind];
}

function _handle(type: string, payload: Record<string, unknown> | null | undefined): void {
  const p = payload ?? {};
  switch (type) {
    case BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT: {
      const snapshot = p.snapshot as { active?: boolean } | undefined;
      if (snapshot?.active) {
        if (_stamps.music === undefined) _on("music");
      } else _off("music");
      break;
    }
    case BROADCAST_TYPE.BIBLE_VERSE:
      if (p.active && p.text) {
        _bible.value = {
          text: String(p.text),
          reference: String(p.reference ?? ""),
          nextReference: String(p.next_reference ?? ""),
          passage: passageOf(p),
        };
        _on("bible");
      } else {
        _bible.value = null;
        _off("bible");
      }
      break;
    case BROADCAST_TYPE.FILE_PROJECTION:
      if (p.action === "clear" || p.active === false || !p.url) {
        _file.value = null;
        _onlineVideoId.value = null;
        _off("file");
      } else {
        _file.value = {
          type: String(p.type ?? ""),
          url: String(p.url),
          title: String(p.title ?? ""),
          playback_id: p.playback_id ? String(p.playback_id) : undefined,
        };
        _onlineVideoId.value = videoIdFromPlaybackUrl(String(p.url));
        _on("file");
      }
      break;
    case BROADCAST_TYPE.ONLINE_VIDEO_PROJECTION:
      _onlineTitle.value = String(p.title ?? "");
      _onlineVideoId.value = videoIdFromPlaybackUrl(String(p.url ?? ""));
      _on("online_video");
      break;
    case BROADCAST_TYPE.ANNOUNCEMENTS_STATE:
      if (p.active && Array.isArray(p.slides) && p.slides.length) {
        _announcements.value = { slides: p.slides as AnnouncementSlide[], index: Number(p.index) || 0 };
        _on("announcements");
      } else {
        _announcements.value = null;
        _off("announcements");
      }
      break;
    case BROADCAST_TYPE.ANNOUNCEMENTS_POSITION:
      if (_announcements.value && p.active !== false) {
        _announcements.value = { ..._announcements.value, index: Number(p.index) || 0 };
      } else if (p.active === false) {
        _announcements.value = null;
        _off("announcements");
      }
      break;
    case BROADCAST_TYPE.MEDIA_CLOSE:
      _file.value = null;
      _onlineTitle.value = "";
      _onlineVideoId.value = null;
      _off("music", "file", "online_video");
      break;
  }
}

function _install(): void {
  if (_installed) return;
  _installed = true;
  Broadcast.listen((msg) => _handle(msg.type, msg.payload as Record<string, unknown>));
}

const current = computed<LiveKind | null>(() => {
  let best: LiveKind | null = null;
  let bestSeq = -1;
  for (const [kind, seq] of Object.entries(_stamps) as [LiveKind, number][]) {
    if (seq > bestSeq) {
      best = kind;
      bestSeq = seq;
    }
  }
  return best;
});

const currentAnnouncement = computed(() => {
  const a = _announcements.value;
  return a ? (a.slides[a.index] ?? null) : null;
});

export function useLiveContent() {
  _install();
  const slides = useSlides();
  /** O nome do que está no ar, qualquer que seja o tipo; vazio sem nada. */
  const title = computed(() => {
    switch (current.value) {
      case "music":
        return slides.title.value;
      case "bible":
        return _bible.value?.reference ?? "";
      case "file":
        return _file.value?.title ?? "";
      case "online_video":
        return _onlineTitle.value;
      case "announcements":
        return currentAnnouncement.value?.nome ?? "";
      default:
        return "";
    }
  });
  return {
    current,
    title,
    music: slides,
    bible: _bible,
    file: _file,
    onlineTitle: _onlineTitle,
    onlineVideoId: _onlineVideoId,
    announcement: currentAnnouncement,
  };
}

/** Só para testes. */
export function _handleLiveMessage(type: string, payload: Record<string, unknown>): void {
  _handle(type, payload);
}
