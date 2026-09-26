<template>
  <ModuleContainer
    ref="moduleContainer"
    :manifest="manifest"
    :style="{ minWidth: '700px', minHeight: '400px' }"
  >
    <template #header>
      <LjSwitch
        :model-value="enabled"
        :label="tm('global_enabled')"
        @update:model-value="setEnabled"
      />
      <span class="lj-u-spacer" />
      <LjButton variant="primary" size="sm" :icon="ICONS.ACTIONS.ADD" @click="addSlot">
        {{ tm("add_slot") }}
      </LjButton>
    </template>

    <div class="overlay-root">
      <div class="overlay-body">
        <section class="overlay-preview-panel">
          <h3 class="overlay-panel-title">
            <LjIcon :icon="ICONS.UI.EYE_OUTLINE" :size="14" />
            <span>{{ tm("preview") }}</span>
            <span class="overlay-panel-note">16:9 · 1920 × 1080</span>
          </h3>

          <div ref="stageWrapRef" class="overlay-stage-wrap">
            <div class="overlay-stage" :style="stageStyle">
              <div
                v-for="slot in localSlots"
                :key="slot.id"
                class="overlay-preview-slot"
                :class="{ 'overlay-preview-slot--active': editingSlot?.id === slot.id }"
                :style="previewSlotStyle(slot)"
                @click="selectPreviewSlot(slot)"
              >
                <div
                  v-if="slot.type === 'text'"
                  class="overlay-preview-text"
                  :style="previewTextStyle(slot)"
                >
                  {{ slot.content || tm("slot.type_text") }}
                </div>
                <img
                  v-else-if="slot.type === 'image'"
                  :src="previewImageUrl(slot)"
                  :style="previewImageStyle(slot)"
                  class="overlay-preview-img"
                  alt=""
                />
                <div
                  v-else-if="slot.type === 'module_mirror'"
                  class="overlay-preview-text"
                  :style="previewTextStyle(slot)"
                >
                  {{ mirrorText(slot) }}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section class="overlay-list-panel">
          <div v-if="localSlots.length === 0" class="overlay-empty">
            <LjIcon :icon="ICONS.MODULES.OVERLAY" :size="40" />
            <p class="overlay-empty__title">{{ tm("empty") }}</p>
            <p class="overlay-empty__hint">{{ tm("empty_hint") }}</p>
          </div>

          <ul v-else class="overlay-slots">
            <li
              v-for="slot in localSlots"
              :key="slot.id"
              class="overlay-slot-card"
              :class="{ 'overlay-slot-card--active': editingSlot?.id === slot.id }"
            >
              <div class="overlay-slot-card-header">
                <LjSwitch
                  v-model="slot.enabled"
                  :title="tm('slot.enabled')"
                  @update:model-value="persist"
                />
                <span class="overlay-slot-name" :title="slot.name">{{ slot.name }}</span>
                <LjChip size="sm" class="overlay-slot-type">
                  {{ tm("slot.type_" + slot.type) }}
                </LjChip>
                <LjButton
                  variant="ghost"
                  size="sm"
                  icon-only
                  :icon="ICONS.ACTIONS.EDIT_OUTLINE"
                  :title="tm('slot.edit')"
                  :aria-label="tm('slot.edit')"
                  :aria-expanded="editingSlot?.id === slot.id"
                  @click="toggleEditing(slot)"
                />
                <LjButton
                  variant="ghost"
                  size="sm"
                  icon-only
                  :icon="ICONS.ACTIONS.DUPLICATE"
                  :title="tm('slot.duplicate')"
                  :aria-label="tm('slot.duplicate')"
                  @click="duplicateSlot(slot)"
                />
                <LjButton
                  variant="danger"
                  size="sm"
                  icon-only
                  :icon="ICONS.ACTIONS.DELETE"
                  :title="tm('slot.delete')"
                  :aria-label="tm('slot.delete')"
                  @click="confirmRemove(slot)"
                />
              </div>

              <div v-if="editingSlot?.id === slot.id" class="overlay-slot-editor">
                <OverlaySlotEditor :slot-data="slot" @change="onSlotChange" />
              </div>
            </li>
          </ul>
        </section>
      </div>
    </div>
  </ModuleContainer>
</template>

