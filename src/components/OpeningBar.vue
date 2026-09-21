<template>
  <Transition name="opening">
    <div v-if="visible" class="opening" role="status" aria-live="polite">
      <LjSpinner :size="16" />
      <span class="opening__text lj-u-truncate">
        {{ $t("shell.opening") }}: {{ opening?.title }}
      </span>
      <button
        type="button"
        class="opening__cancel"
        :aria-label="$t('shell.opening_cancel')"
        :title="$t('shell.opening_cancel')"
        @click="Media.cancelOpening()"
      >
        <LjIcon :icon="ICONS.ACTIONS.CLOSE" :size="14" />
      </button>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { LjIcon, LjSpinner } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import Media from "@/composables/useMedia";
import $appdata from "@/helpers/AppData";

/**
 * "Abrindo: <vídeo>" no instante do clique. Um vídeo que ainda não foi baixado leva uns 5 s
 * até o yt-dlp resolver os links, e até lá nada mais muda na tela: parecia que o clique não
 * tinha feito nada.
 */
const opening = computed(() => Media.opening());
// Um aviso na tela já explica o que acontece (o preparo do download, por exemplo): não empilha por cima.
const toastShown = computed(() => $appdata.get<boolean>("snackbar.show", false) === true);
const visible = computed(() => !!opening.value && !toastShown.value);
</script>

<style scoped>
.opening {
  position: fixed;
  left: 50%;
  bottom: calc(var(--lj-dock-offset, 0px) + var(--lj-space-7));
  transform: translateX(-50%);
  z-index: var(--lj-z-toast);
  display: flex;
  align-items: center;
  gap: var(--lj-space-4);
  max-width: min(560px, 90vw);
  padding: var(--lj-space-3) var(--lj-space-3) var(--lj-space-3) var(--lj-space-5);
  background: var(--lj-tabs-bg);
  color: var(--lj-text-on-navy);
  border: 1px solid var(--lj-footer-border);
  border-radius: var(--lj-radius-pill);
  box-shadow: var(--lj-shadow-2);
  font-family: var(--lj-font-shell);
  font-size: var(--lj-text-sm);
  font-weight: var(--lj-weight-medium);
}

.opening__text {
  letter-spacing: 0.02em;
}

.opening__cancel {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  background: transparent;
  border: 0;
  border-radius: var(--lj-radius-pill);
  color: inherit;
  cursor: pointer;
  opacity: 0.8;
}

.opening__cancel:hover {
  opacity: 1;
  background: rgba(255, 255, 255, 0.14);
}

.opening__cancel:focus-visible {
  outline: 2px solid var(--lj-ui-focus, currentColor);
  outline-offset: 1px;
}

.opening-enter-active,
.opening-leave-active {
  transition:
    opacity var(--lj-transition-fast),
    transform var(--lj-transition-fast);
}

.opening-enter-from,
.opening-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(8px);
}
</style>
