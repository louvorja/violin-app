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
    <div v-else ref="scroller" class="liturgy-tl-scroll" @scroll.passive="rememberScroll">
      <draggable
        :model-value="items"
        :item-key="(item: LiturgyItem) => item.id"
        :disabled="locked"
        handle="[data-handle='true']"
        :delay="300"
        :delay-on-touch-only="true"
        :touch-start-threshold="10"
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
                <span class="tl-bloco-name">{{ element.item || t("placeholders.bloco") }}</span>
                <LjButton
                  v-if="!locked"
                  size="sm"
                  variant="ghost"
                  icon-only
                  class="tl-bloco-action"
                  :icon="ICONS.ACTIONS.EDIT"
                  :title="t('actions.edit')"
                  :aria-label="t('actions.edit')"
                  @click.stop="openItemDialog(index)"
                />
              </span>
              <span class="tl-bloco-line" />
              <!--
                Recolher/expandir no CANTO direito da faixa, e sempre visível:
                dentro do texto ele ficava escondido atrás do hover, e no toque
                (sem hover) não existia. O `click.stop` protege o arraste, já
                que a faixa inteira é o punho.
              -->
              <LjButton
                size="sm"
                variant="ghost"
                icon-only
                class="tl-bloco-action tl-bloco-collapse"
                :icon="
                  collapsedBlocos.has(element.id) ? ICONS.UI.CHEVRON_DOWN : ICONS.UI.CHEVRON_UP
                "
                :aria-expanded="!collapsedBlocos.has(element.id)"
                :aria-label="
                  collapsedBlocos.has(element.id) ? t('actions.expand') : t('actions.collapse')
                "
                :title="
                  collapsedBlocos.has(element.id) ? t('actions.expand') : t('actions.collapse')
                "
                @click.stop="toggleBlocoCollapse(element.id)"
              />
            </div>

            <template v-else>
              <!--
                Tempo e cartão recolhem JUNTOS: `grid-template-rows` vai de `1fr`
                para `0fr`, o que anima a altura real sem ninguém medi-la. Antes o
                cartão só ganhava `height: 0` por classe e sumia de um quadro para
                o outro, enquanto o tempo já tinha a sua própria transição.
                `inert` tira itens ocultos da ordem de Tab e da árvore de acessibilidade.
              -->
              <div
                class="tl-collapse"
                :class="{
                  'tl-collapse--closed': element.blocoId && collapsedBlocos.has(element.blocoId),
                }"
                :inert="Boolean(element.blocoId && collapsedBlocos.has(element.blocoId))"
              >
                <div class="tl-collapse-inner">
                  <div v-if="hasAnyTime" class="tl-meta-collapse">
                    <div class="tl-item-meta">
                      <span v-if="hasTopConnector(index)" class="tl-line tl-line--top" />
                      <div v-if="element.time" class="tl-time">{{ element.time }}</div>
                      <span v-if="hasBottomConnector(index)" class="tl-line tl-line--bottom" />
                    </div>
                  </div>
                  <div class="tl-card">
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
                </div>
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
import { useCollapsedBlocos } from "../composables/useCollapsedBlocos";
import { setScrollPosition, restoreScrollPosition } from "@/helpers/ScrollMemory";
import { LjButton, LjEmpty } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { computed, nextTick, onActivated, onMounted, ref } from "vue";
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
const { collapsedBlocos, toggleBlocoCollapse } = useCollapsedBlocos();

const scroller = ref<HTMLElement | null>(null);

function rememberScroll() {
  if (scroller.value) setScrollPosition("liturgy:timeline", scroller.value.scrollTop);
}

function restoreScroll() {
  void nextTick(() => {
    // Na reativação o `mounted` roda com a subárvore ainda destacada; o
    // `onActivated` dispara depois da reinserção e é o que faz grudar.
    restoreScrollPosition(scroller.value, "liturgy:timeline");
  });
}

onMounted(restoreScroll);
onActivated(restoreScroll);

function getBlocoColor(blocoId: string): string {
  const bloco = props.items.find((i) => i.tipo === LiturgyItemTypeEnum.BLOCO && i.id === blocoId);
  return bloco?.cor || props.defaultColor;
}

const hasAnyTime = computed(() =>
  props.items.some((i) => i.tipo !== LiturgyItemTypeEnum.BLOCO && Boolean(i.time))
);