<script setup lang="ts">
import { LjButton, LjChip, LjIcon, LjSwitch } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { ref, reactive, computed, onMounted, onBeforeUnmount } from "vue";
import { useI18n } from "vue-i18n";
import { module as manifest } from "../manifest";
import ModuleContainer from "@/components/ModuleContainer.vue";
import OverlaySlotEditor from "./OverlaySlotEditor.vue";
import $broadcast from "@/helpers/Broadcast";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import $userdata from "@/helpers/UserData";
import $alert from "@/helpers/Alert";
import Strings from "@/helpers/Strings";
import { KEYS } from "@/constants/UserDataKeys";
import { getModuleTitle } from "@/config/modules";
import { useBroadcastListener } from "@/composables/useBroadcastListener";
import {
  getImage,
  resolveImageUrl,
  deleteImage,
  readAllSlots,
  writeSlot,
  deleteSlot,
} from "@/helpers/Overlay";
import {
  STAGE_UNITS,
  overlayImageStyle,
  overlaySlotStyle,
  overlayTextStyle,
} from "@/helpers/OverlayStyle";
import { OVERLAY_STYLE_DEFAULTS, createOverlaySlot, type OverlaySlot } from "@/types/Overlay";

const { t } = useI18n();
const moduleContainer = ref<{ tm(key: string, named?: Record<string, unknown>): string } | null>(
  null
);
const tm = (key: string, named?: Record<string, unknown>): string =>
  moduleContainer.value?.tm(key, named) || key;

// O interruptor global e o botão da ribbon leem a mesma preferência: ligar por
// um deles precisa refletir no outro sem cada um guardar a sua cópia.
const enabled = computed(
  () => $userdata.get<boolean>(KEYS.MODULES.OVERLAY.ENABLED, false) === true
);
const localSlots = reactive<OverlaySlot[]>([]);
const editingSlot = ref<OverlaySlot | null>(null);
const previewImageCache = reactive<Record<string, string>>({});
const moduleValues = reactive<Record<string, string>>({});

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let loadGeneration = 0;

function setEnabled(value: boolean): void {
  $userdata.set(KEYS.MODULES.OVERLAY.ENABLED, value);
  $broadcast.send(BROADCAST_TYPE.OVERLAY_CONFIG_CHANGED, { enabled: value });
}

async function load(): Promise<void> {
  const generation = ++loadGeneration;
  const slots = await readAllSlots();
  if (generation !== loadGeneration) return;
  localSlots.length = 0;
  for (const s of slots) {
    localSlots.push({ ...s, style: { ...OVERLAY_STYLE_DEFAULTS, ...(s.style || {}) } });
  }
}

function persist(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    for (const s of localSlots) {
      const plain = JSON.parse(JSON.stringify(s));
      await writeSlot(plain);
    }
    $broadcast.send(BROADCAST_TYPE.OVERLAY_CONFIG_CHANGED, {});
    saveTimer = null;
  }, 200);
}

function onSlotChange(updatedSlot: OverlaySlot): void {
  if (updatedSlot?.id) {
    const idx = localSlots.findIndex((s) => s.id === updatedSlot.id);
    if (idx !== -1) {
      if (updatedSlot.file_id !== localSlots[idx].file_id) {
        Object.keys(previewImageCache).forEach((key) => {
          if (key.startsWith(updatedSlot.id + "_")) delete previewImageCache[key];
        });
      }
      Object.assign(localSlots[idx], updatedSlot);
      if (updatedSlot.style) Object.assign(localSlots[idx].style!, updatedSlot.style);
    }
  }
  persist();
}

function addSlot(): void {
  const slot = createOverlaySlot();
  slot.name = tm("slot.default_name", { n: localSlots.length + 1 });
  slot.order = localSlots.length;
  localSlots.push(slot);
  editingSlot.value = slot;
  persist();
}

function toggleEditing(slot: OverlaySlot): void {
  editingSlot.value = editingSlot.value?.id === slot.id ? null : slot;
}

function selectPreviewSlot(slot: OverlaySlot): void {
  editingSlot.value = slot;
}

function duplicateSlot(original: OverlaySlot): void {
  const index = localSlots.findIndex((s) => s.id === original.id);
  if (index === -1) return;
  const copy = createOverlaySlot({
    ...JSON.parse(JSON.stringify(original)),
    id: undefined,
    name: `${original.name} ${tm("slot.copy_suffix")}`,
  });
  copy.order = localSlots.length;
  localSlots.splice(index + 1, 0, copy);
  editingSlot.value = copy;
  persist();
}

