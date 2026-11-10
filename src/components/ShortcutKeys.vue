<template>
  <span class="shortcut-keys" :class="{ 'shortcut-keys--large': large }">
    <template v-for="(part, index) in parts" :key="`${part}-${index}`">
      <kbd class="shortcut-keys__key">{{ part }}</kbd>
      <span v-if="index < parts.length - 1" class="shortcut-keys__plus">+</span>
    </template>
  </span>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ parts: string[]; large?: boolean }>(), { large: false });
</script>

<style scoped>
.shortcut-keys {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 2px;
}

.shortcut-keys__key {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 22px;
  padding: 0 var(--lj-space-2);
  border: 1px solid var(--lj-kbd-border);
  border-bottom-width: 2px;
  border-radius: var(--lj-radius-sm);
  background: var(--lj-kbd-bg);
  color: var(--lj-text);
  font-family: var(--lj-font-mono);
  font-size: var(--lj-text-xs);
  font-weight: var(--lj-weight-medium);
  letter-spacing: 0.02em;
}

.shortcut-keys__plus {
  margin: 0 2px;
  color: var(--lj-text-subtle);
  font-size: var(--lj-text-xs);
  font-weight: var(--lj-weight-medium);
}

.shortcut-keys--large {
  gap: 5px;
}

.shortcut-keys--large .shortcut-keys__key {
  min-width: 38px;
  height: 38px;
  padding: 0 var(--lj-space-3);
  border-radius: var(--lj-radius-md);
  font-size: var(--lj-text-md);
}

.shortcut-keys--large .shortcut-keys__plus {
  font-size: var(--lj-text-md);
}
</style>
