/**
 * Item "Utilitário" da liturgia: abre um módulo já configurado para aquele
 * momento do culto (Temporizador de Culto até 10:45 sem a abertura, Sorteio de
 * 1 a 50, Relógio de 12 h…) e, se marcado, começa a contar sozinho.
 *
 * Tudo o que cada módulo aceita mora aqui, como uma lista de campos: o
 * formulário desenha a partir dela, a lista monta o resumo, a importação
 * filtra por ela, e a execução manda o pedido pela fila de `ModuleLaunch` —
 * quem aplica é o próprio módulo.
 */
import { ICONS } from "@/config/Icons";
import { ModuleEnum } from "@/enums/ModuleEnum";
import type { ModuleLaunchConfig } from "@/helpers/ModuleLaunch";

export type UtilityFieldType =
  | "select"
  | "time"
  | "number"
  | "checkbox"
  | "names"
  /** Áudio da Biblioteca de Mídia, ou vazio para o som que vem com o programa. */
  | "sound";

export type UtilityFieldGroup = "timing" | "display" | "sounds" | "draw";

export interface UtilityField {
  key: string;
  type: UtilityFieldType;
  /** Chave i18n dentro de `utility.` (liturgia). */
  label: string;
  group: UtilityFieldGroup;
  default: unknown;
  /** Para `select`: valor e chave i18n (`utility.`) do rótulo. */
  options?: Array<{ value: string; label: string }>;
  min?: number;
  max?: number;
  /** Mostra o campo só quando a configuração atual pede. */
  showIf?: (config: ModuleLaunchConfig) => boolean;
}

export interface UtilityModuleSpec {
  id: string;
  icon: string;
  fields: UtilityField[];
  /** Tem "Iniciar automaticamente" (os que contam tempo). */
  canAutoStart: boolean;
}

const MODE: UtilityField = {
  key: "mode",
  type: "select",
  label: "mode",
  group: "timing",
  default: "down",
  options: [
    { value: "down", label: "mode_down" },
    { value: "up", label: "mode_up" },
  ],
};

/** Aviso visual ("Avisar faltando"): segundos antes do fim; 0 desliga. */
const WARNING: UtilityField = {
  key: "warning",
  type: "select",
  label: "warning",
  group: "display",
  default: "60",
  options: [
    { value: "0", label: "warning_off" },
    { value: "30", label: "warning_30s" },
    { value: "60", label: "warning_1m" },
    { value: "120", label: "warning_2m" },
    { value: "300", label: "warning_5m" },
    { value: "600", label: "warning_10m" },
  ],
};

const OVERTIME: UtilityField = {
  key: "overtime",
  type: "checkbox",
  label: "overtime",
  group: "display",
  default: true,
};

const isDuration = (c: ModuleLaunchConfig) => c.define_by === "duration";

function soundPair(cue: "start" | "five" | "one"): UtilityField[] {
  const toggle = `sound_${cue}`;
  return [
    { key: toggle, type: "checkbox", label: `sound_${cue}`, group: "sounds", default: true },
    {
      key: `sound_${cue}_file`,
      type: "sound",
      label: `sound_${cue}`,
      group: "sounds",
      default: null,
      showIf: (c) => c[toggle] !== false,
    },
  ];
}

