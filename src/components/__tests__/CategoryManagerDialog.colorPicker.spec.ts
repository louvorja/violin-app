import { beforeAll, describe, expect, it, vi } from "vitest";
import CategoryManagerDialog from "../CategoryManagerDialog.vue";
import { LjColorPicker } from "@/components/ui";
import { mountUi } from "@/components/ui/__tests__/mountUi";

/* O Listbox das cores rola até o item destacado; no jsdom só precisa existir. */
beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
});

vi.mock("@/helpers/Alert", () => ({
  default: { confirm: vi.fn(async () => true) },
}));

const PRESETS = ["#4CAF50", "#2196F3"];

function montar() {
  return mountUi(CategoryManagerDialog, {
    props: {
      modelValue: true,
      categories: [],
      saving: false,
      iconOptions: [{ value: "bible" }, { value: "cross" }],
      colorPresets: PRESETS,
      moduleId: "teste",
    },
    global: {
      // O conteúdo e o rodapé dos dois diálogos ficam visíveis para o teste.
      stubs: {
        LjDialog: {
          props: ["modelValue", "title"],
          template: "<div><slot /><slot name='footer' /></div>",
        },
      },
    },
  });
}

const botaoSalvar = (wrapper: ReturnType<typeof montar>) =>
  wrapper.findAll("button").find((botao) => botao.text() === "Salvar")!;

describe("CategoryManagerDialog — seletor de cor da categoria", () => {
  it("usa o LjColorPicker com as cores rápidas do módulo", () => {
    const wrapper = montar();
    const picker = wrapper.findComponent(LjColorPicker);
    expect(picker.exists()).toBe(true);
    expect(picker.props("presets")).toEqual(PRESETS);
    expect(picker.props("modelValue")).toBe(PRESETS[0]);
  });

  it("a cor personalizada escolhida é a que o salvar entrega", async () => {
    const wrapper = montar();
    const nova = wrapper
      .findAll("button")
      .find((botao) => botao.text().includes("Nova categoria"))!;
    await nova.trigger("click");
    await wrapper.find("input:not([type='file'])").setValue("Nova categoria");

    await wrapper.find('[data-color="#2196f3"]').trigger("click");
    await botaoSalvar(wrapper).trigger("click");

    expect(wrapper.emitted("save")?.[0]?.[0]).toMatchObject({
      name: "Nova categoria",
      icon: "bible",
      iconType: "icon",
      color: "#2196f3",
    });
  });
});
