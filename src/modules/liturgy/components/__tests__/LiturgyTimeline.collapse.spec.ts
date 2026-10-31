/**
 * Recolher/expandir um bloco da timeline.
 *
 * O botão fica no canto direito do cabeçalho e é sempre visível (no toque não
 * existe hover). O recolhimento esconde apenas os itens VINCULADOS ao bloco
 * (`blocoId`), não os soltos que aparecem na mesma seção — é o modelo de dados,
 * e é o que a tela tem de respeitar.
 */
import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";

vi.mock("vuedraggable", () => ({
  default: {
    props: ["modelValue"],
    template: `<div class="draggable-stub"><template v-for="(el, i) in modelValue" :key="el.id"><slot name="item" :element="el" :index="i" /></template></div>`,
  },
}));
vi.mock("../LiturgyItem.vue", () => ({
  default: {
    props: ["element"],
    template: `<div class="lit-item-stub">{{ element.item }}</div>`,
  },
}));
vi.mock("../../i18n", () => ({
  useLiturgyI18n: () => ({ t: (key: string) => key }),
}));
vi.mock("@/helpers/ScrollMemory", () => ({
  setScrollPosition: vi.fn(),
  restoreScrollPosition: vi.fn(),
}));

import LiturgyTimeline from "../LiturgyTimeline.vue";

type Item = {
  id: string;
  tipo: string;
  item: string;
  duration?: number;
  cor?: string;
  blocoId?: string;
};

const bloco = (id: string, nome: string): Item => ({
  id,
  tipo: "bloco",
  item: nome,
  cor: "#00004F",
  duration: 0,
});
const filho = (id: string, blocoId?: string): Item => ({
  id,
  tipo: "anotacao",
  item: `Item ${id}`,
  duration: 1,
  ...(blocoId ? { blocoId } : {}),
});

const ITENS: Item[] = [
  bloco("b1", "Bloco Um"),
  filho("i1", "b1"),
  filho("i2", "b1"),
  /* Solto: aparece sob o cabeçalho, mas não pertence ao bloco. */
  filho("solto"),
  bloco("b2", "Bloco Dois"),
  filho("i3", "b2"),
];

function montar() {
  return mount(LiturgyTimeline, {
    props: {
      items: ITENS as never,
      isChecked: () => false,
      subtitleFor: () => "",
      onReorder: vi.fn(),
      openItemDialog: vi.fn(),
      cloneItem: vi.fn(),
      confirmRemove: vi.fn(),
      executeItem: vi.fn(),
      playMusic: vi.fn(),
      openLyric: vi.fn(),
      changeColor: vi.fn(),
      toggleChecked: vi.fn(),
    },
  });
}

/** O invólucro animado: é ele que recolhe (classe), não o cartão. */
const colapso = (wrapper: ReturnType<typeof montar>, id: string) =>
  wrapper.find(`[data-item-id="${id}"] .tl-collapse`);

const botoesRecolher = (wrapper: ReturnType<typeof montar>) =>
  wrapper.findAll(".tl-bloco-collapse");

describe("bloco: recolher e expandir", () => {
  it("começa tudo expandido", () => {
    const wrapper = montar();

    expect(botoesRecolher(wrapper)).toHaveLength(2);
    expect(wrapper.find(".tl-collapse--closed").exists()).toBe(false);
    expect(botoesRecolher(wrapper)[0].attributes("aria-expanded")).toBe("true");
  });

  it("recolher esconde os itens vinculados do bloco", async () => {
    const wrapper = montar();

    await botoesRecolher(wrapper)[0].trigger("click");

    expect(colapso(wrapper, "i1").classes()).toContain("tl-collapse--closed");
    expect(colapso(wrapper, "i2").classes()).toContain("tl-collapse--closed");
  });

  it("item solto na mesma seção NÃO é escondido", async () => {
    const wrapper = montar();

    await botoesRecolher(wrapper)[0].trigger("click");

    /* Ele não tem `blocoId`: está sob o cabeçalho, mas não é do bloco. */
    expect(colapso(wrapper, "solto").classes()).not.toContain("tl-collapse--closed");
  });

  it("os blocos recolhem de forma independente", async () => {
    const wrapper = montar();

    await botoesRecolher(wrapper)[0].trigger("click");

    expect(colapso(wrapper, "i3").classes()).not.toContain("tl-collapse--closed");
  });

  it("o segundo clique reexpande e o aria acompanha", async () => {
    const wrapper = montar();
    const botao = botoesRecolher(wrapper)[0];

    await botao.trigger("click");
    expect(botao.attributes("aria-expanded")).toBe("false");

    await botao.trigger("click");
    expect(botao.attributes("aria-expanded")).toBe("true");
    expect(colapso(wrapper, "i1").classes()).not.toContain("tl-collapse--closed");
  });
});
