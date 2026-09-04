<template>
  <ModuleContainer
    ref="moduleContainer"
    :manifest="manifest"
    :style="{ minWidth: '360px' }"
    @close="close()"
  >
    <div class="mb-body">
      <ModuleFormatDrawer v-model="show_format" :module-id="'message_board'" :manifest="manifest" />

      <!-- Drawer direito — edição dos recados -->
      <Transition name="mb-drawer">
        <aside v-if="showList" class="mb-list-drawer">
          <div class="mb-list-drawer__header">
            <span class="mb-list-drawer__title">{{ t("data.list") }}</span>
          </div>

          <div class="mb-list-drawer__body">
            <LjTextarea
              v-model="draft"
              :placeholder="t('inputs.message')"
              :rows="3"
              @keydown.ctrl.enter.prevent="addMessage"
            />
            <div class="mb-list-drawer__actions">
              <LjButton
                size="sm"
                variant="primary"
                :icon="ICONS.ACTIONS.ADD"
                :disabled="!draft.trim()"
                @click="addMessage"
              >
                {{ t("actions.add") }}
              </LjButton>
              <LjChip v-if="showing" variant="success" size="sm" :icon="ICONS.UI.CHECK_CIRCLE">
                {{ t("data.showing") }}
              </LjChip>
            </div>
          </div>

          <LjDivider />

          <p v-if="messages.length === 0" class="mb-list-drawer__empty">
            {{ t("data.empty") }}
          </p>

          <ul v-else class="mb-list">
            <li
              v-for="(msg, i) in messages"
              :key="msg.id"
              class="mb-msg"
              :class="{ 'mb-msg--active': activeIndex === i }"
            >
              <button type="button" class="mb-msg__text" @click="present(i)">
                {{ msg.text }}
              </button>
              <div class="mb-msg__actions">
                <LjButton
                  size="sm"
                  variant="ghost"
                  icon-only
                  :icon="ICONS.PROJECTION.PRESENT"
                  :class="activeIndex === i ? 'mb-msg__present--on' : 'mb-msg__present'"
                  :title="t('actions.present')"
                  :aria-label="t('actions.present')"
                  @click.stop="present(i)"
                />
                <LjButton
                  size="sm"
                  variant="ghost"
                  icon-only
                  :icon="ICONS.ACTIONS.CLOSE"
                  class="mb-msg__remove"
                  :title="t('actions.remove')"
                  :aria-label="t('actions.remove')"
                  @click.stop="removeMessage(i)"
                />
              </div>
            </li>
          </ul>
        </aside>
      </Transition>

      <!-- Preview do recado selecionado -->
      <div ref="container" class="mb-preview-area" :style="rootStyle">
        <img v-if="bgImage" :src="bgImage" class="mb-bg-img" :style="imageStyle" alt="" />
        <div v-if="showing" class="mb-preview" :style="textStyle">
          {{ messages[activeIndex]?.text || "" }}
        </div>
        <div v-else class="mb-preview-hint">
          {{ t("data.empty") }}
        </div>
      </div>
    </div>

    <!-- Toolbar do preview (clear + fullscreen) -->
    <template #right>
      <div class="mb-tools">
        <LjButton
          v-if="showing"
          size="sm"
          variant="ghost"
          icon-only
          class="mb-tools__danger"
          :icon="ICONS.PLAYER.STOP"
          :title="t('actions.clear_board')"
          :aria-label="t('actions.clear_board')"
          @click="clearPresentation"
        />
        <LjButton
          size="sm"
          variant="ghost"
          icon-only
          :icon="ICONS.PLAYER.FULLSCREEN"
          :title="t('actions.fullscreen')"
          :aria-label="t('actions.fullscreen')"
          @click="fullscreen = true"
        />
      </div>
    </template>
  </ModuleContainer>

  <!-- Fullscreen overlay — não há primitivo de diálogo em tela cheia -->
  <Teleport to="body">
    <Transition name="mb-fade">
      <div
        v-if="fullscreen"
        ref="fsRoot"
        class="mb-fs-root"
        tabindex="0"
        :style="rootStyle"
        @keydown.esc="fullscreen = false"
        @keydown.space.prevent="showing ? clearPresentation() : null"
        @click="fullscreen = false"
      >
        <Transition name="fade-slide" mode="out-in">
          <div :key="fsText" class="mb-fs-text" :style="textStyle">{{ fsText || "" }}</div>
        </Transition>
        <div class="mb-fs-hint">{{ t("data.esc_hint") }}</div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted } from "vue";
