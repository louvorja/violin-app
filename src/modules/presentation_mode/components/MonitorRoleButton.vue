<template>
  <LjMenu :items="items" side="bottom" align="start">
    <template #trigger>
      <RibbonButtonComponent
        :icon="role === 'stage' ? ICONS.PROJECTION.RETURN : ICONS.PROJECTION.SCREEN_OUTLINE"
        :label="label"
        :icon-color="monitor === null ? '#7f8c8d' : '#1b4f8a'"
        :testid="`ribbon-btn-monitor-${role}`"
        dropdown
      />
    </template>
  </LjMenu>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { LjMenu } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { ModuleEnum } from "@/enums/ModuleEnum";
import { useModuleI18n } from "@/composables/useModuleI18n";
import RibbonButtonComponent from "@/layout/shell/RibbonButtonComponent.vue";
import { useMonitorRole, type MonitorRole } from "../composables/useMonitorRole";

/**
 * Opção, não estado: qual monitor é a tela principal e qual é o retorno de
 * palco. Clicar só abre a escolha do monitor — ligar e desligar as telas é o
 * Iniciar/Parar apresentação e o liga/desliga de cada tela nas saídas.
 */

const props = defineProps<{ role: MonitorRole }>();

const { tm } = useModuleI18n(ModuleEnum.PRESENTATION_MODE);
const { monitor, monitorLabel, items } = useMonitorRole(props.role);

const label = computed(
  () =>
    `${tm(props.role === "stage" ? "outputs.stage_return" : "outputs.main_screen")}: ${monitorLabel.value}`
);
</script>
