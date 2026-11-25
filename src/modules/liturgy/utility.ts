/**
 * Item "Utilitário" da liturgia: um atalho que abre um módulo já configurado
 * (Temporizador de Culto até 10:45, Cronômetro de 5 min…) e, se marcado,
 * começa a contar sozinho.
 *
 * O que cada módulo aceita mora aqui, num lugar só: o formulário mostra os
 * campos, a lista monta o resumo e a execução manda o pedido pela fila de
 * `ModuleLaunch` — quem aplica é o próprio módulo.
 */
import { ICONS } from "@/config/Icons";
import { ModuleEnum } from "@/enums/ModuleEnum";
import type { ModuleLaunchConfig } from "@/helpers/ModuleLaunch";

export interface UtilityModuleSpec {
  id: string;
  icon: string;
  /** Campos que o formulário mostra para este módulo. */
  fields: Array<"mode" | "define_by" | "target" | "minutes">;
  /** Tem "Iniciar automaticamente" (os que contam tempo). */
  canAutoStart: boolean;
}

export const UTILITY_MODULES: UtilityModuleSpec[] = [
  {
    id: ModuleEnum.TIMER_WORSHIP,
    icon: ICONS.MODULES.TIMER_WORSHIP,
    fields: ["mode", "define_by", "target", "minutes"],
    canAutoStart: true,
  },
  {
    id: ModuleEnum.TIMER,
    icon: ICONS.MODULES.TIMER,
    fields: ["mode", "target"],
    canAutoStart: true,
  },
  {
    id: ModuleEnum.STOPWATCH,
    icon: ICONS.MODULES.STOPWATCH,
    fields: ["mode", "minutes"],
    canAutoStart: true,
  },
  { id: ModuleEnum.CLOCK, icon: ICONS.MODULES.CLOCK, fields: [], canAutoStart: false },
  { id: ModuleEnum.COUNTER, icon: ICONS.MODULES.COUNTER, fields: [], canAutoStart: false },
  { id: ModuleEnum.DRAW, icon: ICONS.MODULES.DRAW, fields: [], canAutoStart: false },
];

export function utilitySpec(moduleId: string | undefined): UtilityModuleSpec | undefined {
  return UTILITY_MODULES.find((m) => m.id === moduleId);
}

/** Configuração inicial ao escolher o módulo no formulário. */
export function defaultUtilityConfig(moduleId: string): ModuleLaunchConfig {
  const spec = utilitySpec(moduleId);
  if (!spec) return {};
  const config: ModuleLaunchConfig = {};
  if (spec.fields.includes("mode")) config.mode = "down";
  if (spec.fields.includes("define_by")) config.define_by = "end";
  if (spec.fields.includes("minutes")) config.minutes = moduleId === ModuleEnum.STOPWATCH ? 5 : 30;
  return config;
}

/** Quais campos aparecem agora (a hora some em "duração" e no cronômetro progressivo). */
export function visibleUtilityFields(
  moduleId: string | undefined,
  config: ModuleLaunchConfig
): UtilityModuleSpec["fields"] {
  const spec = utilitySpec(moduleId);
  if (!spec) return [];
  return spec.fields.filter((field) => {
    if (moduleId === ModuleEnum.TIMER_WORSHIP) {
      if (field === "target") return config.define_by !== "duration";
      if (field === "minutes") return config.define_by === "duration";
    }
    if (moduleId === ModuleEnum.STOPWATCH && field === "minutes") return config.mode !== "up";
    return true;
  });
}

/** Só o que vale para o módulo, sem campo escondido de outra escolha. */
export function cleanUtilityConfig(
  moduleId: string | undefined,
  config: ModuleLaunchConfig
): ModuleLaunchConfig {
  const visible = visibleUtilityFields(moduleId, config);
  const clean: ModuleLaunchConfig = {};
  for (const field of visible) {
    const value = config[field];
    if (value === undefined || value === "") continue;
    if (field === "minutes") {
      const minutes = Math.round(Number(value));
      if (Number.isFinite(minutes) && minutes >= 1) clean.minutes = Math.min(minutes, 24 * 60);
    } else if (field === "target") {
      if (/^\d{2}:\d{2}$/.test(String(value))) clean.target = String(value);
    } else {
      (clean as Record<string, unknown>)[field] = value;
    }
  }
  return clean;
}

/**
 * Segunda linha do item na lista: "até 10:45", "30 min", "5 min · inicia
 * sozinho". `t` traduz as chaves `utility.*` da liturgia.
 */
export function utilitySummary(
  moduleId: string | undefined,
  config: ModuleLaunchConfig,
  autoStart: boolean,
  t: (key: string) => string
): string {
  const parts: string[] = [];
  const visible = visibleUtilityFields(moduleId, config);
  if (visible.includes("target") && config.target)
    parts.push(`${t("utility.until")} ${config.target}`);
  if (visible.includes("minutes") && config.minutes) parts.push(`${config.minutes} min`);
  if (visible.includes("mode") && config.mode === "up") parts.push(t("utility.mode_up"));
  if (autoStart && utilitySpec(moduleId)?.canAutoStart) parts.push(t("utility.auto_start_short"));
  return parts.join(" · ");
}
