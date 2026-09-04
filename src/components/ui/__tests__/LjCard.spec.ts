import { describe, expect, it } from "vitest";
import LjCard from "../LjCard.vue";
import { mountUi } from "./mountUi";

describe("LjCard", () => {
  it("sem título e sem slot de cabeçalho, não desenha cabeçalho vazio", () => {
    const w = mountUi(LjCard, { slots: { default: "conteúdo" } });
    expect(w.find(".lj-card__header").exists()).toBe(false);
    expect(w.text()).toContain("conteúdo");
  });

  it("mostra o título quando informado", () => {
    const w = mountUi(LjCard, { props: { title: "Progresso" } });
    expect(w.get(".lj-card__title").text()).toBe("Progresso");
  });

  it("cabeçalho próprio substitui o título padrão", () => {
    const w = mountUi(LjCard, {
      props: { title: "Ignorado" },
      slots: { header: "<span class='meu'>Meu cabeçalho</span>" },
    });
    expect(w.find(".meu").exists()).toBe(true);
    expect(w.find(".lj-card__title").exists()).toBe(false);
  });

  it("slot de ações só aparece quando preenchido", () => {
    const sem = mountUi(LjCard, { props: { title: "X" } });
    expect(sem.find(".lj-card__actions").exists()).toBe(false);

    const com = mountUi(LjCard, {
      props: { title: "X" },
      slots: { actions: "<button>Editar</button>" },
    });
    expect(com.get(".lj-card__actions").text()).toBe("Editar");
  });

  it("rodapé só aparece quando preenchido", () => {
    const sem = mountUi(LjCard, { slots: { default: "corpo" } });
    expect(sem.find(".lj-card__footer").exists()).toBe(false);

    const com = mountUi(LjCard, { slots: { default: "corpo", footer: "<button>OK</button>" } });
    expect(com.get(".lj-card__footer").text()).toBe("OK");
  });

  it("variantes soft e flush marcam a superfície", () => {
    expect(mountUi(LjCard, { props: { soft: true } }).classes()).toContain("lj-card--soft");
    expect(mountUi(LjCard, { props: { flush: true } }).classes()).toContain("lj-card--flush");
    expect(mountUi(LjCard).classes()).not.toContain("lj-card--soft");
  });

  it("é uma <section>, não uma div genérica", () => {
    expect(mountUi(LjCard).element.tagName).toBe("SECTION");
  });
});
