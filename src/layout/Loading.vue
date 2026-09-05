<template>
  <Teleport to="body">
    <Transition name="loading">
      <div v-if="show" class="loading-overlay">
        <div class="loading" role="status">
          <div class="loading-logo">
            <LjLogo :size="48" />
          </div>
          <div class="loading-content">
            <div class="loading-title">
              Louvor
              <b>JA</b>
            </div>
            <div class="loading-message">
              <LjSpinner :size="14" :stroke-width="2" class="loading-spinner" />
              <span>{{ message }}</span>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import $appdata from "@/helpers/AppData";
import LjLogo from "@/components/LjLogo.vue";
import { LjSpinner } from "@/components/ui";

const { t } = useI18n();

const show = computed(() => !!$appdata.get("loading"));
const message = computed(() => {
  const val = $appdata.get("loading");
  return typeof val === "string" ? val : t("alert.wait");
});
</script>

<style scoped>
.loading-overlay {
  position: fixed;
  inset: 0;
  z-index: var(--lj-z-dialog);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--lj-space-8);
  background: var(--lj-black-alpha-40);
}

.loading {
  width: 100%;
  max-width: 380px;
  display: flex;
  align-items: center;
  gap: var(--lj-space-5);
  padding: var(--lj-space-6) var(--lj-space-7);
  background: var(--lj-popup-bg);
  border-radius: var(--lj-radius-md);
  box-shadow: var(--lj-popup-shadow);
  font-family: var(--lj-font-shell);
}

.loading-logo {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.loading-content {
  flex: 1;
  min-width: 0;
}

.loading-title {
  font-size: var(--lj-text-xl);
  font-weight: var(--lj-weight-semibold);
  color: var(--lj-text);
  letter-spacing: 0.02em;
  line-height: 1;
}

.loading-title b {
  color: var(--lj-orange, #efb400);
  font-weight: var(--lj-weight-bold);
}

.loading-message {
  display: flex;
  align-items: center;
  gap: var(--lj-space-4);
  font-size: var(--lj-text-base);
  color: var(--lj-text-muted);
  margin-top: 8px;
}

.loading-spinner {
  color: var(--lj-ui-accent);
}

.loading-enter-active,
.loading-leave-active {
  transition: opacity var(--lj-transition-normal);
}

.loading-enter-from,
.loading-leave-to {
  opacity: 0;
}
</style>
