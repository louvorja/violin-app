<template>
  <div class="pm-ovl" data-testid="pm-library-overlays">
    <header class="pm-ovl__head">
      <LjSwitch
        :model-value="enabled"
        :label="tm('library.overlays_enabled')"
        data-testid="pm-ovl-master"
        @update:model-value="setEnabled($event as boolean)"
      />
      <button
        type="button"
        class="pm-ovl__filter"
        :class="{ 'pm-ovl__filter--on': onlyActive }"
        :aria-pressed="onlyActive"
        :title="
          onlyActive ? tm('library.overlays_filter_all') : tm('library.overlays_filter_active')
        "
        :aria-label="
          onlyActive ? tm('library.overlays_filter_all') : tm('library.overlays_filter_active')
        "
        data-testid="pm-ovl-filter"
        @click="onlyActive = !onlyActive"
      >
        <LjIcon :icon="ICONS.ACTIONS.FILTER" :size="12" />
        {{ countLabel }}
      </button>
      <span class="pm-ovl__spacer" />
      <LjButton
        size="sm"
        variant="ghost"
        :icon="ICONS.UI.OPEN_IN_NEW"
        :title="tm('library.overlays_manage')"
        data-testid="pm-ovl-manage"
        @click="openModule"
      >
        {{ tm("library.overlays_manage") }}
      </LjButton>
    </header>

    <div class="pm-ovl__body">
      <p v-if="loading && !slots.length" class="pm-ovl__message">
        {{ tm("library.loading") }}
      </p>
      <div v-else-if="failed && !slots.length" class="pm-ovl__message">
        <p>{{ tm("library.overlays_load_error") }}</p>
        <LjButton size="sm" :icon="ICONS.ACTIONS.REFRESH" @click="refresh">
          {{ t("alert.retry") }}
        </LjButton>
      </div>
      <template v-else>
        <div v-if="failed" class="pm-ovl__banner">
          <span>{{ tm("library.overlays_load_error") }}</span>
          <LjButton size="sm" :icon="ICONS.ACTIONS.REFRESH" @click="refresh">
            {{ t("alert.retry") }}
          </LjButton>
        </div>
        <LjEmpty
          v-if="!slots.length"
          :icon="ICONS.MODULES.OVERLAY"
          :title="tm('library.overlays_empty')"
        >
          <LjButton size="sm" :icon="ICONS.ACTIONS.ADD" @click="openModule">
            {{ tm("library.overlays_empty_action") }}
          </LjButton>
        </LjEmpty>
        <div v-else-if="!visibleSlots.length" class="pm-ovl__message">
          <p>{{ tm("library.overlays_none_active") }}</p>
          <LjButton size="sm" :icon="ICONS.ACTIONS.FILTER" @click="onlyActive = false">
            {{ tm("library.overlays_filter_all") }}
          </LjButton>
        </div>
        <div v-else class="pm-ovl__grid">
          <LjContextMenu v-for="slot in visibleSlots" :key="slot.id" v-bind="menuFor(slot)">
            <div
              class="pm-ovl__card"
              :class="{ 'pm-ovl__card--active': isActive(slot) }"
              role="button"
              tabindex="0"
              :aria-pressed="isActive(slot)"
              :aria-label="slot.name"
              :data-testid="`pm-ovl-card-${slot.id}`"
              :title="slot.name"
              @click="onToggle(slot)"
              @keydown.enter.prevent="onKeyToggle($event, slot)"
              @keydown.space.prevent="onKeyToggle($event, slot)"
            >
              <OverlaySlotPreview
                :overlay="slot"
                :mirror-text="mirrorText(slot.source_module)"
                :mirror-color="mirrorColor(slot.source_module)"
                :placeholder="typeLabel(slot)"
              />
              <span class="pm-ovl__meta">
                <span class="pm-ovl__name">{{ slot.name }}</span>
                <span class="pm-ovl__type">{{ typeLabel(slot) }}</span>
              </span>
              <span v-if="isActive(slot)" class="pm-ovl__live">
                {{ tm("library.on_air") }}
              </span>
              <span v-else-if="!enabled && slot.enabled" class="pm-ovl__ready">
                {{ tm("library.overlays_ready") }}
              </span>
            </div>
          </LjContextMenu>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { LjButton, LjContextMenu, LjEmpty, LjSwitch, type LjMenuItem } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { ModuleEnum } from "@/enums/ModuleEnum";
import { useModuleI18n } from "@/composables/useModuleI18n";
import { useModuleMirror } from "@/composables/useModuleMirror";
import Modules from "@/helpers/Modules";
import $snackbar from "@/helpers/Snackbar";
import type { OverlaySlot } from "@/types/Overlay";
import { useOverlayLibrary } from "../composables/useOverlayLibrary";
import OverlaySlotPreview from "./OverlaySlotPreview.vue";

const { t, tm } = useModuleI18n(ModuleEnum.PRESENTATION_MODE);
const { slots, loading, failed, enabled, isActive, setEnabled, toggle, refresh } =
  useOverlayLibrary();

const { mirrorText, mirrorColor } = useModuleMirror(() =>
  slots.value.filter((slot) => slot.type === "module_mirror").map((slot) => slot.source_module)
);

