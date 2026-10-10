<template>
  <OverlayRenderer />
  <div
    class="ann-root"
    :style="{
      justifyContent: current?.style?.alignY || 'center',
    }"
  >
    <template v-if="current">
      <!-- Cena da transição: slide anterior e novo se sobrepõem durante a animação -->
      <div v-if="hasContent" class="lj-tstage" :style="stageStyle">
        <Transition :name="transitionName">
          <!-- O fundo é do slide, não da raiz: o vnode saindo fica com a cor
               antiga congelada e as duas cores acompanham a animação juntas. -->
          <div
            :key="slideKey"
            class="lj-tslide"
            :style="{ background: current?.style?.bgColor || '#000' }"
          >
            <!-- Vídeo -->
            <video
              v-if="mediaUrl('video')"
              :src="mediaUrl('video')"
              class="ann-media"
              :style="mediaFitStyle"
              autoplay
              loop
              playsinline
            />

            <!-- Imagem -->
            <img
              v-else-if="mediaUrl('image')"
              :src="mediaUrl('image')"
              class="ann-media"
              :style="mediaFitStyle"
              alt=""
            />

            <!-- Texto (sempre acima de imagem/vídeo) -->
            <div
              v-if="current.texto"
              class="ann-text"
              :class="{ 'ann-text--over-media': mediaUrl('video') || mediaUrl('image') }"
              :style="textStyle"
            >
              {{ current.texto }}
            </div>
          </div>
        </Transition>
      </div>
      <div v-else class="ann-empty" />
    </template>
    <div v-else class="ann-empty" />
    <ProjectionClearScreen />
  </div>
</template>

<script setup lang="ts">
/**
 * AnnouncementsProjection — exibe os slides de Anúncios em sequência.
 * Recebe snapshot canônico da janela principal; navegação por
 * setas/espaço e pelo módulo (ANNOUNCEMENTS_CONTROL).
 */
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import "@/assets/styles/transitions.css";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import { useBroadcastListener } from "@/composables/useBroadcastListener";
import { useProjectionCloseNotice } from "@/composables/useProjectionCloseNotice";
import ProjectionClearScreen from "@/components/ProjectionClearScreen.vue";
import { useTransitionStage } from "@/composables/useTransitionStage";
import { PROJECTION_TYPE } from "@/constants/Projection";
import Broadcast from "@/helpers/Broadcast";
import OverlayRenderer from "@/components/OverlayRenderer.vue";
import { KEYS } from "@/constants/UserDataKeys";
import { createTransitionContext } from "@/config/Transitions";
import {
  AnnouncementsPresentationGate,
  type AnnouncementPacket,
  type AnnouncementSlide,
} from "@/presentation/AnnouncementsPresentationState";

const slides = ref<AnnouncementSlide[]>([]);
const index = ref(0);
const session = ref("");
const isBackward = ref(false);
let currentPacket: AnnouncementPacket | null = null;
const stateGate = new AnnouncementsPresentationGate();

const objectUrls: string[] = [];

const current = computed(() => slides.value[index.value] || null);

/** Marca o índice/sessão recebidos e decide a direção da transição:
 * sessão nova ou avanço → frente; índice menor na mesma sessão → trás. */
function setSlideIndex(next: number, nextSession: string): void {
  const sessionChanged = nextSession !== session.value;
  session.value = nextSession;
  isBackward.value = !sessionChanged && next < index.value;
  index.value = next;
}

const slideKey = computed(() => `${session.value}:${index.value}`);

/** Nome da classe Vue Transition + variáveis da stage — tabela e chaves por
 * módulo; `isBackward` alimenta o modo automático de direção. */
const { transitionName, stageStyle } = useTransitionStage(
  createTransitionContext(KEYS.MODULES.ANNOUNCEMENTS),
  { isBackward: () => isBackward.value }
);

const hasContent = computed(
  () => !!(mediaUrl("video") || mediaUrl("image") || current.value?.texto)
);

/** Cache de object URLs por slide+tipo — criado sob demanda, sem efeitos
 * colaterais dentro de computeds. */
const mediaUrlCache = new Map<string, string>();

function clearMediaCache(): void {
  for (const u of mediaUrlCache.values()) {
    URL.revokeObjectURL(u);
    const i = objectUrls.indexOf(u);
    if (i >= 0) objectUrls.splice(i, 1);
  }
  mediaUrlCache.clear();
}

