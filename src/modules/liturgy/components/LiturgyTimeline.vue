<template>
  <div class="liturgy-tl-area" :class="{ 'liturgy-tl-area--locked': locked }">
    <div v-if="items.length === 0" class="liturgy-tl-empty">
      <LjEmpty
        :icon="ICONS.LITURGY.SCRIPT"
        :title="t('data.empty')"
        :description="t('data.empty_hint')"
      >
        <LjButton
          v-if="!locked"
          variant="primary"
          :icon="ICONS.ACTIONS.ADD"
          data-testid="liturgy-add-item"
          @click="openItemDialog()"
        >
          {{ t("actions.add") }}
        </LjButton>
      </LjEmpty>
    </div>
    <div v-else class="liturgy-tl-scroll">
      <draggable
        :model-value="items"
        :item-key="(item: LiturgyItem) => item.id"
        :disabled="locked"
        handle="[data-handle='true']"
        tag="div"
        class="liturgy-tl-list"
        :animation="150"
        ghost-class="tl-card--ghost"
        @start="onDragStart"
        @end="onDragEnd"
        @move="onDragMove"
        @update:model-value="onReorder"
        @change="onDragChange"
      >
        <template #item="{ element, index }">
          <div
            :class="[
              element.tipo === LiturgyItemTypeEnum.BLOCO ? 'tl-item-bloco' : 'tl-item',
              {
                'tl-item--checked':
                  element.tipo !== LiturgyItemTypeEnum.BLOCO && isChecked(element),
                'tl-item--in-bloco': element.blocoId,
                'tl-item--bloco-collapsed': element.blocoId && collapsedBlocos.has(element.blocoId),
                'tl-item--dragging-with-bloco':
                  draggingBlocoId && element.blocoId === draggingBlocoId,
              },
            ]"
            :data-item-id="element.id"
            :style="element.blocoId ? { '--bloco-color': getBlocoColor(element.blocoId) } : {}"
          >
            <!--            // Item BLoco-->
            <div
              v-if="element.tipo === LiturgyItemTypeEnum.BLOCO"
              class="tl-bloco"
              :class="{ 'tl-bloco--collapsed': collapsedBlocos.has(element.id) }"
              :style="{ '--cat-color': element.cor || defaultColor }"
              data-handle="true"
            >
              <span class="tl-bloco-line" />
              <span class="tl-bloco-text">
                <span v-if="element.time" class="tl-bloco-time">{{ element.time }}</span>
                {{ element.item || t("placeholders.bloco") }}
                <button
                  v-if="!locked"
                  class="tl-bloco-action"
                  :title="t('actions.edit')"
                  @click.stop="openItemDialog(index)"
                >
                  <LjIcon :icon="ICONS.ACTIONS.EDIT" size="14" />
                </button>
                <button
                  class="tl-bloco-action tl-bloco-collapse"
                  :title="
                    collapsedBlocos.has(element.id) ? t('actions.expand') : t('actions.collapse')
                  "
                  @click.stop="toggleBlocoCollapse(element.id)"
                >
                  <LjIcon
                    :icon="
                      collapsedBlocos.has(element.id) ? ICONS.UI.CHEVRON_DOWN : ICONS.UI.CHEVRON_UP
                    "
                    size="16"
                  />
                </button>
              </span>
              <span class="tl-bloco-line" />
            </div>

            <template v-else>
              <Transition name="tl-meta">
                <div
                  v-if="!element.blocoId || !collapsedBlocos.has(element.blocoId)"
                  class="tl-meta-collapse"
                >
                  <div class="tl-item-meta">
                    <div v-if="element.time" class="tl-time">{{ element.time }}</div>
                    <div class="tl-line" />
                  </div>
                </div>
              </Transition>
              <div
                class="tl-card"
                :class="{
                  'tl-card--hidden': element.blocoId && collapsedBlocos.has(element.blocoId),
                }"
              >
                <LiturgyItemComponent
                  :element="element"
                  :index="index"
                  :locked="locked"
                  :default-color="defaultColor"
                  :checked="isChecked(element)"
                  :subtitle-for="subtitleFor"
                  :overlay-slots="overlaySlots"
                  @edit="openItemDialog"
                  @clone="cloneItem"
                  @confirm-remove="confirmRemove"
                  @execute="executeItem"
                  @play-music="playMusic"
                  @open-lyric="openLyric"
                  @change-color="changeColor"
                  @toggle-checked="toggleChecked"
                />
              </div>
            </template>
          </div>
        </template>
      </draggable>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useLiturgyI18n } from "../i18n";