const onlyActive = ref(false);
const activeCount = computed(() => slots.value.filter((slot) => isActive(slot)).length);
const visibleSlots = computed(() =>
  onlyActive.value ? slots.value.filter((slot) => isActive(slot)) : slots.value
);
const countLabel = computed(() =>
  t(`modules.${ModuleEnum.PRESENTATION_MODE}.library.overlays_active_count`, activeCount.value)
);

function typeLabel(slot: OverlaySlot): string {
  if (slot.type === "image") return tm("library.overlays_type_image");
  if (slot.type === "module_mirror") return tm("library.overlays_type_module");
  return tm("library.overlays_type_text");
}

function openModule(): void {
  Modules.open(ModuleEnum.OVERLAY);
}

async function onToggle(slot: OverlaySlot): Promise<void> {
  if (!(await toggle(slot))) $snackbar.error(tm("library.overlays_toggle_failed"));
}

/** Tecla segurada repete o `keydown`: o card não pode piscar entre ligado/desligado. */
function onKeyToggle(event: KeyboardEvent, slot: OverlaySlot): void {
  if (event.repeat) return;
  void onToggle(slot);
}

function menuFor(slot: OverlaySlot): { quick: LjMenuItem[]; items: LjMenuItem[] } {
  const active = isActive(slot);
  return {
    quick: [
      {
        label: active ? tm("library.overlays_deactivate") : tm("library.overlays_activate"),
        icon: active ? ICONS.UI.LAYERS_OFF : ICONS.UI.LAYERS,
        action: () => void onToggle(slot),
      },
    ],
    items: [
      {
        label: tm("library.overlays_manage"),
        icon: ICONS.UI.OPEN_IN_NEW,
        action: openModule,
      },
    ],
  };
}
</script>

<style scoped>
.pm-ovl {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.pm-ovl__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--lj-space-3);
  row-gap: var(--lj-space-2);
  flex-shrink: 0;
  padding: var(--lj-space-2) var(--lj-space-3);
  border-bottom: 1px solid var(--lj-surface-border);
}

.pm-ovl__filter {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border: 1px solid var(--lj-surface-border);
  border-radius: var(--lj-radius-pill);
  background: transparent;
  color: var(--lj-text-subtle);
  font-size: var(--lj-text-xs);
  line-height: 18px;
  cursor: pointer;
}

.pm-ovl__filter:hover {
  background: var(--lj-surface-bg-soft);
}

.pm-ovl__filter:focus-visible {
  outline: 2px solid var(--lj-ui-accent);
  outline-offset: 1px;
}

.pm-ovl__filter--on {
  border-color: var(--lj-orange);
  color: var(--lj-orange);
}

.pm-ovl__banner {
  display: flex;
  align-items: center;
  gap: var(--lj-space-3);
  margin-bottom: var(--lj-space-3);
  padding: var(--lj-space-2) var(--lj-space-3);
  border: 1px solid var(--lj-surface-border);
  border-radius: var(--lj-radius-md);
  background: var(--lj-surface-bg-soft);
  color: var(--lj-text-subtle);
  font-size: var(--lj-text-xs);
}

.pm-ovl__banner span {
  flex: 1;
}

.pm-ovl__spacer {
  flex: 1;
}

.pm-ovl__body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--lj-space-3);
}

.pm-ovl__message {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--lj-space-3);
  margin: 0;
  padding: var(--lj-space-6);
  color: var(--lj-text-subtle);
  text-align: center;
}

.pm-ovl__message p {
  margin: 0;
}

.pm-ovl__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
  gap: var(--lj-space-3);
}

.pm-ovl__card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-2);
  padding: 6px;
  border: 1px solid var(--lj-surface-border);
  border-radius: var(--lj-radius-md);
  background: var(--lj-surface-bg);
  cursor: pointer;
  transition:
    border-color var(--lj-transition-fast),
    background var(--lj-transition-fast);
}

.pm-ovl__card:hover {
  background: var(--lj-surface-bg-soft);
}

.pm-ovl__card:focus-visible {
  outline: 2px solid var(--lj-ui-accent);
  outline-offset: 1px;
}

.pm-ovl__card--active {
  border-color: var(--lj-orange);
}

.pm-ovl__meta {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  padding-inline: 2px;
}

.pm-ovl__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--lj-text-sm);
  font-weight: var(--lj-weight-medium);
  color: var(--lj-text);
}

.pm-ovl__type {
  font-size: var(--lj-text-xs);
  color: var(--lj-text-subtle);
}

.pm-ovl__live,
.pm-ovl__ready {
  position: absolute;
  top: 10px;
  left: 10px;
  padding: 0 4px;
  border-radius: var(--lj-radius-xs);
  font-size: 10px;
  font-weight: var(--lj-weight-semibold);
  line-height: 16px;
  text-transform: uppercase;
  pointer-events: none;
}

.pm-ovl__live {
  background: var(--lj-orange);
  color: var(--lj-white);
}

.pm-ovl__ready {
  background: var(--lj-surface-border-strong);
  color: var(--lj-text);
}
</style>
