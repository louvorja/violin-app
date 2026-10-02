<template>
  <div class="opt">
    <section class="opt-section">
      <h3 class="opt-section-title">
        <LjIcon :icon="ICONS.UI.FOLDER_OPEN" size="18" />
        {{ $t("open_file.title") }}
      </h3>
      <p class="opt-hint">{{ hint }}</p>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { LjIcon } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import Platform from "@/helpers/Platform";

const { t } = useI18n();

/**
 * Como abrir um .slja sem adicioná-lo a uma coletânea depende de onde o app
 * roda. A escolha é por capacidade, não por sistema: o PWA no Chrome desktop
 * tem "Abrir com" (launchQueue) e o Android, não.
 */
const hint = computed<string>(() => {
  if (!Platform.isDesktop && window.matchMedia?.("(hover: none) and (pointer: coarse)").matches) {
    return t("open_file.hint_touch");
  }
  let how: string;
  if (Platform.isDesktop) {
    how = t(Platform.platform === "darwin" ? "open_file.hint_mac" : "open_file.hint_desktop");
  } else if ("launchQueue" in window) {
    how = t("open_file.hint_pwa");
  } else {
    how = t("open_file.hint_web");
  }
  return `${how} ${t("open_file.keep")}`;
});
</script>
