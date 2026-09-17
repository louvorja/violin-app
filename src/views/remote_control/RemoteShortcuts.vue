<template>
  <div class="rsh-root">
    <!-- Navegação -->
    <div class="rsh-section">
      <span class="rsh-section__label">{{ t("remote_control.shortcuts.nav_group") }}</span>

      <div class="rsh-grid rsh-grid--arrows">
        <button type="button" class="rsh-btn" @click="send('Home')">
          <LjIcon :icon="ICONS.PLAYER.PAGE_FIRST" :size="16" />
        </button>
        <button type="button" class="rsh-btn" @click="send('ArrowUp')">
          <LjIcon :icon="ICONS.UI.CHEVRON_UP" :size="20" />
        </button>
        <button type="button" class="rsh-btn" @click="send('End')">
          <LjIcon :icon="ICONS.PLAYER.PAGE_LAST" :size="16" />
        </button>
        <button type="button" class="rsh-btn" @click="send('ArrowLeft')">
          <LjIcon :icon="ICONS.ACTIONS.PREVIOUS" :size="20" />
        </button>
        <button type="button" class="rsh-btn" @click="send('ArrowDown')">
          <LjIcon :icon="ICONS.UI.CHEVRON_DOWN" :size="20" />
        </button>
        <button type="button" class="rsh-btn" @click="send('ArrowRight')">
          <LjIcon :icon="ICONS.ACTIONS.NEXT" :size="20" />
        </button>
      </div>
    </div>

    <!-- Mídia -->
    <div class="rsh-section">
      <span class="rsh-section__label">{{ t("remote_control.shortcuts.media_group") }}</span>

      <button type="button" class="rsh-btn rsh-btn--primary rsh-btn--full" @click="send('Space')">
        <LjIcon :icon="ICONS.PLAYER.PLAY" :size="18" />
        |
        <LjIcon :icon="ICONS.PLAYER.PAUSE" :size="18" />
        <span>{{ t("remote_control.shortcuts.play_pause") }}</span>
      </button>

      <button type="button" class="rsh-btn rsh-btn--danger rsh-btn--full" @click="closeAll">
        <LjIcon :icon="ICONS.PROJECTION.STOP" :size="18" />
        <span>{{ t("remote_control.shortcuts.close_projection") }}</span>
      </button>

      <div class="rsh-row">
        <button type="button" class="rsh-btn rsh-btn--wide" @click="send('ArrowLeft', ['control'])">
          <LjIcon :icon="ICONS.PLAYER.PREV" :size="16" />
          <span>{{ t("remote_control.shortcuts.prev_music") }}</span>
        </button>
        <button
          type="button"
          class="rsh-btn rsh-btn--wide"
          @click="send('ArrowRight', ['control'])"
        >
          <LjIcon :icon="ICONS.PLAYER.NEXT" :size="16" />
          <span>{{ t("remote_control.shortcuts.next_music") }}</span>
        </button>
      </div>
    </div>

    <!-- Geral -->
    <div class="rsh-section">
      <span class="rsh-section__label">{{ t("remote_control.shortcuts.general_group") }}</span>

      <div class="rsh-row rsh-row--spaced">
        <button type="button" class="rsh-btn rsh-btn--wide" @click="send('Escape')">
          <LjIcon :icon="ICONS.ACTIONS.CANCEL" :size="16" />
          <span>Esc</span>
        </button>
        <button type="button" class="rsh-btn rsh-btn--wide" @click="send('o', ['control'])">
          <LjIcon :icon="ICONS.MODULES.OVERLAY" :size="16" />
          <span>{{ t("remote_control.shortcuts.overlay") }}</span>
        </button>
        <button type="button" class="rsh-btn rsh-btn--wide" @click="send('p', ['control'])">
          <LjIcon :icon="ICONS.MODULES.BACKGROUND_PROJECTION" :size="16" />
          <span>{{ t("remote_control.shortcuts.background") }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { LjIcon } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { postApi } from "@/helpers/ApiClient";

const props = defineProps<{
  token?: string;
}>();

const emit = defineEmits<{
  (_e: "show-snackbar", _message: string, _type?: string): void;
}>();

const { t } = useI18n();

const COOLDOWN_MS = 200;
const lastClicks = ref(new Map<string, number>());

function send(key: string, modifiers?: string[]) {
  const now = Date.now();
  const cooldownKey = `${key}:${(modifiers || []).join(",")}`;
  if ((lastClicks.value.get(cooldownKey) ?? 0) + COOLDOWN_MS > now) return;
  lastClicks.value.set(cooldownKey, now);

  postApi("/api/keyboard", { key, modifiers: modifiers || [] }, props.token).catch(() =>
    emit("show-snackbar", t("remote_control.errors.generic"), "error")
  );
}

function closeAll() {
  postApi("/api/projections/close", {}, props.token).catch(() =>
    emit("show-snackbar", t("remote_control.errors.generic"), "error")
  );
}
</script>

<style scoped>
.rsh-root {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-6);
  padding: var(--lj-space-4);
}

.rsh-section {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-3);
}

.rsh-section__label {
  font-size: var(--lj-text-xs);
  font-weight: var(--lj-weight-medium);
  color: var(--lj-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.rsh-grid--arrows {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--lj-space-3);
}

.rsh-row {
  display: flex;
  gap: var(--lj-space-3);
}

.rsh-row--spaced {
  gap: var(--lj-space-2);
}

.rsh-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--lj-space-2);
  min-height: 56px;
  padding: var(--lj-space-3) var(--lj-space-4);
  background: var(--lj-surface-bg);
  border: var(--lj-ui-border);
  border-radius: var(--lj-ui-radius);
  color: var(--lj-text);
  font: inherit;
  font-size: var(--lj-text-sm);
  font-weight: var(--lj-weight-medium);
  cursor: pointer;
  transition:
    transform 80ms,
    background 150ms;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
}

.rsh-btn:active {
  transform: scale(0.95);
  background: var(--lj-surface-bg-active);
}

.rsh-btn:focus-visible {
  outline: none;
  box-shadow: var(--lj-ui-focus);
}

.rsh-btn--wide {
  flex: 1;
}

.rsh-btn--full {
  width: 100%;
}

.rsh-btn--primary {
  background: var(--lj-ui-accent);
  border-color: var(--lj-ui-accent);
  color: var(--lj-ui-accent-fg);
}

.rsh-btn--primary:active {
  background: var(--lj-ui-accent-press);
  border-color: var(--lj-ui-accent-press);
}

.rsh-btn--danger {
  background: var(--lj-danger-soft);
  border-color: var(--lj-danger-border);
  color: var(--lj-danger);
}

.rsh-btn--danger:active {
  background: var(--lj-danger);
  border-color: var(--lj-danger);
  color: #fff;
}
</style>
