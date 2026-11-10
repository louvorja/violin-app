import { describe, expect, it } from "vitest";
import { buildStartupTips, pickStartupTip } from "../StartupTips";
import {
  STARTUP_FEATURE_TIPS,
  STARTUP_MODULE_TIPS,
  STARTUP_SHORTCUT_DESCRIPTIONS,
  STARTUP_SHORTCUT_TIPS,
} from "@/config/StartupTips";
import { expectKeyExists } from "@/components/ui/__tests__/mountUi";

describe("StartupTips", () => {
  const shortcuts = [
    {
      combo: "Ctrl+k",
      parts: ["Ctrl", "K"],
      description: "hotkeys.ctrl_k",
    },
    {
      combo: "Ctrl+Shift+n",
      parts: ["Ctrl", "Shift", "N"],
      description: "hotkeys.ctrl_shift_n",
    },
    {
      combo: "Ctrl+f",
      parts: ["Ctrl", "F"],
      description: "hotkeys.ctrl_f",
    },
  ];

  it("reutiliza só os atalhos da lista curada e os módulos", () => {
    const tips = buildStartupTips(shortcuts);
    const shortcutTips = tips.filter((tip) => tip.kind === "shortcut");
    const moduleTips = tips.filter((tip) => tip.kind === "module");
    const featureTips = tips.filter((tip) => tip.kind === "feature");

    expect(shortcutTips.map((tip) => tip.descriptionKey)).toEqual([
      "hotkeys.ctrl_k",
      "hotkeys.ctrl_shift_n",
    ]);
    expect(shortcutTips[0].parts).toEqual(["Ctrl", "K"]);
    expect(shortcutTips[0].detailKey).toBe("startup_tips.shortcut_details.ctrl_k");
    expect(moduleTips).toHaveLength(STARTUP_MODULE_TIPS.length);
    expect(moduleTips[0]).toMatchObject({
      kind: "module",
      moduleId: "musics",
      bodyKey: "startup_tips.items.musics.body",
    });
    expect(featureTips).toHaveLength(STARTUP_FEATURE_TIPS.length);
    expect(featureTips[0]).toMatchObject({
      kind: "feature",
      id: "feature:canva",
      titleKey: "startup_tips.features.canva.title",
      bodyKey: "startup_tips.features.canva.body",
    });
  });

  it("sorteia uma dica do catálogo e aceita os extremos do índice", () => {
    const tips = buildStartupTips(shortcuts);
    expect(pickStartupTip(() => 0, tips)).toBe(tips[0]);
    expect(pickStartupTip(() => 0.999, tips)).toBe(tips[tips.length - 1]);
  });

  it("não devolve dica quando o catálogo está vazio", () => {
    expect(pickStartupTip(() => 0.5, [])).toBeNull();
  });

  it("tem traduções para os rótulos, atalhos e módulos", () => {
    expectKeyExists("startup_tips.title");
    expectKeyExists("startup_tips.shortcut_label");
    expectKeyExists("startup_tips.module_label");
    expectKeyExists("startup_tips.dont_show_again");
    expectKeyExists("options.general.show_startup_tips");
    for (const description of STARTUP_SHORTCUT_DESCRIPTIONS) expectKeyExists(description);
    for (const shortcut of STARTUP_SHORTCUT_TIPS) expectKeyExists(shortcut.detailKey);
    for (const tip of STARTUP_MODULE_TIPS) {
      expectKeyExists(`startup_tips.items.${tip.id}.body`);
    }
    for (const tip of STARTUP_FEATURE_TIPS) {
      expectKeyExists(`startup_tips.features.${tip.id}.title`);
      expectKeyExists(`startup_tips.features.${tip.id}.body`);
    }
  });
});
