<template>
  <Transition name="chat-drawer-slide">
    <aside
      v-show="isOpen"
      class="chat-drawer-panel"
      :class="{ 'chat-drawer-panel--pinned': isPinned }"
    >
      <header class="chat-drawer-panel__header">
        <span class="chat-drawer-panel__title">{{ t("chat.title") }}</span>
        <div class="chat-drawer-panel__actions">
          <LjTooltip :text="t('chat.clear')" side="bottom">
            <button type="button" class="chat-drawer-panel__action" @click="confirmClear">
              <LjIcon :icon="ICONS.ACTIONS.DELETE" color="error" :size="14" />
            </button>
          </LjTooltip>

          <LjTooltip
            :text="autoOpenOnNew ? t('chat.auto_open_on') : t('chat.auto_open_off')"
            side="bottom"
          >
            <button
              type="button"
              class="chat-drawer-panel__action"
              :class="{ 'chat-drawer-panel__action--active': autoOpenOnNew }"
              @click="setAutoOpen(!autoOpenOnNew)"
            >
              <LjIcon :icon="autoOpenOnNew ? ICONS.UI.BELL : ICONS.UI.BELL_OFF" :size="14" />
            </button>
          </LjTooltip>
          <LjTooltip :text="isPinned ? t('chat.unpin') : t('chat.pin')" side="bottom">
            <button type="button" class="chat-drawer-panel__action" @click="togglePin">
              <LjIcon :icon="isPinned ? ICONS.UI.PIN_OFF : ICONS.UI.PIN" :size="14" />
            </button>
          </LjTooltip>

          <button type="button" class="chat-drawer-panel__action" @click="setOpen(false)">
            <LjIcon :icon="ICONS.ACTIONS.CLOSE" :size="14" />
          </button>
        </div>
      </header>

      <div class="chat-drawer-panel__body">
        <div ref="messagesContainer" class="chat-drawer__messages">
          <div v-if="messages.length === 0" class="chat-drawer__empty">
            <LjIcon :icon="ICONS.UI.MESSAGE_BULLETED" :size="32" />
            <span>{{ t("chat.empty") }}</span>
          </div>
          <div
            v-for="msg in messages"
            :key="msg.id"
            class="chat-drawer__msg"
            :class="{ 'chat-drawer__msg--local': !msg.deviceId }"
          >
            <span class="chat-drawer__sender">
              <LjIcon
                v-if="msg.deviceId && msg.platform === 'android'"
                :icon="ICONS.UI.ANDROID"
                :size="12"
                class="chat-drawer__platform-icon"
              />
              <LjIcon
                v-else-if="msg.deviceId && msg.platform === 'ios'"
                :icon="ICONS.UI.APPLE"
                :size="12"
                class="chat-drawer__platform-icon"
              />
              {{ msg.sender }}
            </span>
            <span class="chat-drawer__text">{{ msg.text }}</span>
            <span class="chat-drawer__time">{{ formatTime(msg.timestamp) }}</span>
          </div>
        </div>

        <div class="chat-drawer__input">
          <input
            ref="inputEl"
            v-model="newMessage"
            type="text"
            class="chat-drawer__field"
            :placeholder="t('chat.placeholder')"
            maxlength="2000"
            @keydown.enter="onSend"
          />
          <LjButton
            size="sm"
            :icon="ICONS.CHAT.SEND"
            :disabled="!newMessage.trim()"
            @click="onSend"
          >
            {{ t("chat.send") }}
          </LjButton>
        </div>
      </div>
    </aside>
  </Transition>
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from "vue";
import { useI18n } from "vue-i18n";
import { LjButton, LjIcon, LjTooltip } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { useChat } from "@/composables/useChat";
import $alert from "@/helpers/Alert";

const { t } = useI18n();
const {
  messages,
  isOpen,
  isPinned,
  autoOpenOnNew,
  sendMessage,
  setOpen,
  togglePin,
  setAutoOpen,
  clearHistory,
} = useChat();

const newMessage = ref("");
const messagesContainer = ref<HTMLDivElement | null>(null);
const inputEl = ref<HTMLInputElement | null>(null);

