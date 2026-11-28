<template>
  <button
    type="button"
    class="pm-category-item"
    :class="{ 'pm-category-item--active': active }"
    :style="{ '--pm-category-item-color': color }"
    :data-category-id="categoryId"
    :aria-pressed="active"
    :title="name"
    @click="$emit('select')"
  >
    <span class="pm-category-item__icon">
      <img v-if="iconType === 'image' && icon" :src="icon" class="pm-category-item__img" alt="" />
      <LjIcon v-else-if="icon" :icon="icon" :size="15" />
    </span>
    <span class="pm-category-item__name">{{ name }}</span>
    <span class="pm-category-item__count">{{ count }}</span>
  </button>
</template>

<script setup lang="ts">
import { LjIcon } from "@/components/ui";

/**
 * Linha de categoria da lateral do Modo apresentação: sem pílula, sem borda e
 * sem fundo no estado normal — só ícone na cor da categoria, nome e contador,
 * como as pastas da aba Biblioteca. O item ativo ganha o mesmo realce da
 * biblioteca (fundo suave e faixa laranja à esquerda).
 */

withDefaults(
  defineProps<{
    categoryId?: string;
    name?: string;
    icon?: string;
    iconType?: "icon" | "image";
    color?: string;
    count?: number;
    active?: boolean;
  }>(),
  {
    categoryId: "",
    name: "",
    icon: "",
    iconType: "icon",
    color: "var(--lj-orange)",
    count: 0,
    active: false,
  }
);

defineEmits<{ select: [] }>();
</script>

<style scoped>
.pm-category-item {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  height: 27px;
  flex-shrink: 0;
  padding: 0 8px 0 9px;
  border: none;
  border-left: 3px solid transparent;
  background: transparent;
  color: var(--lj-text);
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
  transition:
    background 120ms var(--lj-ease),
    border-color 120ms var(--lj-ease);
}

.pm-category-item:hover {
  background: var(--lj-hover-bg);
}

.pm-category-item:focus-visible {
  outline: none;
  box-shadow: var(--lj-ui-focus);
}

.pm-category-item--active {
  background: var(--lj-live-active-bg);
  border-left-color: var(--lj-orange);
}

.pm-category-item__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  color: var(--pm-category-item-color);
}

.pm-category-item__img {
  width: 16px;
  height: 16px;
  object-fit: contain;
}

.pm-category-item__name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.pm-category-item__count {
  flex-shrink: 0;
  color: var(--lj-text-subtle);
  font-family: var(--lj-font-mono);
  font-size: 10px;
}

@media (pointer: coarse) {
  .pm-category-item {
    height: 44px;
  }
}
</style>
