<template>
  <div class="linux-downloads">
    <LjField :label="t('shell.desktop_download.linux.processor')" layout="column">
      <LjSelect
        :model-value="architecture"
        :items="architectures"
        @update:model-value="selectArchitecture"
      />
    </LjField>

    <div v-if="architecture" class="linux-downloads__packages">
      <a
        v-for="item in packages"
        :key="item.format"
        class="linux-downloads__package"
        :href="linuxDownloadUrl(item.format, architecture, version)"
      >
        <span class="linux-downloads__label">
          <LjIcon :icon="ICONS.ACTIONS.DOWNLOAD" :size="16" />
          {{ t("shell.desktop_download.linux.download_format", { format: item.label }) }}
        </span>
        <span class="linux-downloads__description">
          {{ t(`shell.desktop_download.linux.${item.format}`) }}
        </span>
      </a>
    </div>
    <p v-else class="linux-downloads__hint">
      {{ t("shell.desktop_download.linux.choose_processor") }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { LjField, LjIcon, LjSelect } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import {
  detectLinuxDownloadArchitecture,
  linuxDownloadUrl,
  type LinuxDownloadArchitecture,
  type LinuxDownloadFormat,
} from "@/helpers/DesktopDownload";

defineProps<{ version: string }>();

const { t } = useI18n();
const architecture = ref<LinuxDownloadArchitecture | null>(
  detectLinuxDownloadArchitecture(navigator)
);
const architectures = computed(() => [
  { value: "x64", label: t("shell.desktop_download.linux.x64") },
  { value: "arm64", label: t("shell.desktop_download.linux.arm64") },
]);
const packages: { format: LinuxDownloadFormat; label: string }[] = [
  { format: "deb", label: ".deb" },
  { format: "rpm", label: ".rpm" },
  { format: "appimage", label: "AppImage" },
];

function selectArchitecture(value: string | number): void {
  if (value === "x64" || value === "arm64") architecture.value = value;
}
</script>

<style scoped>
.linux-downloads__packages {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: var(--lj-space-3);
}

.linux-downloads__package {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-3);
  padding: var(--lj-space-4);
  border: 1px solid var(--lj-surface-border);
  border-radius: var(--lj-radius-sm);
  background: var(--lj-surface-bg);
  color: var(--lj-text);
  text-decoration: none;
}

.linux-downloads__package:hover {
  border-color: var(--lj-ui-accent);
  background: var(--lj-surface-bg-hover);
}

.linux-downloads__package:focus-visible {
  outline: 2px solid var(--lj-ui-accent);
  outline-offset: 2px;
}

.linux-downloads__label {
  display: flex;
  align-items: center;
  gap: var(--lj-space-2);
  font-size: var(--lj-text-sm);
  font-weight: var(--lj-weight-semibold);
}

.linux-downloads__description,
.linux-downloads__hint {
  margin: 0;
  color: var(--lj-text-muted);
  font-size: var(--lj-text-sm);
  line-height: 1.4;
}
</style>