function mediaUrl(kind: "image" | "video"): string {
  const s = current.value;
  if (!s) return "";
  const key = `${kind}:${s.id}`;
  const cached = mediaUrlCache.get(key);
  if (cached) return cached;
  const data = kind === "video" ? s.videoData : s.imageData;
  if (!data) return "";
  const mime = kind === "video" ? s.videoMime || "video/mp4" : s.imageMime || "image/jpeg";
  const url = URL.createObjectURL(new Blob([data], { type: mime }));
  mediaUrlCache.set(key, url);
  objectUrls.push(url);
  return url;
}

const mediaFitStyle = computed(() => ({
  objectFit: current.value?.style?.mediaFit || "contain",
}));

const textStyle = computed(() => {
  const s = current.value?.style || {};
  const hasMedia = !!(mediaUrl("video") || mediaUrl("image"));
  const ay = s.alignY || "center";
  const base: Record<string, string> = {
    color: s.textColor || "#fff",
    fontSize: `${s.fontSize || 64}px`,
    textAlign: s.align || "center",
  };
  if (s.textShadow) {
    const sc = s.textShadowColor || "#000000";
    const sb = s.textShadowBlur ?? 4;
    base.textShadow = `0 0 ${sb}px ${sc}, 0 0 ${sb}px ${sc}`;
  }
  if (hasMedia) {
    // Positioning absolute: top/bottom/transform
    if (ay === "flex-end") {
      base.top = "auto";
      base.bottom = "6vh";
    } else if (ay === "flex-start") {
      base.top = "6vh";
      base.bottom = "auto";
    } else {
      base.top = "50%";
      base.bottom = "auto";
      base.transform = "translateY(-50%)";
    }
  } else {
    base.justifyContent = ay;
  }
  return base;
});

function applyState(payload: unknown): void {
  const packet = stateGate.accept(payload);
  if (!packet) return;
  const previousSession = currentPacket?.announcement_session;
  currentPacket = packet;
  if (!packet.active) {
    slides.value = [];
    clearMediaCache();
    session.value = packet.announcement_session;
    return;
  }
  const newIds = packet.slides.map((s) => s.id).join(",");
  const oldIds = slides.value.map((s) => s.id).join(",");
  if (newIds !== oldIds || previousSession !== packet.announcement_session) {
    clearMediaCache();
  }
  slides.value = packet.slides;
  setSlideIndex(packet.index, packet.announcement_session);
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === "ArrowRight" || e.key === " ") next();
  else if (e.key === "ArrowLeft") prev();
}

function next(): void {
  if (currentPacket?.active)
    Broadcast.send(BROADCAST_TYPE.ANNOUNCEMENTS_CONTROL, {
      action: "next",
      announcement_session: currentPacket.announcement_session,
    });
}

function prev(): void {
  if (currentPacket?.active)
    Broadcast.send(BROADCAST_TYPE.ANNOUNCEMENTS_CONTROL, {
      action: "prev",
      announcement_session: currentPacket.announcement_session,
    });
}

useProjectionCloseNotice(PROJECTION_TYPE.ANNOUNCEMENTS);

useBroadcastListener(BROADCAST_TYPE.ANNOUNCEMENTS_STATE, (payload: unknown) => {
  applyState(payload);
});

useBroadcastListener(BROADCAST_TYPE.ANNOUNCEMENTS_POSITION, (payload: unknown) => {
  const packet = stateGate.acceptPosition(payload);
  if (packet) {
    currentPacket = packet;
    setSlideIndex(packet.index, packet.announcement_session);
  }
});

useBroadcastListener(BROADCAST_TYPE.ANNOUNCEMENTS_CONTROL, (payload: unknown) => {
  const data = payload as { action?: string; announcement_session?: string } | null;
  if (data?.action === "stop" && data.announcement_session === currentPacket?.announcement_session)
    window.close();
});

onMounted(() => {
  window.addEventListener("keydown", onKeydown);
  Broadcast.send(BROADCAST_TYPE.REQUEST_ANNOUNCEMENTS_STATE);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown);
  for (const u of objectUrls) URL.revokeObjectURL(u);
});
</script>

<style scoped>
.ann-root {
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  /* Base neutra quando não há slide — o fundo do deck é do .lj-tslide */
  background: #000;
}
.ann-media {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.ann-text {
  width: 100%;
  padding: 6vh 6vw;
  font-family: inherit;
  font-weight: 700;
  white-space: pre-wrap;
}
.ann-text--over-media {
  position: absolute;
  left: 0;
  z-index: 10;
  pointer-events: none;
}
.ann-empty {
  flex: 1;
}
</style>
