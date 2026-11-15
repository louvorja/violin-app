<template>
  <div class="category-bar" :class="{ 'category-bar--dragging': dragging }">
    <div class="category-bar__header">
      <LjButton
        class="category-bar__title"
        variant="ghost"
        size="sm"
        :title="toggleAllLabel"
        :aria-label="toggleAllLabel"
        @click="toggleAll"
      >
        {{ title }}
      </LjButton>

      <div class="category-bar__sort-field">
        <span class="category-bar__sort-label">{{ sortLabel }}</span>
        <LjSelect
          class="category-bar__sort"
          size="sm"
          :model-value="sortMode"
          :items="sortOptions"
          item-value="value"
          item-label="label"
          :aria-label="sortLabel"
          @update:model-value="emit('update:sortMode', $event as ItemSortMode)"
        />
      </div>
    </div>

    <div class="category-bar__chips">
      <CategoryChip
        v-for="category in categories"
        :key="category.id"
        :category-id="category.id"
        :name="category.name"
        :icon="category.icon"
        :icon-type="category.iconType"
        :color="category.color"
        :count="countFor(category.id)"
        :active="selectedIds.has(category.id)"
        :drop-target="dropTargetId === category.id"
        :add-item-label="addItemLabel"
        :edit-label="editLabel"
        :play-label="playLabel"
        :show-play="showPlayFor(category.id)"
        @select="emit('select', category.id)"
        @add="emit('add', category.id)"
        @edit="emit('edit', category.id)"
        @play="emit('play', category.id)"
        @dragover="emit('dragover', $event, category.id)"
        @dragleave="emit('dragleave', $event, category.id)"
        @drop="emit('drop', $event, category.id)"
      />
      <CategoryChip
        :category-id="uncategorizedId"
        :name="uncategorizedLabel"
        :icon="uncategorizedIcon"
        icon-type="icon"
        :color="uncategorizedColor"
        :count="uncategorizedCount"
        :active="selectedIds.has(uncategorizedId)"
        :drop-target="dropTargetId === uncategorizedId"
        :editable="false"
        :add-item-label="addItemLabel"
        :play-label="playLabel"
        :show-play="showPlayFor(uncategorizedId)"
        @select="emit('select', uncategorizedId)"
        @add="emit('add', uncategorizedId)"
        @play="emit('play', uncategorizedId)"
        @dragover="emit('dragover', $event, uncategorizedId)"
        @dragleave="emit('dragleave', $event, uncategorizedId)"
        @drop="emit('drop', $event, uncategorizedId)"
      />
      <slot name="hint" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { LjButton, LjSelect } from "@/components/ui";
import CategoryChip from "@/components/CategoryChip.vue";
import type { ItemSortMode } from "@/helpers/ItemSort";

export interface CategoryBarItem {
  id: string;
  name: string;
  icon: string;
  iconType: "icon" | "image";
  color: string;
}

export interface CategorySortOption {
  value: ItemSortMode;
  label: string;
}

const props = withDefaults(
  defineProps<{
    title: string;
    categories: CategoryBarItem[];
    selectedIds: Set<string>;
    uncategorizedId?: string;
    uncategorizedLabel: string;
    uncategorizedIcon: string;
    uncategorizedColor: string;
    uncategorizedCount: number;
    countFor: (_id: string) => number;
    dropTargetId?: string | null;
    addItemLabel: string;
    editLabel: string;
    playLabel?: string;
    playable?: (_id: string) => boolean;
    sortMode: ItemSortMode;
    sortOptions: CategorySortOption[];
    sortLabel: string;
    showAllLabel: string;
    hideAllLabel: string;
    dragging?: boolean;
  }>(),
  {
    uncategorizedId: "",
    dropTargetId: null,
    playLabel: "",
    dragging: false,
  }
);

const emit = defineEmits<{
  "update:selectedIds": [value: Set<string>];
  "update:sortMode": [value: ItemSortMode];
  select: [id: string];
  add: [id: string];
  edit: [id: string];
  play: [id: string];
  dragover: [event: DragEvent, id: string];
  dragleave: [event: DragEvent, id: string];
  drop: [event: DragEvent, id: string];
}>();

const allIds = computed(() => {
  const ids = props.categories.map((category) => category.id);
  if (props.uncategorizedCount > 0) ids.push(props.uncategorizedId);
  return ids;
});

const allActive = computed(
  () => allIds.value.length > 0 && allIds.value.every((id) => props.selectedIds.has(id))
);

const toggleAllLabel = computed(() => (allActive.value ? props.hideAllLabel : props.showAllLabel));

function toggleAll(): void {
  emit("update:selectedIds", new Set(allActive.value ? [] : allIds.value));
}

function showPlayFor(id: string): boolean {
  return !!props.playLabel && (props.playable ? props.playable(id) : true);
}
</script>

<style scoped>
.category-bar {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-3);
  width: 100%;
  min-width: 0;
}
.category-bar__header {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--lj-space-3) var(--lj-space-5);
}
.category-bar__title {
  flex: none;
  color: var(--lj-text-muted);
}
.category-bar__title:hover {
  color: var(--lj-text);
}
.category-bar__chips {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--lj-space-3);
  min-width: 0;
}
.category-bar__sort-field {
  display: inline-flex;
  align-items: center;
  flex: none;
  gap: var(--lj-space-3);
}
.category-bar__sort-label {
  color: var(--lj-text-muted);
  font-size: var(--lj-text-sm);
  white-space: nowrap;
}
.category-bar__sort {
  width: 190px;
  max-width: 100%;
}
@media (max-width: 640px) {
  .category-bar__sort-field {
    width: 100%;
  }
  .category-bar__sort {
    flex: 1 1 auto;
    width: auto;
  }
}
</style>
