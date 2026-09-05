import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import Icon from "@/components/Icon.vue";

/**
 * O ramo SVG recebe a cor como CSS puro. Um nome de tema do Vuetify ("primary")
 * é válido no <v-icon> e inválido no style — o browser descarta sem avisar e o
 * ícone herda a cor do pai. Como o acervo migra para SVG, estes testes fixam a
 * tradução que impede a cor de sumir em silêncio.
 */
describe("Icon — cor no ramo SVG", () => {
  const estilo = (color: string) =>
    mount(Icon, { props: { icon: "church", color } }).find(".lj-icon").attributes("style") ?? "";

  it("traduz nome de tema para token do projeto", () => {
    expect(estilo("primary")).toContain("var(--lj-ui-accent)");
    expect(estilo("success")).toContain("var(--lj-success)");
    expect(estilo("error")).toContain("var(--lj-danger)");
    expect(estilo("grey")).toContain("var(--lj-text-muted)");
  });

  it("deixa passar cor que já é CSS válido", () => {
    // o jsdom normaliza hexadecimal para rgb() ao serializar o style
    expect(estilo("#e74c3c")).toContain("rgb(231, 76, 60)");
    expect(estilo("currentColor").toLowerCase()).toContain("currentcolor");
  });

  it("não inventa cor quando nenhuma foi pedida", () => {
    const html = mount(Icon, { props: { icon: "church" } }).find(".lj-icon").attributes("style") ?? "";
    expect(html).not.toContain("color:");
  });
});
