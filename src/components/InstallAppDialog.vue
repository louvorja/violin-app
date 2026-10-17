<template>
  <LjDialog
    v-model="open"
    :title="t('shell.pwa_install.title')"
    :icon="ICONS.UI.INSTALL"
    :description="
      channel === 'desktop' ? t('shell.desktop_download.description') : t('shell.pwa_install.intro')
    "
    size="md"
  >
    <div class="install">
      <LjAlert v-if="reasonText" variant="info" :text="reasonText" />

      <a
        v-if="channel === 'desktop'"
        class="install__download"
        :href="desktopDownload.url"
        :target="desktopDownload.direct ? undefined : '_blank'"
        :rel="desktopDownload.direct ? undefined : 'noopener noreferrer'"
      >
        <LjIcon :icon="ICONS.UI.INSTALL" :size="16" />
        {{ desktopDownloadLabel(desktopDownload.platform, t) }}
      </a>

      <section v-if="channel === 'pwa'">
        <h3 class="install__heading">{{ t("shell.pwa_install.benefits_title") }}</h3>
        <ul class="install__list">
          <li>{{ t("shell.pwa_install.benefit_offline") }}</li>
          <li>{{ t("shell.pwa_install.benefit_fullscreen") }}</li>
          <li>{{ t("shell.pwa_install.benefit_shortcut") }}</li>
        </ul>
      </section>

      <LjButton
        v-if="channel === 'pwa' && kind === 'native'"
        variant="primary"
        block
        @click="install(dialogReason)"
      >
        <LjIcon :icon="ICONS.UI.INSTALL" :size="16" />
        {{ t("shell.pwa_install.install_now") }}
      </LjButton>

      <section v-else-if="channel === 'pwa'">
        <h3 class="install__heading">{{ t("shell.pwa_install.steps_title") }}</h3>
        <p v-if="kind === 'unsupported'" class="install__text">
          {{ t("shell.pwa_install.unsupported") }}
        </p>
        <ol v-else class="install__steps">
          <li v-for="n in stepCount" :key="n">{{ t(`shell.pwa_install.${kind}_${n}`) }}</li>
        </ol>
      </section>
    </div>
  </LjDialog>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { LjAlert, LjButton, LjDialog, LjIcon } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { desktopDownloadLabel } from "@/helpers/DesktopDownload";
import { useAppInstall } from "@/composables/useAppInstall";

const open = defineModel<boolean>({ default: false });
const { t } = useI18n();
const { channel, desktopDownload, kind, install, dialogReason } = useAppInstall();

const STEPS = { ios: 4, android: 3, chromium: 3 } as const;
const stepCount = computed(() => STEPS[kind.value as keyof typeof STEPS] ?? 0);
const reasonText = computed(() =>
  dialogReason.value === "general" ? "" : t(`shell.pwa_install.why_${dialogReason.value}`)
);
</script>

<style scoped>
.install {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-6);
}
.install__heading {
  margin: 0 0 var(--lj-space-3);
  font-size: 0.8125rem;
  font-weight: 600;
}
.install__list,
.install__steps {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-3);
  margin: 0;
  padding-left: var(--lj-space-7);
  font-size: 0.8125rem;
}
.install__download {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--lj-space-3);
  height: var(--lj-ui-h-md);
  border-radius: var(--lj-ui-radius);
  background: var(--lj-ui-accent);
  color: var(--lj-ui-accent-fg);
  font-weight: 600;
  text-decoration: none;
}
.install__text {
  margin: 0;
  font-size: 0.8125rem;
}
</style>