import { LjButton, LjEmpty, LjIcon } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { ref } from "vue";
import draggable from "vuedraggable";
import LiturgyItemComponent from "./LiturgyItem.vue";
import type { LiturgyItem } from "@/types/Liturgy";
import type { OverlaySlot } from "@/types/Overlay";
import { LiturgyItemTypeEnum } from "@/enums/LiturgyItemTypeEnum";

const props = withDefaults(
  defineProps<{
    items: LiturgyItem[];
    locked?: boolean;
    defaultColor?: string;
    totalDuration?: number;
    isChecked: (item: LiturgyItem) => boolean;
    subtitleFor: (item: LiturgyItem) => string;
    overlaySlots?: OverlaySlot[];
    onReorder: (items: LiturgyItem[]) => void;
    onBlocoAssign?: (itemId: string) => void;
    openItemDialog: (index?: number) => void;
    cloneItem: (index: number) => void;
    confirmRemove: (index?: number) => void;
    executeItem: (item: LiturgyItem) => void;
    playMusic: (item: LiturgyItem, mode: string) => void;
    openLyric: (musica: number) => void;
    changeColor: (index: number) => void;
    toggleChecked: (element: LiturgyItem) => void;
  }>(),
  {
    locked: false,
    defaultColor: "#00004F",
    totalDuration: 0,
    overlaySlots: () => [],
  }
);

const { t } = useLiturgyI18n();

const draggingBlocoId = ref<string | null>(null);
const collapsedBlocos = ref(new Set<string>());

function toggleBlocoCollapse(blocoId: string) {
  const s = collapsedBlocos.value;
  if (s.has(blocoId)) s.delete(blocoId);
  else s.add(blocoId);
  collapsedBlocos.value = new Set(s);
}

function getBlocoColor(blocoId: string): string {
  const bloco = props.items.find((i) => i.tipo === LiturgyItemTypeEnum.BLOCO && i.id === blocoId);
  return bloco?.cor || props.defaultColor;
}

function onDragStart(evt: { item: HTMLElement; oldIndex: number }) {
  const element = props.items[evt.oldIndex];
  if (!element || element.tipo !== LiturgyItemTypeEnum.BLOCO) return;
  draggingBlocoId.value = element.id;
}

function onDragEnd() {
  draggingBlocoId.value = null;
}

function onDragChange(evt: {
  moved?: { element: LiturgyItem; oldIndex: number; newIndex: number };
}) {
  const item = evt.moved?.element;
  if (item?.id) props.onBlocoAssign?.(item.id);
}

function onDragMove(evt: Record<string, unknown>): boolean | void {
  const el: HTMLElement | null = (evt.dragged || evt.item) as HTMLElement | null;
  const rel: HTMLElement | null = evt.related as HTMLElement | null;
  if (!el || !rel) return;

  const draggedId = el.getAttribute("data-item-id") || el.dataset?.itemId;
  const relatedId = rel.getAttribute("data-item-id") || rel.dataset?.itemId;
  if (!draggedId || !relatedId) return;

  const dragged = props.items.find((i) => i.id === draggedId);
  const related = props.items.find((i) => i.id === relatedId);
  if (!dragged || !related) return;

  if (dragged.tipo === LiturgyItemTypeEnum.BLOCO && related.blocoId) {
    return false;
  }
}
</script>

<style scoped>
.liturgy-tl-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
  min-height: 0;
}
.liturgy-tl-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: var(--lj-space-4) 0;
}

/* ── Estado vazio ── */
.liturgy-tl-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--lj-space-8);
}

/* ── Draggable list ── */
.liturgy-tl-list {
  display: flex;
  flex-direction: column;
  gap: 0;
  padding: 0 var(--lj-space-4);
}

/* ── Item wrapper ── */
.tl-item {
  display: flex;
  align-items: flex-start;
  gap: 0;
  position: relative;
}
.tl-item-bloco {
  position: relative;
}

/* ── Item nested inside a Bloco ── */
/* Pertencer ao bloco é dito pela faixa tonal na cor dele, que cobre a linha
   inteira. Um recuo por cima disso desalinharia a coluna dos cartões: o item
   solto, que não tem faixa, ficaria 12px à esquerda de todos os outros. */
.tl-item--in-bloco {
  padding: var(--lj-space-2) 0;
  background: color-mix(in srgb, var(--bloco-color, var(--lj-surface-border)) 6%, transparent);
}
.tl-item--bloco-collapsed {
  padding: 0 !important;
  border-left: 0 !important;
  margin-top: 0 !important;
  margin-bottom: 0 !important;
}

