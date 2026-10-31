import { describe, expect, it } from "vitest";
import { nextCategorySelection } from "@/helpers/CategorySelection";

describe("nextCategorySelection", () => {
  it("ao criar, exibe somente a categoria criada", () => {
    const atual = new Set(["a", "b"]);
    expect(nextCategorySelection(atual, "nova", true)).toEqual(new Set(["nova"]));
  });

  it("ao editar, preserva as categorias ocultas", () => {
    // "b" foi desmarcada pelo usuário e precisa continuar oculta.
    const atual = new Set(["a"]);
    expect(nextCategorySelection(atual, "a", false)).toEqual(new Set(["a"]));
  });

  it("editar uma categoria oculta não a reexibe", () => {
    const atual = new Set(["a"]);
    expect(nextCategorySelection(atual, "b", false)).toEqual(new Set(["a"]));
  });

  it("não compartilha a referência do conjunto original", () => {
    const atual = new Set(["a"]);
    const proximo = nextCategorySelection(atual, "a", false);
    proximo.add("b");
    expect(atual).toEqual(new Set(["a"]));
  });
});
