<template>
  <span v-if="visible" class="ovd-badge" :class="`ovd-badge--${state}`" :title="detail">
    <template v-if="state === 'downloading'">
      <span class="ovd-badge__bar"><LjProgress :value="percent" :height="4" /></span>
      <span class="ovd-badge__text">{{ label }}</span>
    </template>
    <LjChip v-else variant="success" size="sm" :icon="ICONS.UI.CHECK">
      {{ compact ? size : `${t("online_video.download.done")} · ${size}` }}
    </LjChip>
  </span>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { LjChip, LjProgress } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { formatBytes, useOnlineVideoDownloads } from "@/composables/useOnlineVideoDownloads";

const props = defineProps<{
  videoId: string | null;
  /** Só o tamanho, sem a palavra "Baixado": para caber em cima de uma miniatura. */
  compact?: boolean;
}>();

const { t } = useI18n();
const downloads = useOnlineVideoDownloads();

const state = computed(() => (props.videoId ? downloads.stateOf(props.videoId) : "none"));
const visible = computed(() => downloads.available && state.value !== "none");
const pending = computed(() => (props.videoId ? downloads.pending[props.videoId] : undefined));
const percent = computed(() => pending.value?.percent ?? 0);
const detail = computed(() => pending.value?.detail ?? "");
const label = computed(() =>
  pending.value && pending.value.phase === "queued" ? detail.value : `${Math.round(percent.value)}%`
);
const size = computed(() => {
  const file = props.videoId ? downloads.files[props.videoId] : undefined;
  return file ? formatBytes(file.size) : "";
});
</script>

<style scoped>
.ovd-badge {
  display: inline-flex;
  align-items: center;
  gap: var(--lj-space-3);
  flex-shrink: 0;
}

.ovd-badge__bar {
  display: inline-flex;
  width: 64px;
}

.ovd-badge__text {
  min-width: 3ch;
  font-size: var(--lj-text-xs);
  font-variant-numeric: tabular-nums;
  color: var(--lj-text-muted);
  white-space: nowrap;
}
</style>
