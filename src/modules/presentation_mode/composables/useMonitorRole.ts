import { computed } from "vue";
import type { LjMenuItem } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { ModuleEnum } from "@/enums/ModuleEnum";
import { useDisplays } from "@/composables/useDisplays";
import { useModuleI18n } from "@/composables/useModuleI18n";

export type MonitorRole = "projection" | "stage";

/**
 * Em qual monitor fica a tela principal ou o retorno: o número atual e o
 * menu para trocar (com "Nenhum" e "Identificar"). Serve ao ribbon e ao
 * cabeçalho de cada tela na coluna de saídas.
 */
export function useMonitorRole(role: MonitorRole) {
  const { tm } = useModuleI18n(ModuleEnum.PRESENTATION_MODE);
  const { displays, roles, setRole, identify } = useDisplays();

  const currentId = computed(() => roles.value.find((r) => r.role === role)?.displayId ?? null);
  const monitor = computed(() => {
    const display = displays.value.find((d) => String(d.id) === String(currentId.value));
    return display ? (display.number ?? null) : null;
  });
  const monitorLabel = computed(() =>
    monitor.value === null ? tm("outputs.no_monitor") : tm("outputs.monitor", { n: monitor.value })
  );

  const items = computed<LjMenuItem[]>(() => [
    { label: tm(role === "stage" ? "monitors.stage_title" : "monitors.main_title") },
    ...displays.value.map((d) => ({
      label: d.name ? `${tm("outputs.monitor", { n: d.number ?? "?" })} — ${d.name}` : d.label,
      hint: d.primary ? tm("monitors.operator_screen") : undefined,
      checked: String(d.id) === String(currentId.value),
      action: () => void setRole(role, d.id),
    })),
    { label: tm("monitors.none"), checked: currentId.value === null, action: () => void setRole(role, null) },
    { separator: true },
    { label: tm("outputs.identify"), icon: ICONS.UI.MONITORS, action: () => void identify(3000) },
  ]);

  return { monitor, monitorLabel, items };
}
