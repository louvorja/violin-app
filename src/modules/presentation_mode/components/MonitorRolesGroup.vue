<template>
  <div class="pm-monitor-roles">
    <MonitorRoleButton role="projection" />
    <MonitorRoleButton role="stage" />
  </div>
</template>

<script setup lang="ts">
import MonitorRoleButton from "./MonitorRoleButton.vue";

/** Grupo "Saídas" do ribbon: em qual monitor fica cada tela (opção, não estado). */
defineProps<{ module: string | null; config: unknown }>();
</script>

<style scoped>
.pm-monitor-roles {
  display: flex;
  align-items: stretch;
  gap: 2px;
  height: 100%;
}
</style>
