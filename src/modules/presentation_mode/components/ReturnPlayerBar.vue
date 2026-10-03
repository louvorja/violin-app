<template>
  <footer v-if="player.state.id" class="pm-rplayer" data-testid="pm-return-player">
    <span class="pm-rplayer__pill">{{ tm("outputs.return_only") }}</span>
    <span class="pm-rplayer__title" :title="player.state.title">{{ player.state.title }}</span>
    <LjButton
      variant="primary"
      icon-only
      :icon="player.state.paused ? ICONS.PLAYER.PLAY : ICONS.PLAYER.PAUSE"
      :title="player.state.paused ? tm('stage.play') : tm('stage.pause')"
      data-testid="pm-return-player-play"
      @click="player.toggle()"
    />
    <LjButton
      icon-only
      :icon="ICONS.PLAYER.REWIND_10"
      :title="tm('video.back_10')"
      @click="player.advance(-10)"
    />
    <LjButton
      icon-only
      :icon="ICONS.PLAYER.FORWARD_10"
      :title="tm('video.forward_10')"
      @click="player.advance(10)"
    />
    <span class="pm-rplayer__time">{{ DateTime.shortTime(player.state.currentTime) }}</span>
    <LjSlider
      class="pm-rplayer__timeline"
      :model-value="player.state.currentTime"
      :min="0"
      :max="player.state.duration || 1"
      :step="0.1"
      :disabled="!player.state.duration"
      :aria-label="tm('video.timeline')"
      @update:model-value="(t: number) => player.seek(t)"
    />
    <span class="pm-rplayer__remaining" data-testid="pm-return-player-remaining">
      −{{ DateTime.shortTime(remaining) }}
      <span class="pm-rplayer__ends">{{ tm("video.ends_at", { time: endsAt }) }}</span>
    </span>
    <LjSlider
      class="pm-rplayer__volume"
      :model-value="player.state.muted ? 0 : Math.round(player.state.volume * 100)"
      :min="0"
      :max="100"
      :disabled="player.state.muted"
      :aria-label="tm('video.volume')"
      @update:model-value="(v: number) => player.setVolume(v / 100)"
    />
    <LjButton
      icon-only
      :variant="player.state.muted ? 'danger' : 'default'"
      :icon="ICONS.PLAYER.VOLUME_MUTE"
      :title="player.state.muted ? tm('video.unmute') : tm('video.mute')"
      :aria-pressed="player.state.muted"
      @click="player.toggleMute()"
    />
    <LjButton
      icon-only
      :icon="ICONS.ACTIONS.CLOSE"
      :title="tm('library.remove_from_return')"
      data-testid="pm-return-player-close"
      @click="emit('close')"
    />
  </footer>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import { LjButton, LjSlider } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { ModuleEnum } from "@/enums/ModuleEnum";
import DateTime from "@/helpers/DateTime";
import { useModuleI18n } from "@/composables/useModuleI18n";
import { useReturnPlayer } from "../composables/useReturnPlayer";

/**
 * O player do vídeo que está só no retorno de palco: aparece no palco
 * enquanto ele toca, para o operador pausar, voltar, ver quanto falta e
 * tirar do retorno sem procurar o arquivo na biblioteca.
 */

const emit = defineEmits<{ close: [] }>();

const { tm, locale } = useModuleI18n(ModuleEnum.PRESENTATION_MODE);
const player = useReturnPlayer();

const remaining = computed(() => Math.max(0, player.state.duration - player.state.currentTime));
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
.pm-rplayer {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 48px;
  padding: 0 8px;
  flex-shrink: 0;
  background: var(--lj-surface-bg);
  border-top: 2px solid var(--lj-color-cover-gold);
  color: var(--lj-text);
}

.pm-rplayer > * {
  flex-shrink: 0;
}

.pm-rplayer__pill {
  padding: 1px 6px;
  border-radius: 2px;
  background: var(--lj-color-cover-gold);
  color: var(--lj-color-projection-bg);
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.4px;
}

.pm-rplayer__title {
  flex-shrink: 1;
  min-width: 40px;
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: var(--lj-weight-semibold);
}

.pm-rplayer__time {
  font-family: var(--lj-font-mono);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--lj-text-muted);
}

.pm-rplayer__timeline {
  flex: 1 1 auto;
  min-width: 60px;
}

.pm-rplayer__remaining {
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

.pm-rplayer__ends {
  font-size: 10px;
  font-weight: 400;
  color: var(--lj-text-muted);
}

.pm-rplayer__volume {
  width: 80px;
}
</style>
