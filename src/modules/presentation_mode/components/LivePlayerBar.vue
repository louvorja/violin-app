<template>
  <footer
    class="pm-lvideo"
    :class="`pm-lvideo--${layer}`"
    :data-testid="layer === 'audio' ? 'pm-live-audio' : 'pm-live-video'"
  >
    <span class="pm-lvideo__pill">
      <LjIcon v-if="layer === 'audio'" :icon="ICONS.MUSIC.AUDIO" :size="11" />
      {{ layer === "audio" ? tm("layers.audio") : tm("stage.on_air") }}
    </span>
    <span class="pm-lvideo__title" :title="title">{{ title }}</span>
    <LjButton
      variant="primary"
      icon-only
      :icon="player.playing.value ? ICONS.PLAYER.PAUSE : ICONS.PLAYER.PLAY"
      :title="player.playing.value ? tm('stage.pause') : tm('stage.play')"
      :disabled="locked"
      data-testid="pm-live-video-play"
      @click="player.toggle()"
    />
    <LjButton
      icon-only
      :icon="ICONS.PLAYER.REWIND_10"
      :title="tm('video.back_10')"
      :disabled="locked"
      data-testid="pm-live-video-back"
      @click="player.seekBy(-10)"
    />
    <LjButton
      icon-only
      :icon="ICONS.PLAYER.FORWARD_10"
      :title="tm('video.forward_10')"
      :disabled="locked"
      data-testid="pm-live-video-forward"
      @click="player.seekBy(10)"
    />
    <span class="pm-lvideo__time">{{ DateTime.shortTime(player.currentTime.value) }}</span>
    <LjSlider
      class="pm-lvideo__timeline"
      :model-value="player.currentTime.value"
      :min="0"
      :max="player.duration.value || 1"
      :step="0.1"
      :disabled="locked || !player.duration.value"
      :aria-label="tm('video.timeline')"
      data-testid="pm-live-video-timeline"
      @update:model-value="(t: number) => player.seekTo(t)"
    />
    <span class="pm-lvideo__remaining">
      −{{ DateTime.shortTime(remaining) }}
      <span class="pm-lvideo__ends">{{ tm("video.ends_at", { time: endsAt }) }}</span>
    </span>
    <!-- Música por baixo da foto: parar só ela; a foto continua no ar. -->
    <LjButton
      v-if="layer === 'audio'"
      icon-only
      variant="ghost"
      :icon="ICONS.ACTIONS.CLOSE"
      :title="tm('layers.stop_audio')"
      :aria-label="tm('layers.stop_audio')"
      data-testid="pm-live-audio-stop"
      @click="emit('stop')"
    />
  </footer>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import { LjButton, LjIcon, LjSlider } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { ModuleEnum } from "@/enums/ModuleEnum";
import DateTime from "@/helpers/DateTime";
import { useModuleI18n } from "@/composables/useModuleI18n";
import type { useLiveTransport } from "../composables/useLiveTransport";

/**
 * Faixa do player acima da barra do centro, para o que toca junto com outra
 * coisa: o vídeo da vez numa pasta ou momento (a barra anda pelos arquivos) e
 * a música por baixo de uma foto (a barra é da foto). Como a do vídeo só no
 * retorno. O volume e o silenciar ficam na barra de baixo, que é a do som.
 */

const props = defineProps<{
  player: ReturnType<typeof useLiveTransport>["player"];
  title: string;
  locked: boolean;
  /** `video`: parte do que está no ar; `audio`: a camada de áudio, com o próprio parar. */
  layer: "video" | "audio";
}>();

const emit = defineEmits<{ stop: [] }>();

const { tm, locale } = useModuleI18n(ModuleEnum.PRESENTATION_MODE);

const remaining = computed(() =>
  Math.max(0, props.player.duration.value - props.player.currentTime.value)
);
const now = ref(Date.now());
const clock = setInterval(() => (now.value = Date.now()), 1000);
onBeforeUnmount(() => clearInterval(clock));
const endsAt = computed(() =>
  new Date(now.value + remaining.value * 1000).toLocaleTimeString(locale.value, {
    hour: "2-digit",
    minute: "2-digit",
  })
);
</script>

<style scoped>
.pm-lvideo {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 48px;
  padding: 0 8px;
  flex-shrink: 0;
  background: var(--lj-surface-bg);
  border-top: 2px solid var(--lj-orange);
  color: var(--lj-text);
}

.pm-lvideo > * {
  flex-shrink: 0;
}

.pm-lvideo--audio {
  border-top-color: var(--lj-live-select);
}

.pm-lvideo--audio .pm-lvideo__pill {
  background: var(--lj-live-select);
}

.pm-lvideo__pill {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 6px;
  border-radius: 2px;
  background: var(--lj-danger);
  color: var(--lj-white);
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.4px;
}

.pm-lvideo__title {
  flex-shrink: 1;
  min-width: 40px;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: var(--lj-weight-semibold);
}

.pm-lvideo__time {
  font-family: var(--lj-font-mono);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--lj-text-muted);
}

.pm-lvideo__timeline {
  flex: 1 1 auto;
  min-width: 60px;
}

.pm-lvideo__remaining {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  line-height: 1.15;
  font-family: var(--lj-font-mono);
  font-size: 14px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.pm-lvideo__ends {
  font-size: 10px;
  font-weight: 400;
  color: var(--lj-text-muted);
}
</style>