/* ── Timeline meta (time + dot + line) ── */
/* A altura só é animável a partir de uma linha de grade: `0fr` a `1fr` vai de
   zero à altura do conteúdo sem ninguém precisar medi-la. Por isso o invólucro
   existe — ele carrega a posição na linha do item, e o miolo continua sendo a
   coluna de tempo. */
.tl-meta-collapse {
  display: grid;
  grid-template-rows: 1fr;
  align-self: center;
  width: 64px;
  flex-shrink: 0;
  z-index: 1;
}
.tl-item-meta {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-height: 0;
  overflow: hidden;
}
.tl-meta-enter-active,
.tl-meta-leave-active {
  transition: grid-template-rows var(--lj-transition-normal);
}
.tl-meta-enter-from,
.tl-meta-leave-to {
  grid-template-rows: 0fr;
}
@media (prefers-reduced-motion: reduce) {
  .tl-meta-enter-active,
  .tl-meta-leave-active {
    transition: none;
  }
}
.tl-time {
  font-size: var(--lj-text-lg);
  font-weight: var(--lj-weight-bold);
  color: var(--lj-ui-accent-text);
  text-align: center;
  margin-bottom: var(--lj-space-2);
  line-height: 1;
}
.tl-line {
  width: 2px;
  flex: 1;
  background: var(--lj-divider);
  min-height: var(--lj-space-5);
}
.tl-item--checked .tl-time {
  text-decoration: line-through;
  opacity: 0.6;
}

/* ── Card ── */
.tl-card {
  flex: 1;
  min-width: 0;
  padding: var(--lj-space-2) var(--lj-space-5);
}

/* ── Bloco (divider style) ── */
.tl-bloco {
  display: flex;
  align-items: center;
  gap: var(--lj-space-5);
  margin: var(--lj-space-6) 0 var(--lj-space-2);
  padding: var(--lj-space-3) var(--lj-space-5);
  cursor: grab;
  user-select: none;
  background: color-mix(in srgb, var(--cat-color, var(--lj-divider)) 10%, transparent);
  border-radius: var(--lj-radius-lg);
}
.tl-bloco:active {
  cursor: grabbing;
}
.tl-bloco-line {
  flex: 1;
  height: 3px;
  background: var(--cat-color, var(--lj-divider));
  opacity: 0.7;
}
.tl-bloco-text {
  display: flex;
  align-items: center;
  gap: var(--lj-space-4);
  font-size: var(--lj-text-lg);
  font-weight: var(--lj-weight-bold);
  color: var(--cat-color, var(--lj-text));
  text-transform: uppercase;
  letter-spacing: 0.08em;
  white-space: nowrap;
}
.tl-bloco-time {
  font-size: var(--lj-text-md);
  font-weight: var(--lj-weight-semibold);
  color: var(--lj-ui-accent-text);
  background: var(--lj-ui-accent-soft);
  padding: var(--lj-space-1) var(--lj-space-4);
  border-radius: var(--lj-radius-sm);
  text-transform: none;
  letter-spacing: 0;
  display: inline-flex;
  align-items: center;
}
.tl-bloco-action {
  opacity: 0;
  transition: opacity var(--lj-transition-normal);
  border: none;
  background: transparent;
  cursor: pointer;
  color: var(--cat-color, var(--lj-text));
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--lj-ui-h-sm);
  height: var(--lj-ui-h-sm);
  border-radius: var(--lj-radius-xs);
  flex-shrink: 0;
}

.tl-bloco-action:focus-visible {
  opacity: 1;
  outline: none;
  box-shadow: var(--lj-ui-focus);
}
.tl-bloco:hover .tl-bloco-action {
  opacity: 1;
}
.tl-bloco-action:hover {
  background: rgba(var(--lj-on-surface-ch), 0.1);
}

/* ── Ghost ── */
.tl-card--ghost {
  opacity: 0.4;
}

/* ── Bloco drag ghost feedback ── */
.tl-item--dragging-with-bloco {
  height: 0 !important;
  overflow: hidden !important;
  opacity: 0 !important;
  margin: 0 !important;
  padding: 0 !important;
  border: 0 !important;
}

/* ── Bloco collapse ── */
.tl-card--hidden {
  opacity: 0;
  height: 0;
  overflow: hidden;
  padding: 0;
  margin: 0;
  pointer-events: none;
}
.tl-bloco--collapsed {
  margin-bottom: var(--lj-space-5);
}
</style>
