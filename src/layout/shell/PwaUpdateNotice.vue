<template>
  <section
    v-if="!Platform.isDesktop && state.ready"
    class="pwa-update-notice"
    role="status"
    aria-live="polite"
    :aria-label="t('options.updates.pwa_ready')"
  >
    <LjIcon :icon="ICONS.UI.CHECK_UPDATE" size="18" class="pwa-update-notice__icon" />
    <div class="pwa-update-notice__body">
      <strong>{{ t("options.updates.pwa_ready") }}</strong>
      <span>{{ detail }}</span>
    </div>
    <LjButton
      variant="primary"
      :icon="ICONS.ACTIONS.RESTART"
      :disabled="blocked"
      :loading="state.status === 'applying'"
      @click="apply"
    >
      {{ t("options.updates.pwa_apply") }}
    </LjButton>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { LjButton, LjIcon } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import Platform from "@/helpers/Platform";
import { usePwaUpdates } from "@/composables/usePwaUpdates";

const { t } = useI18n();
const { state, apply, blocked } = usePwaUpdates();
const detail = computed(() =>
  t(
    state.value.status === "applying"
      ? "options.updates.pwa_applying"
      : state.value.status === "error"
        ? "options.updates.pwa_error"
        : blocked.value
          ? "options.updates.pwa_blocked"
          : "options.updates.pwa_reload_hint"
  )
);
</script>

<style scoped>
.pwa-update-notice {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: var(--lj-space-4);
  padding: var(--lj-space-3) var(--lj-space-5);
  background: var(--lj-active-bg);
  border-bottom: 1px solid var(--lj-surface-border);
  color: var(--lj-text);
  font-size: var(--lj-text-sm);
}

.pwa-update-notice__icon {
  flex-shrink: 0;
  color: var(--lj-info);
}

.pwa-update-notice__body {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  gap: var(--lj-space-1);
}

.pwa-update-notice__body span {
  color: var(--lj-text-muted);
}

@media (max-width: 600px) {
  .pwa-update-notice {
    flex-wrap: wrap;
  }

  .pwa-update-notice__body {
    flex-basis: calc(100% - 18px - var(--lj-space-4));
  }

  .pwa-update-notice :deep(.lj-btn) {
    margin-left: auto;
    min-height: 44px;
  }
}
</style>