// As sobreposições nascem como "Sobreposição 1", "2"…: só o botão da linha não
// basta para o operador ver qual está prestes a sumir, então o nome vai na
// pergunta. O Alert renderiza com v-html, por isso o nome é escapado.
function confirmRemove(slot: OverlaySlot): void {
  $alert.yesno(
    {
      title: tm("slot.delete_confirm"),
      text: `<strong>${Strings.escapeHtml(slot.name)}</strong>`,
      translate: false,
    },
    (btn?: string) => {
      if (btn === "yes") void removeSlot(slot);
    }
  );
}

async function removeSlot(slot: OverlaySlot): Promise<void> {
  if (!localSlots.some((s) => s.id === slot.id)) return;
  // A imagem é da biblioteca e pode servir a outra sobreposição: ela só sai
  // junto com a última que a usa.
  const usedElsewhere = localSlots.some((s) => s.id !== slot.id && s.file_id === slot.file_id);
  if (slot.file_id && !usedElsewhere) {
    try {
      await deleteImage(slot.file_id);
    } catch {
      /* ignore */
    }
  }
  await deleteSlot(slot.id);
  // O índice é procurado só agora: a lista pode ter sido recarregada durante os
  // `await` acima, e o índice antigo apontaria para outro item.
  const index = localSlots.findIndex((s) => s.id === slot.id);
  if (index !== -1) localSlots.splice(index, 1);
  if (editingSlot.value?.id === slot.id) editingSlot.value = null;
  persist();
}

// ── Pré-visualização ──
// O palco é uma tela de 1920×1080 reduzida por `transform`, medida em unidades
// de container: fonte, espaçamento e deslocamento em px escalam juntos, como
// numa projeção Full HD, e o estilo vem do mesmo helper que a projeção usa.

const STAGE_WIDTH = 1920;
const stageWrapRef = ref<HTMLElement | null>(null);
const stageScale = ref(0.4);
const stageStyle = computed(() => ({
  transform: `scale(${stageScale.value})`,
  "--stage-scale": String(stageScale.value),
}));
let stageObserver: ResizeObserver | null = null;

function measureStage(): void {
  const width = stageWrapRef.value?.clientWidth ?? 0;
  if (width > 0) stageScale.value = width / STAGE_WIDTH;
}

function previewSlotStyle(slot: OverlaySlot): Record<string, string> {
  if (!slot.enabled) return { display: "none" };
  return { ...overlaySlotStyle(slot), pointerEvents: "auto", cursor: "pointer" };
}

function previewTextStyle(slot: OverlaySlot): Record<string, string> {
  return overlayTextStyle(slot, STAGE_UNITS);
}

function previewImageStyle(slot: OverlaySlot): Record<string, string> {
  return overlayImageStyle(slot, STAGE_UNITS);
}

function previewImageUrl(slot: OverlaySlot): string {
  if (!slot.file_id) return "";
  const cacheKey = `${slot.id}_${slot.file_id}`;
  if (previewImageCache[cacheKey]) return previewImageCache[cacheKey];
  getImage(slot.file_id).then((record) => {
    const url = resolveImageUrl(record);
    previewImageCache[cacheKey] = url;
  });
  return "";
}

function mirrorText(slot: OverlaySlot): string {
  const source = slot.source_module || "";
  if (moduleValues[source]) return moduleValues[source];
  return source ? t(getModuleTitle(source)) : "—";
}

// Ações da Ribbon
useBroadcastListener(BROADCAST_TYPE.MODULE_RIBBON_ACTION, (payload: unknown) => {
  const pl = payload as { module?: string; action?: string } | null;
  if (pl?.module !== "overlay") return;
  switch (pl.action) {
    case "add":
      addSlot();
      break;
  }
});

// Escuta valores de módulos fonte para preview ao vivo
useBroadcastListener(BROADCAST_TYPE.MODULE_PROJECTION_VALUE, (payload: unknown) => {
  const p = payload as { module?: string; text?: string; reference?: string } | null;
  if (p?.module) {
    moduleValues[p.module] = p.text || p.reference || "";
  }
});

// Atualiza localSlots quando overlay é alterado externamente (ex.: liturgia)
useBroadcastListener(BROADCAST_TYPE.OVERLAY_CONFIG_CHANGED, () => {
  void load();
});

onMounted(() => {
  load();
  measureStage();
  if (typeof ResizeObserver !== "undefined" && stageWrapRef.value) {
    stageObserver = new ResizeObserver(measureStage);
    stageObserver.observe(stageWrapRef.value);
  }
});

