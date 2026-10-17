<template>
  <div class="rp-root">
    <!-- Mesmas teclas dos Atalhos (setas do slide), mas em botões grandes:
         alvo de toque confortável para quem está apresentando. -->
    <div class="rp-keys">
      <button
        type="button"
        class="rp-key"
        :aria-label="t('actions.next')"
        @click="send('ArrowRight')"
      >
        <LjIcon :icon="ICONS.ACTIONS.NEXT" :size="48" />
      </button>
      <button
        type="button"
        class="rp-key"
        :aria-label="t('actions.previous')"
        @click="send('ArrowLeft')"
      >
        <LjIcon :icon="ICONS.ACTIONS.PREVIOUS" :size="48" />
      </button>
    </div>

    <!-- Ancorado no rodapé: inicia o som padrão configurado no desktop. -->
    <div class="rp-footer">
      <button type="button" class="rp-start" :disabled="busy" @click="startBackgroundSound">
        <LjIcon :icon="ICONS.PLAYER.PLAY" :size="18" />
        <span>{{ t("remote_control.presenter.start_bg") }}</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { LjIcon } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { postApi } from "@/helpers/ApiClient";
import { httpErrorMessage } from "@/helpers/httpErrorMessage";

/**
 * Apresentador — dois botões grandes com as teclas da tela de Atalhos e o
 * início do som padrão ancorado no rodapé.
 *
 * O `play-default` é idempotente no desktop: já tocando → ok sem reiniciar;
 * sem som marcado como padrão → 404 com o motivo (mostrado no snackbar).
 */
const props = defineProps<{
  token?: string;
}>();

const emit = defineEmits<{
  (_e: "show-snackbar", _message: string, _type?: string): void;
}>();

const { t } = useI18n();

/** Mesmo cooldown de 200 ms da tela de Atalhos — evita disparo acidental. */
const COOLDOWN_MS = 200;
const lastSent = ref(0);
const busy = ref(false);

function send(key: "ArrowLeft" | "ArrowRight"): void {
  const now = Date.now();
  if (lastSent.value + COOLDOWN_MS > now) return;
  lastSent.value = now;

  postApi("/api/keyboard", { key, modifiers: [] }, props.token).catch(() =>
    emit("show-snackbar", t("remote_control.errors.generic"), "error")
  );
}

async function startBackgroundSound(): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  try {
    const res = await postApi("/api/background-sound", { action: "play-default" }, props.token);
    if (!res.ok) {
      emit(
        "show-snackbar",
        await httpErrorMessage(res, t("remote_control.errors.generic")),
        "error"
      );
      return;
    }
    emit("show-snackbar", t("remote_control.presenter.started"));
  } catch {
    emit("show-snackbar", t("remote_control.errors.generic"), "error");
  } finally {
    busy.value = false;
  }
}
</script>

<style scoped>
.rp-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  gap: var(--lj-space-4);
  padding: var(--lj-space-4);
}

.rp-keys {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-4);
}

.rp-key {
  flex: 1;
  min-height: 112px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--lj-surface-bg);
  border: var(--lj-ui-border);
  border-radius: var(--lj-ui-radius);
  color: var(--lj-text);
  cursor: pointer;
  transition:
    transform 80ms,
    background 150ms;
}

.rp-key:active {
  transform: scale(0.97);
  background: var(--lj-surface-bg-active);
}

.rp-key:focus-visible {
  outline: none;
  box-shadow: var(--lj-ui-focus);
}

.rp-footer {
  flex-shrink: 0;
  padding-top: var(--lj-space-4);
  border-top: 1px solid var(--lj-surface-border);
}

.rp-start {
  width: 100%;
  min-height: 56px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--lj-space-2);
  background: var(--lj-ui-accent);
  border: 1px solid var(--lj-ui-accent);
  border-radius: var(--lj-ui-radius);
  color: var(--lj-ui-accent-fg);
  font: inherit;
  font-weight: var(--lj-weight-medium);
  cursor: pointer;
}

.rp-start:disabled {
  opacity: 0.6;
  cursor: default;
}

.rp-start:focus-visible {
  outline: none;
  box-shadow: var(--lj-ui-focus);
}
</style>
