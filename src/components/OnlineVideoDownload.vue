<template>
  <span v-if="visible" class="ovd" @click.stop>
    <OnlineVideoDownloadBadge v-if="showStatus" :video-id="videoId" />
    <LjButton
      v-if="state === 'downloading'"
      size="sm"
      variant="ghost"
      icon-only
      :icon="ICONS.ACTIONS.CLOSE"
      :title="t('online_video.download.cancel')"
      :aria-label="t('online_video.download.cancel')"
      @click.stop="downloads.cancel(videoId!)"
    />
    <LjButton
      v-else-if="state === 'downloaded'"
      size="sm"
      variant="ghost"
      icon-only
      :icon="ICONS.ACTIONS.DOWNLOAD_OFF"
      :title="t('online_video.download.remove')"
      :aria-label="t('online_video.download.remove')"
      @click.stop="askRemove"
    />
    <LjButton
      v-else
      size="sm"
      variant="ghost"
      icon-only
      :icon="ICONS.ACTIONS.DOWNLOAD"
      :title="t('online_video.download.start')"
      :aria-label="t('online_video.download.start')"
      @click.stop="downloads.download(videoId!, name)"
    />
  </span>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { LjButton } from "@/components/ui";
import OnlineVideoDownloadBadge from "@/components/OnlineVideoDownloadBadge.vue";
import { ICONS } from "@/config/Icons";
import $alert from "@/helpers/Alert";
import { useOnlineVideoDownloads } from "@/composables/useOnlineVideoDownloads";

const props = withDefaults(
  defineProps<{
    /** ID do vídeo do YouTube; sem ele (link inválido) o controle não aparece. */
    videoId: string | null;
    name: string;
    /** Mostra o selo de estado ao lado do botão; na grade o selo vai sobre a miniatura. */
    showStatus?: boolean;
  }>(),
  { showStatus: true }
);

const { t } = useI18n();
const downloads = useOnlineVideoDownloads();

const state = computed(() => (props.videoId ? downloads.stateOf(props.videoId) : "none"));
const visible = computed(() => downloads.available && !!props.videoId);

function askRemove(): void {
  const id = props.videoId;
  if (!id) return;
  $alert.yesno({ title: "online_video.download.confirm_remove" }, async (btn?: string) => {
    if (btn === "yes") await downloads.remove(id);
  });
}
</script>

<style scoped>
.ovd {
  display: inline-flex;
  align-items: center;
  gap: var(--lj-space-2);
  flex-shrink: 0;
}
</style>