onBeforeUnmount(() => {
  stageObserver?.disconnect();
});
</script>

<style scoped>
.overlay-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  container-type: inline-size;
  container-name: overlay-module;
}

.overlay-body {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

/* ====================== Pré-visualização ====================== */
.overlay-preview-panel {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-4);
  flex: 1;
  min-width: 0;
  padding: var(--lj-space-6);
  overflow-y: auto;
}

.overlay-panel-title {
  display: flex;
  align-items: center;
  gap: var(--lj-space-3);
  margin: 0;
  color: var(--lj-text-muted);
  font-size: var(--lj-text-sm);
  font-weight: var(--lj-weight-medium);
}

.overlay-panel-note {
  margin-left: auto;
  color: var(--lj-text-subtle);
  font-weight: normal;
}

.overlay-stage-wrap {
  position: relative;
  flex-shrink: 0;
  width: 100%;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  background: #111;
  border-radius: var(--lj-radius-lg);
}

.overlay-stage {
  position: absolute;
  top: 0;
  left: 0;
  width: 1920px;
  height: 1080px;
  transform-origin: top left;
  container-type: size;
}

/* Mesmas regras de caixa do OverlayRenderer: sem elas o texto não quebra na
   mesma largura que na projeção. */
.overlay-preview-slot {
  box-sizing: border-box;
  overflow-wrap: break-word;
  word-wrap: break-word;
}

/* O palco está reduzido; o contorno é dividido pela escala para continuar com
   2px na tela. */
.overlay-preview-slot--active {
  outline: calc(2px / var(--stage-scale)) solid var(--lj-ui-accent);
  outline-offset: calc(-2px / var(--stage-scale));
}

.overlay-preview-text {
  white-space: pre-wrap;
  user-select: none;
}

.overlay-preview-img {
  display: block;
}

/* ====================== Lista ====================== */
.overlay-list-panel {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  width: 40%;
  min-width: 300px;
  max-width: 480px;
  padding: var(--lj-space-5);
  overflow-y: auto;
  border-left: 1px solid var(--lj-surface-divider);
}

.overlay-empty {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--lj-space-3);
  padding: var(--lj-space-8);
  color: var(--lj-text-subtle);
  text-align: center;
}

.overlay-empty p {
  margin: 0;
}

.overlay-empty__title {
  color: var(--lj-text-muted);
  font-size: var(--lj-text-base);
  font-weight: var(--lj-weight-medium);
}

.overlay-empty__hint {
  max-width: 260px;
  font-size: var(--lj-text-sm);
}

.overlay-slots {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-4);
  margin: 0;
  padding: 0;
  list-style: none;
}

.overlay-slot-card {
  border: 1px solid var(--lj-surface-border);
  border-radius: var(--lj-radius-lg);
  background: var(--lj-surface-bg-soft);
  transition: border-color var(--lj-transition-normal);
}

.overlay-slot-card--active {
  border-color: var(--lj-ui-accent);
}

.overlay-slot-card-header {
  display: flex;
  align-items: center;
  gap: var(--lj-space-3);
  padding: var(--lj-space-3) var(--lj-space-4);
  font-size: var(--lj-text-base);
}

.overlay-slot-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-weight: var(--lj-weight-medium);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.overlay-slot-type {
  flex-shrink: 0;
}

.overlay-slot-editor {
  padding: var(--lj-space-5);
  border-top: 1px solid var(--lj-surface-divider);
}

/* Lado a lado só quando a lista comporta a fileira de abas do editor (369px
   úteis; a 40% da largura, com a barra de rolagem do Windows, isso pede ~1090px
   de módulo). Abaixo disso — janela pequena, ou a tela de um projetor 1024×768
   espelhada — a pré-visualização vai para cima e a lista ocupa a largura toda,
   em vez de o editor estourar a moldura do cartão. */
@container overlay-module (max-width: 1089px) {
  .overlay-body {
    flex-direction: column;
    overflow-y: auto;
  }

  .overlay-preview-panel {
    flex: none;
    overflow: visible;
  }

  .overlay-stage-wrap {
    max-width: 420px;
  }

  .overlay-list-panel {
    flex: none;
    width: auto;
    min-width: 0;
    max-width: none;
    overflow: visible;
    border-top: 1px solid var(--lj-surface-divider);
    border-left: 0;
  }
}
</style>
