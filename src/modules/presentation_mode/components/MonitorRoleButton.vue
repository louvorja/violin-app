<template>
  <LjMenu :items="items" side="bottom" align="start">
    <template #trigger>
      <RibbonButtonComponent
        :icon="role === 'stage' ? ICONS.PROJECTION.RETURN : ICONS.PROJECTION.SCREEN_OUTLINE"
        :label="label"
        :icon-color="monitor === null ? '#7f8c8d' : '#1b4f8a'"
        :testid="`ribbon-btn-monitor-${role}`"
      />
    </template>
  </LjMenu>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { LjMenu, type LjMenuItem } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { ModuleEnum } from "@/enums/ModuleEnum";
import { useDisplays } from "@/composables/useDisplays";
import { useModuleI18n } from "@/composables/useModuleI18n";
import RibbonButtonComponent from "@/layout/shell/RibbonButtonComponent.vue";

/**
 * Opção, não estado: qual monitor é a tela principal e qual é o retorno de
 * palco. Clicar só abre a escolha do monitor — ligar e desligar as telas é o
 * Iniciar/Parar apresentação.
 */

const props = defineProps<{ role: "projection" | "stage" }>();

const { tm } = useModuleI18n(ModuleEnum.PRESENTATION_MODE);
const { displays, roles, setRole, identify } = useDisplays();

const role = computed(() => props.role);

const currentId = computed(() => roles.value.find((r) => r.role === role.value)?.displayId ?? null);
const monitor = computed(() => {
  const display = displays.value.find((d) => String(d.id) === String(currentId.value));
  return display ? (display.number ?? null) : null;
});

const label = computed(() => {
  const name = tm(role.value === "stage" ? "outputs.stage_return" : "outputs.main_screen");
  const where =
    monitor.value === null ? tm("outputs.no_monitor") : tm("outputs.monitor", { n: monitor.value });
  return `${name}: ${where}`;
});

const items = computed<LjMenuItem[]>(() => [
  { label: tm(role.value === "stage" ? "monitors.stage_title" : "monitors.main_title") },
  ...displays.value.map((d) => ({
    label: d.name ? `${tm("outputs.monitor", { n: d.number ?? "?" })} — ${d.name}` : d.label,
    hint: d.primary ? tm("monitors.operator_screen") : undefined,
    checked: String(d.id) === String(currentId.value),
    action: () => void setRole(role.value, d.id),
  })),
  {
    label: tm("monitors.none"),
    checked: currentId.value === null,
    action: () => void setRole(role.value, null),
  },
  { separator: true },
  { label: tm("outputs.identify"), icon: ICONS.UI.MONITORS, action: () => void identify(3000) },
]);
</script>
