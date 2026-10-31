import { computed } from "vue";
import type { LjMenuItem } from "@/components/ui";
import { ModuleEnum } from "@/enums/ModuleEnum";
import { useDisplays } from "@/composables/useDisplays";
import { useModuleI18n } from "@/composables/useModuleI18n";

export type MonitorRole = "projection" | "stage";

/**
 * Em qual monitor fica a tela principal ou o retorno: o número atual e o
 * menu para trocar (com "Nenhum"). Serve ao seletor de cada tela na coluna
 * Apresentação, que também tem o "Identificar monitores".
 */
export function useMonitorRole(role: MonitorRole) {
  const { tm } = useModuleI18n(ModuleEnum.PRESENTATION_MODE);
  const { displays, roles, setRole, identify } = useDisplays();

  const currentId = computed(() => roles.value.find((r) => r.role === role)?.displayId ?? null);
  const display = computed(
    () => displays.value.find((d) => String(d.id) === String(currentId.value)) ?? null
  );
  const monitor = computed(() => (display.value ? (display.value.number ?? null) : null));
  /** Tamanho da tela do monitor (para a visão em tela cheia da miniatura). */
  const size = computed(() =>
    display.value
      ? { width: display.value.bounds.width, height: display.value.bounds.height }
      : null
  );
  const monitorLabel = computed(() =>
    monitor.value === null ? tm("outputs.no_monitor") : tm("outputs.monitor", { n: monitor.value })
  );

  /** O mesmo texto do menu ("Monitor 2 — Built-in Retina Display"): o nome diz qual aparelho é. */
  const displayLabel = (d: { name?: string; number?: number | null; label: string }) =>
    d.name ? `${tm("outputs.monitor", { n: d.number ?? "?" })} — ${d.name}` : d.label;
  /** Seletor da coluna Apresentação: o monitor com o nome do aparelho. */
  const selectorLabel = computed(() =>
    display.value ? displayLabel(display.value) : tm("outputs.no_monitor")
  );

  const items = computed<LjMenuItem[]>(() => [
    { label: tm(role === "stage" ? "monitors.stage_title" : "monitors.main_title") },
    ...displays.value.map((d) => ({
      label: displayLabel(d),
      hint: d.primary ? tm("monitors.operator_screen") : undefined,
      checked: String(d.id) === String(currentId.value),
      action: () => void setRole(role, d.id),
    })),
    {
      label: tm("monitors.none"),
      checked: currentId.value === null,
      action: () => void setRole(role, null),
    },
  ]);

  return { monitor, monitorLabel, selectorLabel, items, size, identify: () => void identify(3000) };
}
