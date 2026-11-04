<template>
  <Teleport to="body">
    <div
      v-if="ghost"
      class="category-drag-ghost"
      :class="{ 'category-drag-ghost--compact': compact }"
      :style="{ left: `${ghost.x}px`, top: `${ghost.y}px` }"
      aria-hidden="true"
    >
      <img v-if="ghost.thumb" :src="ghost.thumb" class="category-drag-ghost__thumb" alt="" />
      <span v-else class="category-drag-ghost__icon">
        <LjIcon :icon="ghost.icon || ICONS.UI.FILE_MULTIPLE" :size="20" />
      </span>
      <span class="category-drag-ghost__name">{{ ghost.name }}</span>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { LjIcon } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import type { CategoryTouchGhost } from "@/composables/useCategoryDrag";

withDefaults(defineProps<{ ghost: CategoryTouchGhost | null; compact?: boolean }>(), {
  compact: false,
});
</script>

<style scoped>
.category-drag-ghost {
  position: fixed;
  z-index: 10000;
  display: flex;
  align-items: center;
  gap: var(--lj-space-2);
  max-width: min(240px, 70vw);
  padding: var(--lj-space-2) var(--lj-space-3);
  color: var(--lj-text);
  background: var(--lj-surface-bg);
  border: 1px solid var(--lj-surface-border);
  border-radius: var(--lj-radius-md);
  box-shadow: var(--lj-shadow-3);
  pointer-events: none;
  transform: translate(-50%, calc(-100% - 14px));
  user-select: none;
  transition:
    transform var(--lj-transition-fast),
    opacity var(--lj-transition-fast);
}

.category-drag-ghost--compact {
  opacity: 0.3;
  transform: translate(-50%, calc(-100% - 14px)) scale(0.55);
}

.category-drag-ghost__thumb {
  width: 48px;
  height: 32px;
  object-fit: cover;
  border-radius: var(--lj-radius-sm);
  flex-shrink: 0;
}

.category-drag-ghost__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  color: var(--lj-text-subtle);
  flex-shrink: 0;
}

.category-drag-ghost__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--lj-text-sm);
}
</style>
