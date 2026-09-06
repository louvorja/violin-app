import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import LjIcon from "@/components/ui/LjIcon.vue";

/**
 * A cor chega como CSS puro. Um nome de tema do Vuetify ("primary") é inválido
 * no style — o browser descarta sem avisar e o ícone herda a cor do pai. Estes
 * testes fixam a tradução que impede a cor de sumir em silêncio.
 */
describe("LjIcon — cor", () => {
  const estilo = (color: string) =>
    mount(LjIcon, { props: { icon: "church", color } }).find(".lj-icon").attributes("style") ?? "";

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
    const html = mount(LjIcon, { props: { icon: "church" } }).find(".lj-icon").attributes("style") ?? "";
    expect(html).not.toContain("color:");
  });
});

/**
 * Dois acervos atrás da mesma prop: quem chama passa um nome e não sabe se o
 * desenho veio do pacote ou de arquivo. Se um dos caminhos parar, a tela some o
 * ícone sem erro no console — daí os dois estarem fixados aqui.
 */
describe("LjIcon — procedência do desenho", () => {
  it("desenha ícone de interface vindo do pacote", () => {
    const w = mount(LjIcon, { props: { icon: "player-play" } });
    expect(w.find("svg").exists()).toBe(true);
    expect(w.find("svg").attributes("stroke")).toBe("currentColor");
  });

  it("desenha marca do projeto vinda de arquivo", () => {
    const w = mount(LjIcon, { props: { icon: "ja" } });
    expect(w.find("svg").exists()).toBe(true);
  });

  it("respeita o tamanho pedido nos dois caminhos", () => {
    for (const icon of ["player-play", "ja"]) {
      const estilo = mount(LjIcon, { props: { icon, size: 32 } }).find(".lj-icon").attributes("style");
      expect(estilo).toContain("32px");
    }
  });

  it("não renderiza nada quando o nome não existe em lugar nenhum", () => {
    const w = mount(LjIcon, { props: { icon: "nao-existe-em-lugar-nenhum" } });
    expect(w.find(".lj-icon").exists()).toBe(false);
  });
});
