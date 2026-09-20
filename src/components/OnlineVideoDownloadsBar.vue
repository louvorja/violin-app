<template>
  <div v-if="visible" class="ovd-bar">
    <span class="ovd-bar__summary">{{ summary }}</span>
    <span class="lj-u-spacer" />
    <LjButton v-if="missing.length" size="sm" :icon="ICONS.ACTIONS.DOWNLOAD" @click="downloadAll">
      {{ t("online_video.download.download_all") }}
    </LjButton>
    <LjButton
      v-if="present.length"
      size="sm"
      variant="ghost"
      :icon="ICONS.ACTIONS.DOWNLOAD_OFF"
      @click="askRemoveAll"
    >
      {{ t("online_video.download.remove_all") }}
    </LjButton>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { LjButton } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import $alert from "@/helpers/Alert";
import { formatBytes, useOnlineVideoDownloads } from "@/composables/useOnlineVideoDownloads";

const props = defineProps<{
  /** Os vídeos da lista do operador; dois itens com o mesmo vídeo contam uma vez só. */
  items: { id: string | null; name: string }[];
}>();

const { t } = useI18n();
const downloads = useOnlineVideoDownloads();

const unique = computed(() => {
  const byId = new Map<string, string>();
  for (const item of props.items) if (item.id && !byId.has(item.id)) byId.set(item.id, item.name);
  return [...byId].map(([id, name]) => ({ id, name }));
});

const present = computed(() =>
  unique.value.filter((i) => downloads.stateOf(i.id) === "downloaded")
);
const missing = computed(() => unique.value.filter((i) => downloads.stateOf(i.id) === "none"));
const visible = computed(() => downloads.available && unique.value.length > 0);

const summary = computed(() =>
  t("online_video.download.summary", {
    count: present.value.length,
    total: unique.value.length,
    size: formatBytes(
      present.value.reduce((sum, i) => sum + (downloads.files[i.id]?.size ?? 0), 0)
    ),
  })
);

function downloadAll(): void {
  for (const item of missing.value) void downloads.download(item.id, item.name);
}

function askRemoveAll(): void {
  const ids = present.value.map((i) => i.id);
  $alert.yesno(
    {
      title: t("online_video.download.confirm_remove_all", { count: ids.length }),
      translate: false,
    },
    async (btn?: string) => {
      if (btn !== "yes") return;
      for (const id of ids) await downloads.remove(id);
    }
  );
}
</script>

<style scoped>
.ovd-bar {
  display: flex;
  align-items: center;
  gap: var(--lj-space-3);
  padding: var(--lj-space-3) var(--lj-space-4);
  background: var(--lj-surface-bg-soft);
  border: 1px solid var(--lj-surface-border);
  border-radius: var(--lj-radius-md);
  font-size: var(--lj-text-sm);
  color: var(--lj-text-muted);
}

.ovd-bar__summary {
  font-variant-numeric: tabular-nums;
}
</style>