import { module as manifest } from "../manifest";
import ModuleContainer from "@/components/ModuleContainer.vue";
import ModuleFormatDrawer from "@/components/ModuleFormatDrawer.vue";
import { LjButton, LjChip, LjDivider, LjTextarea } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import $broadcast from "@/helpers/Broadcast";
import UserData from "@/helpers/UserData";
import { useModuleProjection } from "@/composables/useModuleProjection";
import { useModuleFormat } from "@/composables/useModuleFormat";
import { useModuleBodyStyle } from "@/composables/useModuleBodyStyle";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";

const { show_format } = useModuleFormat("message_board", manifest);
const { rootStyle, textStyle, bgImage, imageStyle, container } =
  useModuleBodyStyle("message_board");

const projection = useModuleProjection("message_board", {
  onAction(action) {
    if (action === "clear") clearPresentation();
    else if (action === "toggle_list") showList.value = !showList.value;
    else if (action === "toggle_format") show_format.value = !show_format.value;
  },
});

function uid() {
  return Date.now() + Math.random();
}

const moduleContainer = ref(null);
const fsRoot = ref(null);
const showList = ref(false);
const draft = ref("");
const messages = ref([]);
const activeIndex = ref(-1);
const fullscreen = ref(false);
const fsText = ref("");

const showing = computed(() => activeIndex.value >= 0);

const t = (key) => moduleContainer.value?.t(key) || key;

watch(fullscreen, (val) => {
  if (val) {
    fsText.value = activeIndex.value >= 0 ? messages.value[activeIndex.value]?.text || "" : "";
    nextTick(() => fsRoot.value?.focus());
  }
});

onMounted(() => {
  messages.value = UserData.get("modules.message_board.messages", []);
});

function addMessage() {
  const text = draft.value.trim();
  if (!text) return;
  messages.value.push({ id: uid(), text });
  draft.value = "";
  UserData.set("modules.message_board.messages", messages.value);
}

function removeMessage(index) {
  if (activeIndex.value === index) clearPresentation();
  else if (activeIndex.value > index) activeIndex.value--;
  messages.value.splice(index, 1);
  UserData.set("modules.message_board.messages", messages.value);
}

function present(index) {
  activeIndex.value = index;
  const text = messages.value[index]?.text || "";
  fsText.value = text;
  $broadcast.send(BROADCAST_TYPE.MESSAGE_BOARD, { text, active: true });
  projection.emit({ text, active: true });
}

function clearPresentation() {
  activeIndex.value = -1;
  fsText.value = "";
  $broadcast.send(BROADCAST_TYPE.MESSAGE_BOARD, { text: "", active: false });
  projection.emit({ text: "", active: false });
}

function close() {
  clearPresentation();
}
</script>

<style scoped>
/* Corpo do módulo: preview ocupa a área toda e o drawer flutua à direita. */
.mb-body {
  position: relative;
  display: flex;
  height: 100%;
}

/* Preview centralizado */
.mb-preview-area {
  position: relative;
  flex-grow: 1;
  min-width: 0;
}
.mb-preview {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  padding: var(--lj-space-8);
  text-align: center;
  white-space: pre-wrap;
  word-break: break-word;
}
.mb-preview-hint {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  font-size: var(--lj-text-lg);
  opacity: 0.4;
}

/* Barra de ferramentas do cabeçalho do módulo */
.mb-tools {
  display: flex;
  align-items: center;
  gap: var(--lj-space-2);
}
.mb-tools :deep(.lj-btn.mb-tools__danger) {
  color: var(--lj-danger);
}