function sameTimelineSection(a: LiturgyItem | undefined, b: LiturgyItem | undefined): boolean {
  if (!a || !b) return false;
  if (a.tipo === LiturgyItemTypeEnum.BLOCO || b.tipo === LiturgyItemTypeEnum.BLOCO) return false;
  if ((a.blocoId || "") !== (b.blocoId || "")) return false;
  return true;
}

function hasBottomConnector(index: number): boolean {
  const current = props.items[index];
  const next = props.items[index + 1];
  if (!sameTimelineSection(current, next)) return false;

  let hasAtOrBefore = Boolean(current.time);
  for (let i = index - 1; !hasAtOrBefore && i >= 0; i--) {
    if (!sameTimelineSection(current, props.items[i])) break;
    if (props.items[i].time) hasAtOrBefore = true;
  }
  if (!hasAtOrBefore) return false;

  for (let i = index + 1; i < props.items.length; i++) {
    if (!sameTimelineSection(current, props.items[i])) break;
    if (props.items[i].time) return true;
  }
  return false;
}

function hasTopConnector(index: number): boolean {
  return index > 0 && hasBottomConnector(index - 1);
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
  background: var(--lj-surface-bg-soft);
}
.liturgy-tl-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: var(--lj-space-4) 0 var(--lj-space-6);
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

/* ── Item nested inside a Bloco ──
 *  Pertencer ao bloco é dito pela faixa tonal na cor dele, que cobre a linha
 *   inteira. Um recuo por cima disso desalinharia a coluna dos cartões: o item
 *   solto, que não tem faixa, ficaria 12px à esquerda de todos os outros.
*/
.tl-item--in-bloco {
  padding: var(--lj-space-1) 0;
  background: color-mix(in oklab, var(--bloco-color, var(--lj-surface-border)) 7%, transparent);
  /* Layout (padding/margin) usa o par curto de reflow. */
  transition:
    padding var(--lj-reflow-enter),
    margin var(--lj-reflow-enter);
}
.tl-item.tl-item--in-bloco.tl-item--bloco-collapsed {
  padding: 0;
  border-left: 0;
  margin-top: 0;
  margin-bottom: 0;
  transition:
    padding var(--lj-reflow-exit),
    margin var(--lj-reflow-exit);
}

/* ── Timeline meta (time + line) ── */
.tl-meta-collapse {
  display: grid;
  grid-template-rows: 1fr;
  align-self: stretch;
  width: 60px;
  flex-shrink: 0;
  z-index: 1;
}
.tl-item-meta {
  display: grid;
  grid-template-rows: 1fr auto 1fr;
  align-items: stretch;
  justify-items: center;
  min-height: 0;
  overflow: hidden;
  padding: 0;
}
/* Recolher/expandir o conteúdo do item: `0fr` → `1fr` anima a altura real via reflow. */
.tl-collapse {
  flex: 1;
  min-width: 0;
  display: grid;
  grid-template-rows: 1fr;
  transition:
    grid-template-rows var(--lj-reflow-enter),
    opacity var(--lj-transition-normal);
}
.tl-collapse--closed {
  grid-template-rows: 0fr;
  opacity: 0;
  pointer-events: none;
  transition:
    grid-template-rows var(--lj-reflow-exit),
    opacity var(--lj-exit-fast);
}
.tl-collapse-inner {
  display: flex;
  align-items: stretch;
  gap: 0;
  min-height: 0;
  overflow: hidden;
}
.tl-time {
  grid-row: 2;
  font-size: var(--lj-text-sm);
  font-weight: var(--lj-weight-semibold);
  font-variant-numeric: tabular-nums;
  color: var(--lj-ui-accent-text);
  text-align: center;
  padding: var(--lj-space-2) var(--lj-space-1);
  line-height: 1;
}
.tl-line {
  width: 2px;
  height: 100%;
  background: var(--lj-surface-border-strong);
  opacity: 0.45;
}
.tl-line--top {
  grid-row: 1;
}
.tl-line--bottom {
  grid-row: 3;
}
.tl-item--checked .tl-time {
  text-decoration: line-through;
  opacity: 0.55;
}

/* ── Card ── */
.tl-card {
  flex: 1;
  min-width: 0;
  padding: var(--lj-space-2) var(--lj-space-4);
}

