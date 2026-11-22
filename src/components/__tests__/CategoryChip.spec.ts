import { describe, expect, it } from "vitest";
import { nextTick } from "vue";
import CategoryChip from "@/components/CategoryChip.vue";
import { mountUi } from "@/components/ui/__tests__/mountUi";

function montar(overrides: Record<string, unknown> = {}) {
  return mountUi(CategoryChip, {
    props: {
      categoryId: "cat1",
      name: "Culto",
      icon: "folder",
      iconType: "icon",
      color: "#4caf50",
      count: 3,
      ...overrides,
    },
  });
}

describe("CategoryChip", () => {
  it("mostra nome, contador, estado ativo e alvo de drop", () => {
    const wrapper = montar({ active: true, dropTarget: true });

    const chip = wrapper.find(".lj-category-chip");

    expect(chip.text()).toContain("Culto");
    expect(chip.find(".lj-category-chip__count").text()).toBe("3");
    expect(chip.classes()).toContain("lj-category-chip--active");
    expect(chip.classes()).toContain("lj-category-chip--drop-target");
    expect(chip.attributes("data-category-drop-id")).toBe("cat1");
  });

  it("emite select ao clicar", async () => {
    const wrapper = montar();

    await wrapper.find(".lj-category-chip").trigger("click");

    expect(wrapper.emitted("select")).toHaveLength(1);
  });

  it("abre as opções de contexto sem editar a categoria virtual", async () => {
    const wrapper = montar({
      addItemLabel: "Adicionar item",
      editLabel: "Editar Categoria",
      editable: false,
    });

    await wrapper.find(".lj-category-chip").trigger("contextmenu", {
      clientX: 20,
      clientY: 20,
    });
    await nextTick();

    const menu = document.body.querySelector(".lj-category-chip__menu");
    expect(menu).not.toBeNull();
    expect(menu?.querySelectorAll(".lj-menu__item")).toHaveLength(1);
    expect(menu?.textContent).toContain("Adicionar item");
    expect(menu?.textContent).not.toContain("Editar Categoria");

    (menu?.querySelector(".lj-menu__item") as HTMLElement | null)?.click();
    await nextTick();
    expect(wrapper.emitted("add")).toHaveLength(1);
  });

  it("emite edição ao escolher Editar Categoria", async () => {
    const wrapper = montar({
      addItemLabel: "Adicionar item",
      editLabel: "Editar Categoria",
    });

    await wrapper.find(".lj-category-chip").trigger("contextmenu");
    await nextTick();
    const items = document.body.querySelectorAll(".lj-category-chip__menu .lj-menu__item");
    expect(items).toHaveLength(2);

    (items[1] as HTMLElement).click();
    await nextTick();
    expect(wrapper.emitted("edit")).toHaveLength(1);
  });

  it("oferece adicionar todos os itens da categoria quando ela não está vazia", async () => {
    const wrapper = montar({
      addItemLabel: "Adicionar item",
      addAllLabel: "Adicionar tudo à playlist",
      count: 2,
      editable: false,
    });

    await wrapper.find(".lj-category-chip").trigger("contextmenu");
    await nextTick();

    const menus = document.body.querySelectorAll(".lj-category-chip__menu");
    const menu = menus[menus.length - 1];
    const items = menu.querySelectorAll(".lj-menu__item");
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain("Adicionar tudo à playlist");

    (items[0] as HTMLElement).click();
    await nextTick();
    expect(wrapper.emitted("add-all")).toHaveLength(1);
  });

  it("esconde adicionar tudo quando a categoria está vazia", async () => {
    const wrapper = montar({
      addItemLabel: "Adicionar item",
      addAllLabel: "Adicionar tudo à playlist",
      count: 0,
      editable: false,
    });

    await wrapper.find(".lj-category-chip").trigger("contextmenu");
    await nextTick();

    const menus = document.body.querySelectorAll(".lj-category-chip__menu");
    const menu = menus[menus.length - 1];
    expect(menu.querySelectorAll(".lj-menu__item")).toHaveLength(1);
    expect(menu.textContent).not.toContain("Adicionar tudo à playlist");
  });

  it("não abre o menu quando showMenu é false", async () => {
    const wrapper = montar({ showMenu: false, addItemLabel: "Adicionar item" });
    const before = document.body.querySelectorAll(".lj-category-chip__menu").length;

    await wrapper.find(".lj-category-chip").trigger("contextmenu", {
      clientX: 20,
      clientY: 20,
    });
    await nextTick();

    expect(document.body.querySelectorAll(".lj-category-chip__menu").length).toBe(before);
  });

  it("não desenha botão de adicionar no chip", () => {
    const wrapper = montar();

    expect(wrapper.find(".lj-category-chip__add").exists()).toBe(false);
    expect(wrapper.find(".lj-category-chip").findAll("button")).toHaveLength(0);
  });
});
