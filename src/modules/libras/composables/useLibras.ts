/**
 * useLibras — Composable para tradução em tempo real de slides para Libras.
 *
 * Escuta mudanças de slide via BroadcastChannel e mantém o gloss traduzido
 * pronto para exibição. Usa cache do IndexedDB quando disponível.
 *
 * @category composable
 */

import { ref, onUnmounted } from "vue";
import { useBroadcastListener } from "@/composables/useBroadcastListener";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import Libras from "@/helpers/Libras";
import { useLibrasState } from "./useLibrasState";
import $userdata from "@/helpers/UserData";
import { KEYS } from "@/constants/UserDataKeys";
import $dev from "@/helpers/Dev";
import { readMusicPresentationPacket } from "@/presentation/MusicPresentationPacket";

export function useLibras() {
  const { scopeEnabled } = useLibrasState();
  const gloss = ref<string>("");
  const originalText = ref<string>("");
  const isTranslating = ref(false);
  const lastSlideIndex = ref<number>(-1);
  let canonicalSelection: { session: string; revision: number; selectionRevision: number; index: number } | null = null;
  const retiredCanonicalSessions = new Set<string>();
  const retireCanonical = (session: string): void => {
    retiredCanonicalSessions.delete(session);
    retiredCanonicalSessions.add(session);
    if (retiredCanonicalSessions.size > 32) retiredCanonicalSessions.delete(retiredCanonicalSessions.values().next().value!);
  };

  /**
   * Traduz o texto de um slide e armazena o gloss.
   * Tenta cache IndexedDB primeiro (chave correta: music_{id}_{region});
   * se não encontrar, chama a API.
   */
  async function translateSlide(text: string, musicId?: number): Promise<void> {
    if (!scopeEnabled("music")) {
      gloss.value = "";
      originalText.value = "";
      return;
    }

    if (!text?.trim()) {
      gloss.value = "";
      originalText.value = "";
      return;
    }

    const plainText = Libras.stripHtml(text);
    if (!plainText) {
      gloss.value = "";
      originalText.value = "";
      return;
    }

    originalText.value = plainText;

    // 1. Tentar cache IndexedDB por texto original
    const cached = await Libras.findCachedByText(plainText, "music");
    if (cached?.gloss) {
      gloss.value = cached.gloss;
      $dev.write(`[libras] cache hit (text-based)`);
      return;
    }

    // 2. Chamar API de tradução
    isTranslating.value = true;
    try {
      const result = await Libras.translateText(plainText);
      if (result) {
        gloss.value = result;

        const tokens = Libras.uniqueTokens(result);
        const region = $userdata.get<string>(KEYS.MODULES.LIBRAS.REGION, "BR") || "BR";
        const slideId = `music_slide_${musicId || "unknown"}_${tokens.join("_").slice(0, 40)}_${region}`;
        await Libras.setCached({
          id: slideId,
          type: "music",
          ref_id: String(musicId || ""),
          lang: "pt",
          original_text: plainText,
          gloss: result,
          tokens,
          bundles_cached: false,
          bundles_size: 0,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      }
    } catch (e) {
      $dev.write(`[libras] erro ao traduzir slide:`, (e as Error).message);
    } finally {
      isTranslating.value = false;
    }
  }

  function translateSelection(lyric: string | null | undefined, id: string | number | null | undefined): void {
    if (!lyric) {
      gloss.value = "";
      originalText.value = "";
      return;
    }
    const musicId = Number(id);
    void translateSlide(lyric, Number.isFinite(musicId) && musicId > 0 ? musicId : undefined);
  }

  useBroadcastListener(BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT, (payload: unknown) => {
    const packet = readMusicPresentationPacket(payload);
    if (!packet) return;
    const { sessionId, revision, active, slideIndex, slide } = packet.snapshot;
    const { selectionRevision } = packet;
    if (retiredCanonicalSessions.has(sessionId)) return;
    if (canonicalSelection?.session === sessionId) {
      if (revision < canonicalSelection.revision ||
          selectionRevision < canonicalSelection.selectionRevision ||
          (revision === canonicalSelection.revision && selectionRevision === canonicalSelection.selectionRevision)) return;
    } else if (canonicalSelection) {
      retireCanonical(canonicalSelection.session);
    }
    const changed = canonicalSelection?.session !== sessionId || canonicalSelection.index !== slideIndex;
    canonicalSelection = { session: sessionId, revision, selectionRevision, index: slideIndex };
    if (!active) {
      retireCanonical(sessionId);
      canonicalSelection = null;
      lastSlideIndex.value = -1;
      gloss.value = "";
      originalText.value = "";
    } else if (changed) {
      lastSlideIndex.value = slideIndex;
      translateSelection(slide?.lyric, slide?.id_music);
    }
  });

  // The slide editor still emits an unversioned selection.
  useBroadcastListener(BROADCAST_TYPE.SLIDE_CHANGE, (payload: unknown) => {
    const data = payload as { presentation_session?: unknown; presentation_revision?: unknown;
      slide_index: number; slide?: { lyric?: string; id_music?: number } };
    if (data.presentation_session !== undefined || data.presentation_revision !== undefined) return;
    if (canonicalSelection) {
      retireCanonical(canonicalSelection.session);
      canonicalSelection = null;
      lastSlideIndex.value = -1;
    }
    if (data.slide_index === lastSlideIndex.value) return;
    lastSlideIndex.value = data.slide_index;
    translateSelection(data.slide?.lyric, data.slide?.id_music);
  });

  useBroadcastListener(BROADCAST_TYPE.MEDIA_CLOSE, () => {
    if (canonicalSelection) retireCanonical(canonicalSelection.session);
    canonicalSelection = null;
    lastSlideIndex.value = -1;
    gloss.value = "";
    originalText.value = "";
  });

  function clear(): void {
    gloss.value = "";
    originalText.value = "";
    lastSlideIndex.value = -1;
    canonicalSelection = null;
    retiredCanonicalSessions.clear();
  }

  onUnmounted(() => {
    clear();
  });

  return {
    gloss,
    originalText,
    isTranslating,
    translateSlide,
    clear,
  };
}
