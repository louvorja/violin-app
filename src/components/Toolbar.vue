<template>
  <div class="lj-toolbar-strip">
    <slot />
  </div>
</template>

<script setup></script>

<style scoped>
.lj-toolbar-strip {
  display: flex;
  align-items: center;
  padding-inline: var(--lj-space-2);
  overflow-x: auto;
}
</style>