export const UTILITY_MODULES: UtilityModuleSpec[] = [
  {
    id: ModuleEnum.TIMER_WORSHIP,
    icon: ICONS.MODULES.TIMER_WORSHIP,
    canAutoStart: true,
    fields: [
      MODE,
      {
        key: "define_by",
        type: "select",
        label: "define_by",
        group: "timing",
        default: "end",
        options: [
          { value: "end", label: "define_by_end" },
          { value: "duration", label: "define_by_duration" },
        ],
      },
      {
        key: "target",
        type: "time",
        label: "target",
        group: "timing",
        default: "",
        showIf: (c) => !isDuration(c),
      },
      {
        key: "minutes",
        type: "number",
        label: "minutes",
        group: "timing",
        default: 30,
        min: 1,
        max: 1440,
        showIf: isDuration,
      },
      {
        key: "second_line",
        type: "select",
        label: "second_line",
        group: "display",
        default: "target",
        options: [
          { value: "target", label: "second_line_target" },
          { value: "clock", label: "second_line_clock" },
          { value: "both", label: "second_line_both" },
          { value: "none", label: "second_line_none" },
        ],
      },
      WARNING,
      OVERTIME,
      ...soundPair("start"),
      ...soundPair("five"),
      ...soundPair("one"),
    ],
  },
  {
    id: ModuleEnum.TIMER,
    icon: ICONS.MODULES.TIMER,
    canAutoStart: true,
    fields: [
      MODE,
      { key: "target", type: "time", label: "target", group: "timing", default: "" },
      WARNING,
      OVERTIME,
    ],
  },
  {
    id: ModuleEnum.STOPWATCH,
    icon: ICONS.MODULES.STOPWATCH,
    canAutoStart: true,
    fields: [
      MODE,
      {
        key: "minutes",
        type: "number",
        label: "minutes",
        group: "timing",
        default: 5,
        min: 1,
        max: 1440,
        showIf: (c) => c.mode !== "up",
      },
      WARNING,
      OVERTIME,
    ],
  },
  {
    id: ModuleEnum.CLOCK,
    icon: ICONS.MODULES.CLOCK,
    canAutoStart: false,
    fields: [
      {
        key: "hour_cycle",
        type: "select",
        label: "hour_cycle",
        group: "display",
        default: "24h",
        options: [
          { value: "24h", label: "hour_cycle_24" },
          { value: "12h", label: "hour_cycle_12" },
        ],
      },
      {
        key: "show_seconds",
        type: "checkbox",
        label: "show_seconds",
        group: "display",
        default: true,
      },
      { key: "show_date", type: "checkbox", label: "show_date", group: "display", default: false },
    ],
  },
  {
    id: ModuleEnum.COUNTER,
    icon: ICONS.MODULES.COUNTER,
    canAutoStart: false,
    fields: [
      {
        key: "start",
        type: "number",
        label: "counter_start",
        group: "display",
        default: 0,
        min: -999999,
        max: 999999,
      },
    ],
  },
  {
    id: ModuleEnum.DRAW,
    icon: ICONS.MODULES.DRAW,
    canAutoStart: false,
    fields: [
      {
        key: "draw_mode",
        type: "select",
        label: "draw_mode",
        group: "draw",
        default: "number",
        options: [
          { value: "number", label: "draw_numbers" },
          { value: "names", label: "draw_names" },
        ],
      },
      {
        key: "range_min",
        type: "number",
        label: "range_min",
        group: "draw",
        default: 1,
        min: -999999,
        max: 999999,
        showIf: (c) => c.draw_mode !== "names",
      },
      {
        key: "range_max",
        type: "number",
        label: "range_max",
        group: "draw",
        default: 100,
        min: -999999,
        max: 999999,
        showIf: (c) => c.draw_mode !== "names",
      },
      {
        key: "names",
        type: "names",
        label: "names",
        group: "draw",
        default: [],
        showIf: (c) => c.draw_mode === "names",
      },
      {
        key: "clear_history",
        type: "checkbox",
        label: "clear_history",
        group: "draw",
        default: true,
      },
    ],
  },
];

export const UTILITY_GROUPS: UtilityFieldGroup[] = ["timing", "display", "sounds", "draw"];

export function utilitySpec(moduleId: string | undefined): UtilityModuleSpec | undefined {
  return UTILITY_MODULES.find((m) => m.id === moduleId);
}

