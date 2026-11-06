import { beforeEach, describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import ModuleContainer from "../ModuleContainer.vue";
import { makeI18n } from "@/components/ui/__tests__/mountUi";
import AppData from "@/helpers/AppData";

describe("ModuleContainer.tm", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    AppData.set("modules.testmod", { id: "testmod", show: false });
  });

  it("usa a chave global quando ela não existe no módulo", () => {
    const wrapper = mount(ModuleContainer, {
      props: { manifest: { id: "testmod", name: "Teste" }, title: "Teste" },
      global: { plugins: [makeI18n("pt")] },
    });

    expect(
      (
        wrapper.vm as unknown as { t: (_key: string, _named?: Record<string, unknown>) => string }
      ).t("moved_to_category", { category: "Culto" })
    ).toBe("Movido para “Culto”");
  });
});