/* Drawer direito */
.mb-list-drawer {
  position: absolute;
  z-index: 2;
  top: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  width: 300px;
  border-left: 1px solid var(--lj-surface-border);
  background: var(--lj-surface-bg);
  overflow: clip;
}
.mb-list-drawer__header {
  display: flex;
  align-items: center;
  padding: var(--lj-space-2) var(--lj-space-4) var(--lj-space-2) var(--lj-space-5);
  border-bottom: 1px solid var(--lj-surface-border);
  background: var(--lj-surface-bg-soft);
}
.mb-list-drawer__title {
  font-size: var(--lj-text-sm);
  font-weight: var(--lj-weight-semibold);
  letter-spacing: 0.5px;
  text-transform: uppercase;
  color: var(--lj-text-muted);
}
.mb-list-drawer__body {
  padding: var(--lj-space-5);
}
.mb-list-drawer__actions {
  display: flex;
  align-items: center;
  gap: var(--lj-space-4);
  margin-top: var(--lj-space-4);
}
.mb-list-drawer__empty {
  margin: 0;
  padding: var(--lj-space-7);
  text-align: center;
  font-size: var(--lj-text-lg);
  color: var(--lj-text-subtle);
}

/* Lista de recados */
.mb-list {
  flex: 1;
  min-height: 0;
  margin: 0;
  padding: 0;
  list-style: none;
  overflow-y: auto;
}
.mb-msg {
  display: flex;
  align-items: center;
  gap: var(--lj-space-2);
  padding: var(--lj-space-2) var(--lj-space-4) var(--lj-space-2) var(--lj-space-5);
  border-bottom: 1px solid var(--lj-surface-divider);
  border-left: 3px solid transparent;
  cursor: pointer;
}
.mb-msg--active {
  background: var(--lj-ui-accent-soft);
  border-left-color: var(--lj-ui-accent);
}
.mb-msg__text {
  flex: 1;
  min-width: 0;
  padding: var(--lj-space-3) 0;
  border: none;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: var(--lj-text-lg);
  text-align: left;
  white-space: pre-wrap;
  word-break: break-word;
  cursor: pointer;
}
.mb-msg__text:focus-visible {
  outline: none;
  box-shadow: var(--lj-ui-focus);
}
.mb-msg__actions {
  display: flex;
  align-items: center;
  gap: var(--lj-space-1);
}
.mb-msg__actions :deep(.lj-btn.mb-msg__present) {
  color: var(--lj-ui-accent-text);
}
.mb-msg__actions :deep(.lj-btn.mb-msg__present--on) {
  color: var(--lj-success);
}
.mb-msg__actions :deep(.lj-btn.mb-msg__remove) {
  color: var(--lj-danger);
}

/* Background image */
.mb-bg-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 0;
  pointer-events: none;
}

/* Fullscreen */
.mb-fs-root {
  position: fixed;
  inset: 0;
  z-index: 2500;
  width: 100vw;
  height: 100vh;
  background: var(--lj-color-projection-bg);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px;
  outline: none;
  cursor: pointer;
}
.mb-fs-text {
  position: relative;
  z-index: 1;
  font-size: clamp(2rem, 6vw, 5rem);
  font-weight: var(--lj-weight-regular);
  color: var(--lj-white);
  text-align: center;
  white-space: pre-wrap;
  line-height: 1.4;
  text-shadow: 0 2px 12px var(--lj-black-alpha-75);
  max-width: 90vw;
}
.mb-fs-hint {
  position: absolute;
  bottom: var(--lj-space-6);
  font-size: var(--lj-text-base);
  color: var(--lj-white-alpha-20);
  letter-spacing: 0.1em;
}

/* Transições */
.mb-drawer-enter-active,
.mb-drawer-leave-active {
  transition: transform var(--lj-transition-slow);
}
.mb-drawer-enter-from,
.mb-drawer-leave-to {
  transform: translateX(100%);
}

.mb-fade-enter-active,
.mb-fade-leave-active {
  transition: opacity var(--lj-transition-slow);
}
.mb-fade-enter-from,
.mb-fade-leave-to {
  opacity: 0;
}

.fade-slide-enter-active {
  transition:
    opacity 0.3s,
    transform 0.3s;
}
.fade-slide-leave-active {
  transition: opacity 0.2s;
}
.fade-slide-enter-from {
  opacity: 0;
  transform: translateY(8px);
}
.fade-slide-leave-to {
  opacity: 0;
}
</style>
