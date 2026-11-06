import Hotkeys from "@/helpers/Hotkeys";
import { getModule } from "@/config/modules";
import { ICONS } from "@/config/Icons";
import {
  STARTUP_FEATURE_TIPS,
  STARTUP_MODULE_TIPS,
  STARTUP_SHORTCUT_TIPS,
} from "@/config/StartupTips";
import type { ModuleEnum } from "@/enums/ModuleEnum";

export interface StartupShortcutTip {
  kind: "shortcut";
  id: string;
  combo: string;
  parts: string[];
  descriptionKey: string;
  detailKey: string;
}

export interface StartupModuleTip {
  kind: "module";
  id: string;
  moduleId: ModuleEnum;
  titleKey: string;
  bodyKey: string;
  icon: string;
}

export interface StartupFeatureTip {
  kind: "feature";
  id: string;
  titleKey: string;
  bodyKey: string;
  icon: string;
}

export type StartupTip = StartupShortcutTip | StartupModuleTip | StartupFeatureTip;

type ShortcutEntry = {
  combo?: string;
  parts?: string[];
  description?: string;
};

export function buildStartupTips(shortcuts: ShortcutEntry[] = Hotkeys.list()): StartupTip[] {
  const definitions = new Map(
    STARTUP_SHORTCUT_TIPS.map((definition) => [definition.descriptionKey, definition])
  );
  const seen = new Set<string>();
  const shortcutTips: StartupShortcutTip[] = [];

  for (const entry of shortcuts) {
    if (!entry.description || seen.has(entry.description)) continue;
    const definition = definitions.get(entry.description);
    if (!definition) continue;
    if (!Array.isArray(entry.parts) || entry.parts.length === 0) continue;
    seen.add(entry.description);
    shortcutTips.push({
      kind: "shortcut",
      id: `shortcut:${entry.description}`,
      combo: entry.combo ?? entry.parts.join("+"),
      parts: [...entry.parts],
      descriptionKey: entry.description,
      detailKey: definition.detailKey,
    });
  }

  const moduleTips: StartupModuleTip[] = STARTUP_MODULE_TIPS.map((tip) => {
    const manifest = getModule(tip.moduleId);
    return {
      kind: "module",
      id: `module:${tip.id}`,
      moduleId: tip.moduleId,
      titleKey: manifest?.title ?? `modules.${tip.id}.title`,
      bodyKey: `startup_tips.items.${tip.id}.body`,
      icon: manifest?.icon ?? ICONS.CATEGORY.SPARKLES,
    };
  });

  const featureTips: StartupFeatureTip[] = STARTUP_FEATURE_TIPS.map((tip) => ({
    kind: "feature",
    id: `feature:${tip.id}`,
    titleKey: `startup_tips.features.${tip.id}.title`,
    bodyKey: `startup_tips.features.${tip.id}.body`,
    icon: tip.icon,
  }));

  return [...shortcutTips, ...moduleTips, ...featureTips];
}

export function pickStartupTip(
  random: () => number = Math.random,
  tips: StartupTip[] = buildStartupTips()
): StartupTip | null {
  if (tips.length === 0) return null;
  const index = Math.min(tips.length - 1, Math.max(0, Math.floor(random() * tips.length)));
  return tips[index] ?? null;
}
