<template>
  <span
    class="lj-category-item-icon"
    :class="{
      'lj-category-item-icon--inline': inline,
      'lj-category-item-icon--top-left': placement === 'top-left',
      'lj-category-item-icon--translucent': translucent,
    }"
    :style="{ '--category-item-color': color }"
    :title="label"
    aria-hidden="true"
  >
    <img
      v-if="iconType === 'image' && icon"
      :src="icon"
      alt=""
      class="lj-category-item-icon__img"
    />
    <LjIcon v-else-if="icon" :icon="icon" :size="14" />
  </span>
</template>

<script setup lang="ts">
import { LjIcon } from "@/components/ui";

withDefaults(
  defineProps<{
    icon?: string;
    iconType?: "icon" | "image";
    color?: string;
    label?: string;
    inline?: boolean;
    placement?: "bottom-left" | "top-left";
    translucent?: boolean;
  }>(),
  {
    icon: "",
    iconType: "icon",
    color: "var(--lj-gray-500)",
    label: "",
    inline: false,
    placement: "bottom-left",
    translucent: false,
  }
);
</script>

<style scoped>
.lj-category-item-icon {
  position: absolute;
  left: 6px;
  bottom: 6px;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  overflow: hidden;
  color: var(--lj-white);
  background: color-mix(in srgb, var(--category-item-color) 82%, black);
  border-radius: var(--lj-radius-sm);
  box-shadow: 0 1px 4px var(--lj-black-alpha-40);
  pointer-events: none;
}

.lj-category-item-icon--inline {
  position: static;
  left: auto;
  bottom: auto;
  width: 22px;
  height: 22px;
  flex-shrink: 0;
}

.lj-category-item-icon--top-left {
  top: 6px;
  bottom: auto;
}

.lj-category-item-icon--translucent {
  opacity: 0.85;
}

.lj-category-item-icon__img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
</style>
