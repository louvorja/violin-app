import { beforeAll, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import CategoryManagerDialog from "../CategoryManagerDialog.vue";
import { expectKeyExists, mountUi } from "@/components/ui/__tests__/mountUi";

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
});

vi.mock("@/helpers/Alert", () => ({
  default: { confirm: vi.fn(async () => true) },
}));

type Categoria = {
  id: string;
  name: string;
  icon: string;
  iconType: "icon" | "image";
  color: string;
};

const CATEGORIAS: Categoria[] = [
  { id: "cat-1", name: "Culto", icon: "bible", iconType: "icon", color: "#4CAF50" },
  { id: "cat-2", name: "Ensaios", icon: "music", iconType: "icon", color: "#2196F3" },
];

function montar(categories: Categoria[] = CATEGORIAS) {
  return mountUi(CategoryManagerDialog, {
    props: {
      modelValue: true,
      categories,
      saving: false,
      moduleId: "media_library",
    },
    global: {
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

const campoNome = (wrapper: ReturnType<typeof montar>) => wrapper.find("input:not([type='file'])");

async function abrirNova(wrapper: ReturnType<typeof montar>) {
  const nova = wrapper.findAll("button").find((botao) => botao.text().includes("Nova categoria"))!;
  await nova.trigger("click");
}

describe("CategoryManagerDialog — nomes duplicados", () => {
  it("bloqueia criar categoria com o mesmo nome, sem diferenciar caixa/espaços", async () => {
    const wrapper = montar();
    await abrirNova(wrapper);
    await campoNome(wrapper).setValue("  cULto  ");

    expect(wrapper.text()).toContain("Já existe uma categoria com esse nome.");
    expect(campoNome(wrapper).attributes("aria-invalid")).toBe("true");
    expect(botaoSalvar(wrapper).attributes("disabled")).toBeDefined();

    await botaoSalvar(wrapper).trigger("click");
    expect(wrapper.emitted("save")).toBeUndefined();
  });

  it("permite salvar a própria categoria ao editar, mesmo mudando a caixa", async () => {
    const wrapper = montar();
    (wrapper.vm as unknown as { openEditCategory: (_cat: Categoria) => void }).openEditCategory(
      CATEGORIAS[0]
    );
    await nextTick();
    await campoNome(wrapper).setValue(" CULTO ");

    expect(wrapper.text()).not.toContain("Já existe uma categoria com esse nome.");
    expect(botaoSalvar(wrapper).attributes("disabled")).toBeUndefined();

    await botaoSalvar(wrapper).trigger("click");
    expect(wrapper.emitted("save")?.[0]?.[0]).toMatchObject({ id: "cat-1", name: "CULTO" });
  });

  it("bloqueia renomear uma categoria para o nome de outra", async () => {
    const wrapper = montar();
    (wrapper.vm as unknown as { openEditCategory: (_cat: Categoria) => void }).openEditCategory(
      CATEGORIAS[0]
    );
    await nextTick();
    await campoNome(wrapper).setValue("ensaios");

    expect(wrapper.text()).toContain("Já existe uma categoria com esse nome.");
    expect(botaoSalvar(wrapper).attributes("disabled")).toBeDefined();

    await botaoSalvar(wrapper).trigger("click");
    expect(wrapper.emitted("save")).toBeUndefined();
  });

  it("a mensagem existe em pt e es", () => {
    expectKeyExists("shell.category.duplicate_name");
  });
});
