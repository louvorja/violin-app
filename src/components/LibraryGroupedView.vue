<template>
  <div class="lgv">
    <section v-for="group in groups" :key="group.id" class="lgv-group">
      <h4 v-if="group.name" class="lgv-group-title">{{ group.name }}</h4>
      <div :class="['lgv-items', `lgv-items--${view}`]">
        <template v-for="item in group.items" :key="keyOf(item)">
          <slot v-if="view === 'grid'" name="grid-item" :item="item" />
          <slot v-else name="list-item" :item="item" />
        </template>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts" generic="T">
export interface LibraryViewGroup<T> {
  id: string;
  name: string;
  items: T[];
}

withDefaults(
  defineProps<{
    groups?: LibraryViewGroup<T>[];
    view?: "grid" | "list";
  }>(),
  { groups: () => [], view: "grid" }
);

function keyOf(item: T): string | number {
  const id = (item as { id?: string | number } | null)?.id;
  return id ?? String(item);
}
</script>

<style scoped>
.lgv-group + .lgv-group {
  margin-top: var(--lj-space-4);
}
.lgv-group-title {
  margin: 0 0 var(--lj-space-2);
  color: var(--lj-text-muted);
  font-size: var(--lj-text-sm);
  font-weight: var(--lj-weight-semibold);
}
.lgv-items--grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(108px, 1fr));
  gap: var(--lj-space-3);
}
.lgv-items--list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
</style>