/* ── Bloco (divider style) ── */
.tl-bloco {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--lj-space-4);
  margin: var(--lj-space-6) 0 var(--lj-space-2);
  padding: var(--lj-space-3) calc(var(--lj-space-5) + var(--lj-ui-h-sm)) var(--lj-space-3)
    var(--lj-space-5);
  cursor: grab;
  touch-action: pan-y;
  user-select: none;
  background: color-mix(in oklab, var(--cat-color, var(--lj-divider)) 10%, var(--lj-surface-bg));
  border: 1px solid color-mix(in oklab, var(--cat-color, var(--lj-surface-border)) 22%, transparent);
  border-radius: var(--lj-radius-md);
}
.liturgy-tl-area--locked .tl-bloco {
  cursor: default;
}
.tl-bloco:active {
  cursor: grabbing;
}
.liturgy-tl-area--locked .tl-bloco:active {
  cursor: default;
}
.tl-bloco-line {
  flex: 1;
  min-width: var(--lj-space-4);
  height: 2px;
  background: var(--cat-color, var(--lj-divider));
  opacity: 0.5;
}
.tl-bloco-text {
  display: flex;
  align-items: center;
  gap: var(--lj-space-3);
  min-width: 0;
  max-width: 100%;
  font-size: var(--lj-text-md);
  font-weight: var(--lj-weight-bold);
  color: var(--cat-color, var(--lj-text));
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.tl-bloco-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tl-bloco-time {
  font-size: var(--lj-text-sm);
  font-weight: var(--lj-weight-semibold);
  font-variant-numeric: tabular-nums;
  color: var(--lj-ui-accent-text);
  background: var(--lj-ui-accent-soft);
  padding: var(--lj-space-1) var(--lj-space-3);
  border-radius: var(--lj-radius-sm);
  text-transform: none;
  letter-spacing: 0;
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
}
.tl-bloco-action {
  opacity: 0;
  transition:
    opacity var(--lj-transition-fast),
    background-color var(--lj-transition-fast);
  border: none;
  background: transparent;
  cursor: pointer;
  color: var(--cat-color, var(--lj-text));
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 24px;
  min-height: 24px;
  border-radius: var(--lj-radius-xs);
  flex-shrink: 0;
}

.tl-bloco-action:focus-visible {
  opacity: 1;
  outline: none;
  box-shadow: var(--lj-ui-focus);
}

/*
 * Recolher fica fora do "só no hover": é ação de rotina, e no celular não
 * existe hover. A regra composta vence o `opacity: 0` de `.tl-bloco-action`.
 */
.tl-bloco-action.tl-bloco-collapse {
  position: absolute;
  right: var(--lj-space-3);
  top: 50%;
  transform: translateY(-50%);
  opacity: 0.7;
}
.tl-bloco-action.tl-bloco-collapse:hover,
.tl-bloco-action.tl-bloco-collapse:focus-visible {
  opacity: 1;
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
.tl-item.tl-item--dragging-with-bloco {
  height: 0;
  overflow: hidden;
  opacity: 0;
  margin: 0;
  padding: 0;
  border: 0;
}

/* ── Bloco collapse ── */
.tl-bloco--collapsed {
  margin-bottom: var(--lj-space-4);
}

@media (max-width: 600px) {
  .liturgy-tl-list {
    padding: 0 var(--lj-space-2);
  }

  .tl-meta-collapse {
    width: 44px;
  }

  .tl-time {
    font-size: var(--lj-text-sm);
  }

  .tl-card {
    padding: var(--lj-space-2) var(--lj-space-2);
  }

  .tl-bloco {
    gap: var(--lj-space-2);
    padding: var(--lj-space-3) 48px var(--lj-space-3) var(--lj-space-3);
  }

  .tl-bloco-action {
    opacity: 0.85;
    min-width: 36px;
    min-height: 36px;
  }

  .tl-bloco-action.tl-bloco-collapse {
    min-width: 44px;
    min-height: 44px;
    right: var(--lj-space-1);
  }
}
</style>

<style>
html[data-theme="dark"] .tl-bloco {
  background: color-mix(in oklab, var(--cat-color, var(--lj-divider)) 20%, var(--lj-surface-bg));
  border-color: color-mix(in oklab, var(--cat-color, var(--lj-surface-border)) 35%, transparent);
}
html[data-theme="dark"] .tl-bloco-text,
html[data-theme="dark"] .tl-bloco-action {
  color: color-mix(in oklab, var(--cat-color, var(--lj-text)) 42%, var(--lj-white));
}
html[data-theme="dark"] .tl-bloco-line {
  background: color-mix(in oklab, var(--cat-color, var(--lj-divider)) 50%, var(--lj-white));
}
</style>
