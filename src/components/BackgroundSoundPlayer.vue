<template>
  <div class="bgs-footer" :class="{ 'bgs-footer--embedded': props.embedded }">
    <div class="bgs-footer-row">
      <div class="bgs-footer-info">
        <LjIcon :icon="ICONS.MODULES.BACKGROUND_SOUND" size="16" class="bgs-footer-icon" />
        <span class="bgs-footer-file lj-u-truncate">
          {{ bg.currentFile.value?.name || bg.currentFile.value?.fileName }}
        </span>
        <span class="bgs-footer-time">
          {{ formatTime(bg.currentTime.value) }} / {{ formatTime(bg.duration.value) }}
        </span>
      </div>

      <div class="bgs-footer-progress">
        <LjSlider
          :model-value="bg.progress.value"
          :max="100"
          class="bgs-progress-slider"
          @update:model-value="bg.seek"
        />
      </div>

      <div class="bgs-footer-actions">
        <LjButton
          :icon="bg.repeat.value ? ICONS.PLAYER.LOOP : ICONS.PLAYER.LOOP_OFF"
          size="sm"
          :variant="bg.repeat.value ? 'primary' : 'ghost'"
          class="bgs-footer-icon"
          icon-only
          :title="$t('shell.background_sound.repeat')"
          @click="toggleRepeat"
        />
        <LjButton
          variant="ghost"
          size="sm"
          :icon="bg.isPlaying.value ? ICONS.PLAYER.PAUSE : ICONS.PLAYER.PLAY"
          class="bgs-footer-icon"
          icon-only
          :title="$t(`shell.background_sound.${bg.isPlaying.value ? 'pause' : 'play'}`)"
          @click="bg.toggleWithFade()"
        />
        <LjButton
          variant="danger"
          size="sm"
          :icon="ICONS.PLAYER.STOP"
          icon-only
          data-testid="bgs-stop-fade"
          :title="$t('shell.background_sound.stop')"
          @click="bg.stopWithFade()"
        />
        <LjButton
          variant="danger"
          size="sm"
          :icon="ICONS.PLAYER.STOP_NOW"
          icon-only
          data-testid="bgs-stop-now"
          :title="$t('shell.background_sound.stop_immediately')"
          @click="bg.stop(0)"
        />
      </div>

      <div class="bgs-footer-volume">
        <LjIcon :icon="volumeIcon" size="14" class="bgs-footer-vol-icon" @click="toggleMute" />
        <LjSlider
          :model-value="bg.volume.value"
          :min="0"
          :max="100"
          class="bgs-volume-slider"
          @update:model-value="bg.setVolume"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { LjButton, LjIcon, LjSlider } from "@/components/ui";
import { computed, ref } from "vue";
import { useBackgroundSound } from "@/composables/useBackgroundSound";
import { saveSetting } from "@/helpers/SettingsStorage";
import { SETTINGS_TABLE } from "@/constants/DbTables";
import { ICONS } from "@/config/Icons";

const props = withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false });

const bg = useBackgroundSound();
const isMuted = ref(false);
const previousVolume = ref(50);

const volumeIcon = computed(() => {
  const v = bg.volume.value;
  if (v <= 0 || isMuted.value) return ICONS.PLAYER.VOLUME_MUTE;
  if (v <= 20) return ICONS.PLAYER.VOLUME_LOW;
  if (v <= 50) return ICONS.PLAYER.VOLUME_MEDIUM;
  return ICONS.PLAYER.VOLUME_HIGH;
});

function toggleRepeat(): void {
  const next = !bg.repeat.value;
  bg.repeat.value = next;
  saveSetting({ id: SETTINGS_TABLE.BACKGROUND_SOUND, repeat: next });
}

function toggleMute(): void {
  if (isMuted.value) {
    bg.setVolume(previousVolume.value);
    isMuted.value = false;
  } else {
    previousVolume.value = bg.volume.value;
    bg.setVolume(0);
    isMuted.value = true;
  }
}

function formatTime(seconds: number): string {
  if (!seconds || !isFinite(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
</script>

<style scoped>
.bgs-footer {
  flex-shrink: 0;
  height: 30px;
  overflow: hidden;
  border-bottom: 1px solid var(--lj-footer-border);
  background: var(--lj-tabs-bg);
}
.bgs-footer-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 2px 12px;
  height: 30px;
  box-sizing: border-box;
}

/* Na aba da biblioteca a barra fecha o painel por baixo: a borda é em cima. */
.bgs-footer--embedded {
  height: 28px;
  border-top: 1px solid var(--lj-surface-border);
  border-bottom: 0;
}

.bgs-footer--embedded .bgs-footer-row {
  height: 28px;
  padding-block: 0;
  padding-inline: var(--lj-space-3);
}
.bgs-footer-info {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 200px;
  flex-shrink: 0;
  max-width: 500px;
}
.bgs-footer-icon {
  flex-shrink: 0;
  color: var(--lj-text-on-navy);
  opacity: 0.7;
}
.bgs-footer-file {
  font-size: 12px;
  font-weight: 500;
  color: var(--lj-text-on-navy);
  max-width: 400px;
}
.bgs-footer-time {
  font-size: 11px;
  color: var(--lj-text-on-navy);
  opacity: 0.6;
  white-space: nowrap;
}
.bgs-footer-progress {
  flex: 1;
  min-width: 60px;
}
.bgs-footer-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}
.bgs-footer-volume {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 90px;
  flex-shrink: 0;
}
.bgs-footer-vol-icon {
  cursor: pointer;
  color: var(--lj-text-on-navy);
  opacity: 0.7;
  flex-shrink: 0;
}
.bgs-vol-icon:hover {
  opacity: 1;
}

/* A faixa é sempre navy (--lj-tabs-bg) em todos os temas, então o preenchimento
   não pode seguir o acento: em tema claro o acento é navy e sumiria no fundo. */
.bgs-progress-slider :deep(.lj-slider__range),
.bgs-volume-slider :deep(.lj-slider__range) {
  background: var(--lj-orange);
}

.bgs-progress-slider :deep(.lj-slider__thumb),
.bgs-volume-slider :deep(.lj-slider__thumb) {
  border-color: var(--lj-orange);
}

.bgs-progress-slider :deep(.lj-slider__track),
.bgs-volume-slider :deep(.lj-slider__track) {
  background: var(--lj-white-alpha-25);
}

@media (max-width: 700px) {
  .bgs-footer,
  .bgs-footer-row,
  .bgs-footer--embedded,
  .bgs-footer--embedded .bgs-footer-row {
    height: 44px;
  }

  .bgs-footer-row {
    gap: var(--lj-space-2);
    padding-inline: var(--lj-space-2);
  }

  .bgs-footer-info {
    min-width: 0;
    flex: 1 1 80px;
  }

  .bgs-footer-time,
  .bgs-footer-volume {
    display: none;
  }

  .bgs-footer-progress {
    min-width: 40px;
  }

  .bgs-footer-actions {
    gap: 0;
  }

  .bgs-footer-actions :deep(.lj-btn) {
    min-width: 40px;
    min-height: 40px;
  }
}
</style>