/** Configuração inicial ao escolher o módulo no formulário. */
export function defaultUtilityConfig(moduleId: string): ModuleLaunchConfig {
  const config: ModuleLaunchConfig = {};
  for (const field of utilitySpec(moduleId)?.fields ?? []) {
    config[field.key] = Array.isArray(field.default) ? [...field.default] : field.default;
  }
  return config;
}

/** Campos que aparecem agora (a hora some em "duração", os nomes só em "Nomes"…). */
export function visibleUtilityFields(
  moduleId: string | undefined,
  config: ModuleLaunchConfig
): UtilityField[] {
  return (utilitySpec(moduleId)?.fields ?? []).filter((f) => !f.showIf || f.showIf(config));
}

function cleanValue(field: UtilityField, value: unknown): unknown {
  switch (field.type) {
    case "select": {
      const text = String(value ?? "");
      return field.options?.some((o) => o.value === text) ? text : undefined;
    }
    case "time":
      return /^\d{2}:\d{2}$/.test(String(value ?? "")) ? String(value) : undefined;
    case "number": {
      if (value === "" || value === null || value === undefined) return undefined;
      const n = Math.round(Number(value));
      if (!Number.isFinite(n)) return undefined;
      return Math.min(Math.max(n, field.min ?? -Infinity), field.max ?? Infinity);
    }
    case "checkbox":
      return value === true || value === false ? value : undefined;
    case "names": {
      const list = Array.isArray(value) ? value : String(value ?? "").split(/\r?\n/);
      return list
        .map((n) => String(n).trim())
        .filter(Boolean)
        .slice(0, 10_000);
    }
    case "sound": {
      if (!value || typeof value !== "object") return null;
      const v = value as { libraryId?: unknown; name?: unknown };
      return v.libraryId ? { libraryId: String(v.libraryId), name: String(v.name || "") } : null;
    }
  }
}

/** Só o que vale para o módulo e a escolha atual, com cada valor conferido. */
export function cleanUtilityConfig(
  moduleId: string | undefined,
  config: ModuleLaunchConfig
): ModuleLaunchConfig {
  const clean: ModuleLaunchConfig = {};
  for (const field of visibleUtilityFields(moduleId, config)) {
    const value = cleanValue(field, config[field.key]);
    if (value !== undefined) clean[field.key] = value;
  }
  return clean;
}

/**
 * Segunda linha do item na lista: "até 10:45 · sem abertura · inicia sozinho".
 * `t` traduz as chaves `utility.*` da liturgia.
 */
export function utilitySummary(
  moduleId: string | undefined,
  config: ModuleLaunchConfig,
  autoStart: boolean,
  t: (key: string) => string
): string {
  const visible = new Set(visibleUtilityFields(moduleId, config).map((f) => f.key));
  const parts: string[] = [];
  if (visible.has("target") && config.target) parts.push(`${t("utility.until")} ${config.target}`);
  if (visible.has("minutes") && config.minutes) parts.push(`${config.minutes} min`);
  if (visible.has("mode") && config.mode === "up") parts.push(t("utility.mode_up"));
  if (visible.has("sound_start") && config.sound_start === false) {
    parts.push(t("utility.summary_no_opening"));
  }
  if (moduleId === ModuleEnum.DRAW) {
    if (config.draw_mode === "names") {
      const count = Array.isArray(config.names) ? config.names.length : 0;
      parts.push(`${count} ${t("utility.summary_names")}`);
    } else if (config.range_min !== undefined && config.range_max !== undefined) {
      parts.push(`${config.range_min}–${config.range_max}`);
    }
  }
  if (moduleId === ModuleEnum.COUNTER && Number(config.start)) {
    parts.push(`${t("utility.summary_counter_start")} ${config.start}`);
  }
  if (moduleId === ModuleEnum.CLOCK && config.hour_cycle === "12h") parts.push("12 h");
  if (autoStart && utilitySpec(moduleId)?.canAutoStart) parts.push(t("utility.auto_start_short"));
  return parts.join(" · ");
}
