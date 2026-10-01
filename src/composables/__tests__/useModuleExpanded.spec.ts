import { describe, it, expect, beforeEach } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import {
  isModuleExpanded,
  setModuleExpanded,
  toggleModuleExpanded,
  useShellExpanded,
} from "@/composables/useModuleExpanded";
import $appdata from "@/helpers/AppData";
import { ModuleEnum } from "@/enums/ModuleEnum";

/**
 * Expandir esconde o ribbon e as abas de módulo. A escolha é do módulo e fica
 * gravada, mas só vale enquanto a aba dele está ativa: ao trocar de aba o
 * operador precisa do ribbon de volta, sem perder a preferência.
 */
describe("useModuleExpanded", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    $appdata.set("active_module", null);
  });

  it("alterna a preferência do módulo", () => {
    expect(isModuleExpanded(ModuleEnum.PRESENTATION_MODE)).toBe(false);
    toggleModuleExpanded(ModuleEnum.PRESENTATION_MODE);
    expect(isModuleExpanded(ModuleEnum.PRESENTATION_MODE)).toBe(true);
    toggleModuleExpanded(ModuleEnum.PRESENTATION_MODE);
    expect(isModuleExpanded(ModuleEnum.PRESENTATION_MODE)).toBe(false);
  });

  it("só expande o shell com a aba do módulo ativa", () => {
    const { isExpanded } = useShellExpanded();
    setModuleExpanded(ModuleEnum.PRESENTATION_MODE, true);

    $appdata.set("active_module", ModuleEnum.PRESENTATION_MODE);
    expect(isExpanded.value).toBe(true);

    $appdata.set("active_module", ModuleEnum.LITURGY);
    expect(isExpanded.value).toBe(false);
    expect(isModuleExpanded(ModuleEnum.PRESENTATION_MODE)).toBe(true);
  });

  it("ignora módulos que não se expandem", () => {
    setModuleExpanded(ModuleEnum.LITURGY, true);
    expect(isModuleExpanded(ModuleEnum.LITURGY)).toBe(false);
  });
});