function formatTime(timestamp: string): string {
  const d = new Date(timestamp);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function onSend(): void {
  const text = newMessage.value.trim();
  if (!text) return;
  sendMessage(text);
  newMessage.value = "";
  inputEl.value?.focus();
}

function confirmClear(): void {
  $alert.yesno({ title: t("chat.title"), text: t("chat.confirm_clear") }, (btn?: string) => {
    if (btn === "yes") {
      clearHistory();
    }
  });
}

// Auto-scroll para baixo em nova mensagem
watch(
  () => messages.value.length,
  async () => {
    await nextTick();
    if (messagesContainer.value) {
      messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
    }
  }
);
</script>

<style scoped>
/* ---------------------------------------------------------------------------
 * Drawer — sempre position: absolute dentro de .shell-grid.
 * Não fixado: sobrepõe o conteúdo diretamente.
 * Fixado: sobrepõe a margem (margin-left) que o .shell-center cria.
 * A animação de fixar/desafixar é feita pelo margin-left no Shell.vue.
 * ------------------------------------------------------------------------- */
.chat-drawer-panel {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  z-index: 10;
  width: 300px;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--lj-surface-border);
  background: var(--lj-surface-bg);
  color: var(--lj-text);
  box-shadow: var(--lj-shadow-2);
  overflow: clip;
}

/* ---------------------------------------------------------------------------
 * Modo fixado — só muda visual (sem shadow). Posição sempre absolute.
 * O conteúdo é empurrado pelo margin-left no .shell-center (Shell.vue).
 * ------------------------------------------------------------------------- */
.chat-drawer-panel--pinned {
  box-shadow: none;
}

/* Header */
.chat-drawer-panel__header {
  display: flex;
  align-items: center;
  gap: var(--lj-space-2);
  padding: var(--lj-space-2) var(--lj-space-3) var(--lj-space-2) var(--lj-space-4);
  border-bottom: 1px solid var(--lj-surface-border);
  background: var(--lj-surface-bg-soft, #eee);
  flex: none;
}

.chat-drawer-panel__title {
  flex: 1;
  min-width: 0;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  color: var(--lj-text-muted, #666);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.chat-drawer-panel__actions {
  display: flex;
  align-items: center;
  gap: var(--lj-space-1);
}

.chat-drawer-panel__action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: var(--lj-radius-xs);
  color: var(--lj-text-muted);
  cursor: pointer;
}
.chat-drawer-panel__action:hover {
  background: var(--lj-surface-bg-hover);
  color: var(--lj-text);
}
.chat-drawer-panel__action--active {
  color: var(--lj-accent);
}

/* Body */
.chat-drawer-panel__body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

/* Messages */
.chat-drawer__messages {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.chat-drawer__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 8px;
  opacity: 0.5;
}

.chat-drawer__msg {
  display: flex;
  flex-direction: column;
  padding: 6px 10px;
  border-radius: 8px;
  background: var(--lj-surface-2);
  max-width: 85%;
}

.chat-drawer__msg--local {
  align-self: flex-end;
  background: var(--lj-accent-soft, var(--lj-surface-2));
}

.chat-drawer__sender {
  font-size: 11px;
  font-weight: 600;
  opacity: 0.7;
  margin-bottom: 2px;
  display: flex;
  align-items: center;
  gap: 3px;
}

.chat-drawer__platform-icon {
  opacity: 0.8;
  flex-shrink: 0;
}

.chat-drawer__text {
  font-size: 13px;
  word-break: break-word;
}

.chat-drawer__time {
  font-size: 10px;
  opacity: 0.5;
  align-self: flex-end;
  margin-top: 2px;
}

/* Input */
.chat-drawer__input {
  display: flex;
  gap: 6px;
  padding: 8px;
  border-top: 1px solid var(--lj-surface-border);
}

.chat-drawer__field {
  flex: 1;
  padding: 6px 10px;
  border: 1px solid var(--lj-surface-border);
  border-radius: 6px;
  background: var(--lj-surface);
  color: var(--lj-text);
  font-size: 13px;
  outline: none;
}

.chat-drawer__field:focus {
  border-color: var(--lj-accent);
}

/* ---------------------------------------------------------------------------
 * Transição — mesma duração do ModuleFormatDrawer (0.35s)
 * Só anima no modo overlay; no modo pinado o flex layout já cuida.
 * ------------------------------------------------------------------------- */
.chat-drawer-slide-enter-active,
.chat-drawer-slide-leave-active {
  transition: transform 0.5s var(--lj-ease);
}
.chat-drawer-slide-enter-from,
.chat-drawer-slide-leave-to {
  transform: translateX(-100%);
}

/* No modo pinado, repetimos a transição */
.chat-drawer-panel--pinned.chat-drawer-slide-enter-active,
.chat-drawer-panel--pinned.chat-drawer-slide-leave-active {
  transition: transform 0.5s var(--lj-ease);
}
.chat-drawer-panel--pinned.chat-drawer-slide-enter-from,
.chat-drawer-panel--pinned.chat-drawer-slide-leave-to {
  transform: translateX(-100%);
}

@media (prefers-reduced-motion: reduce) {
  .chat-drawer-slide-enter-active,
  .chat-drawer-slide-leave-active {
    transition: none;
  }
}
</style>
