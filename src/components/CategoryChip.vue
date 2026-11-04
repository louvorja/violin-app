<template>
  <ContextMenuRoot>
    <ContextMenuTrigger as-child>
      <div
        v-bind="$attrs"
        class="lj-category-chip"
        :class="{
          'lj-category-chip--active': active,
          'lj-category-chip--drop-target': dropTarget,
        }"
        :style="{ '--category-chip-color': color }"
        role="button"
        tabindex="0"
        :aria-pressed="active"
        :data-category-drop-id="categoryId"
        @click="$emit('select')"
        @keydown.enter.prevent="$emit('select')"
        @keydown.space.prevent="$emit('select')"
      >
        <span class="lj-category-chip__icon">
          <LjIcon v-if="iconType === 'icon'" :icon="icon" :size="14" />
          <img v-else-if="icon" :src="icon" class="lj-category-chip__img" alt="" />
        </span>
        <span class="lj-category-chip__name">{{ name }}</span>
        <span class="lj-category-chip__count">{{ count }}</span>
        <button
          v-if="showAdd"
          type="button"
          class="lj-category-chip__add"
          :title="addLabel"
          :aria-label="addLabel"
          @click.stop="$emit('add')"
          @keydown.stop
        >
          <LjIcon :icon="ICONS.ACTIONS.ADD" :size="12" />
        </button>
      </div>
    </ContextMenuTrigger>

    <ContextMenuPortal>
      <ContextMenuContent class="lj-ui-float lj-menu lj-category-chip__menu">
        <ContextMenuItem class="lj-menu__item" @select="$emit('add')">
          <span class="lj-menu__mark">
            <LjIcon :icon="ICONS.ACTIONS.ADD" :size="13" />
          </span>
          <span class="lj-menu__text">{{ addItemLabel }}</span>
        </ContextMenuItem>
        <ContextMenuItem v-if="editable" class="lj-menu__item" @select="$emit('edit')">
          <span class="lj-menu__mark">
            <LjIcon :icon="ICONS.ACTIONS.EDIT" :size="13" />
          </span>
          <span class="lj-menu__text">{{ editLabel }}</span>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenuPortal>
  </ContextMenuRoot>
</template>

<script setup lang="ts">
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuPortal,
  ContextMenuRoot,
  ContextMenuTrigger,
} from "reka-ui";
import { LjIcon } from "@/components/ui";
import { ICONS } from "@/config/Icons";

defineOptions({ inheritAttrs: false });

withDefaults(
  defineProps<{
    categoryId?: string;
    name?: string;
    icon?: string;
    iconType?: "icon" | "image";
    color?: string;
    count?: number;
    active?: boolean;
    dropTarget?: boolean;
    showAdd?: boolean;
    addLabel?: string;
    addItemLabel?: string;
    editLabel?: string;
    editable?: boolean;
  }>(),
  {
    categoryId: "",
    name: "",
    icon: "",
    iconType: "icon",
    color: "var(--lj-text-subtle)",
    count: 0,
    active: false,
    dropTarget: false,
    showAdd: false,
    addLabel: "",
    addItemLabel: "",
    editLabel: "",
    editable: true,
  }
);

defineEmits<{
  select: [];
  add: [];
  edit: [];
}>();
</script>

<style scoped>
.lj-category-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--lj-space-2);
  padding: 3px 10px;
  border: 1.5px solid var(--category-chip-color);
  border-radius: var(--lj-radius-pill);
  background: transparent;
  color: var(--category-chip-color);
  cursor: pointer;
  font-family: inherit;
  font-size: var(--lj-text-base);
  line-height: 1.4;
  opacity: 0.55;
  outline: none;
  white-space: nowrap;
  transition:
    background var(--lj-transition-fast),
    opacity var(--lj-transition-fast);
}

.lj-category-chip:hover {
  opacity: 0.85;
}

.lj-category-chip:focus-visible {
  box-shadow: var(--lj-ui-focus);
}

.lj-category-chip--active {
  background: color-mix(in srgb, var(--category-chip-color) 20%, transparent);
  opacity: 1;
}

.lj-category-chip--drop-target {
  outline: 2px dashed var(--lj-ui-accent);
  outline-offset: 2px;
  box-shadow: 0 0 0 4px var(--lj-ui-accent-soft);
  opacity: 1;
}

.lj-category-chip__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}

.lj-category-chip__img {
  width: 14px;
  height: 14px;
  object-fit: contain;
}

.lj-category-chip__name {
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 180px;
}

.lj-category-chip__count {
  padding: 0 5px;
  border-radius: var(--lj-radius-pill);
  background: color-mix(in srgb, var(--category-chip-color) 30%, transparent);
  font-size: var(--lj-text-xs);
  line-height: 16px;
}

.lj-category-chip__add {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: inherit;
  cursor: pointer;
  opacity: 0.6;
  transition:
    background var(--lj-transition-fast),
    opacity var(--lj-transition-fast);
}

.lj-category-chip__add:hover {
  background: color-mix(in srgb, var(--category-chip-color) 20%, transparent);
  opacity: 1;
}

.lj-category-chip__add:focus-visible {
  outline: none;
  box-shadow: var(--lj-ui-focus);
}

@media (pointer: coarse) {
  .lj-category-chip {
    min-height: 44px;
  }
}
</style>
