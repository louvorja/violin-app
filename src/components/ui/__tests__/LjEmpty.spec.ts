import { describe, expect, it } from "vitest";
import LjEmpty from "../LjEmpty.vue";
import { mountUi } from "./mountUi";

const TITULO = ".lj-empty__title";
const DESC = ".lj-empty__desc";
const ICONE = ".lj-empty__icon";
const ACOES = ".lj-empty__actions";

describe("LjEmpty", () => {
  it("mostra o título mesmo quando é a única coisa informada", () => {
    const w = mountUi(LjEmpty, { props: { title: "Nenhuma música na playlist" } });
    expect(w.find(TITULO).exists()).toBe(true);
    expect(w.find(TITULO).text()).toBe("Nenhuma música na playlist");
  });

  it("sem descrição, ícone e ações o estado vazio fica só com o título", () => {
    // Trava o defeito conhecido: título é incondicional; descrição, ícone e
    // ações só existem quando informados. Se algum deles voltar a renderizar
    // vazio, sobra caixa/gap visível na tela do operador.
    const w = mountUi(LjEmpty, { props: { title: "Nada aqui" } });
    expect(w.find(DESC).exists()).toBe(false);
    expect(w.find(ICONE).exists()).toBe(false);
    expect(w.find(ACOES).exists()).toBe(false);
    expect(w.text()).toBe("Nada aqui");
  });

  it("mostra a descrição quando informada, sem substituir o título", () => {
    const w = mountUi(LjEmpty, {
      props: {
        title: "Nenhum favorito",
        description: "Marque uma música com a estrela para vê-la aqui.",
      },
    });
    expect(w.find(TITULO).text()).toBe("Nenhum favorito");
    expect(w.find(DESC).text()).toBe("Marque uma música com a estrela para vê-la aqui.");
  });

  it("mostra o ícone quando informado e nada quando não é", () => {
    const comIcone = mountUi(LjEmpty, { props: { title: "Sem mídia", icon: "music-off" } });
    expect(comIcone.find(ICONE).exists()).toBe(true);
    // O ícone é um SVG embutido: o nome pedido sai no rótulo acessível.
    expect(comIcone.find(ICONE).attributes("aria-label")).toBe("music-off");

    const semIcone = mountUi(LjEmpty, { props: { title: "Sem mídia" } });
    expect(semIcone.find(ICONE).exists()).toBe(false);
  });

  it("trata ícone e descrição vazios como ausentes", () => {
    const w = mountUi(LjEmpty, { props: { title: "Nada aqui", icon: "", description: "" } });
    expect(w.find(ICONE).exists()).toBe(false);
    expect(w.find(DESC).exists()).toBe(false);
  });

  it("renderiza as ações do slot e só então cria o bloco de ações", () => {
    const semSlot = mountUi(LjEmpty, { props: { title: "Nada aqui" } });
    expect(semSlot.find(ACOES).exists()).toBe(false);

    const comSlot = mountUi(LjEmpty, {
      props: { title: "Nada aqui" },
      slots: { default: "<button>Baixar coletânea</button>" },
    });
    expect(comSlot.find(ACOES).exists()).toBe(true);
    expect(comSlot.find(`${ACOES} button`).text()).toBe("Baixar coletânea");
  });

  it("agrupa várias ações no mesmo bloco", () => {
    const w = mountUi(LjEmpty, {
      props: { title: "Nada aqui" },
      slots: { default: "<button>Baixar</button><button>Cancelar</button>" },
    });
    expect(w.findAll(ACOES)).toHaveLength(1);
    expect(w.findAll(`${ACOES} button`)).toHaveLength(2);
  });

  it("mantém a ordem de leitura: ícone, título, descrição e ações", () => {
    const w = mountUi(LjEmpty, {
      props: { title: "Nenhum resultado", description: "Tente outro termo.", icon: "search" },
      slots: { default: "<button>Limpar busca</button>" },
    });
    const partes = [ICONE, TITULO, DESC, ACOES];
    // Casar por seletor, não pela primeira classe do elemento: o ícone carrega
    // também a classe do próprio primitivo, e a ordem delas não é contrato.
    const ordem = Array.from(w.element.children).map((el) => {
      const alvo = el as HTMLElement;
      return partes.find((sel) => alvo.matches(sel)) ?? alvo.className;
    });
    expect(ordem).toEqual(partes);
  });

  it("acompanha a troca de props: descrição aparece e some", async () => {
    const w = mountUi(LjEmpty, { props: { title: "Nenhum item" } });
    expect(w.find(DESC).exists()).toBe(false);

    await w.setProps({ description: "Adicione um item à liturgia." });
    expect(w.find(DESC).text()).toBe("Adicione um item à liturgia.");

    await w.setProps({ description: undefined });
    expect(w.find(DESC).exists()).toBe(false);
  });

  it("acompanha a troca do título", async () => {
    const w = mountUi(LjEmpty, { props: { title: "Nenhum item" } });
    await w.setProps({ title: "Nenhum resultado" });
    expect(w.find(TITULO).text()).toBe("Nenhum resultado");
  });

  it("repassa atributos do consumidor à raiz — inclusive o papel de live region", () => {
    const w = mountUi(LjEmpty, {
      props: { title: "Nenhum resultado" },
      attrs: { role: "status", "data-testid": "vazio-busca" },
    });
    expect(w.attributes("role")).toBe("status");
    expect(w.attributes("data-testid")).toBe("vazio-busca");
  });

  it("não é interativo por conta própria: nada de botão ou link fora do slot", () => {
    const w = mountUi(LjEmpty, {
      props: { title: "Nada aqui", description: "Sem itens.", icon: "search" },
    });
    expect(w.findAll("button")).toHaveLength(0);
    expect(w.findAll("a")).toHaveLength(0);
  });
});

// Fora do alcance do jsdom / do componente:
// - i18n: LjEmpty não traduz nenhum rótulo próprio — título, descrição e ações
//   chegam prontos do consumidor. Não há chave a travar com expectKeyExists.
// - Contrato de tamanho: o primitivo não tem prop `size`, então não há classe
//   lj-ui-size-* a verificar.
// - v-model e estado desabilitado: LjEmpty é puramente apresentacional, não tem
//   valor próprio nem prop `disabled`.
// - Aparência (borda tracejada, espaçamentos, cor do ícone, largura máxima de
//   44ch da descrição) vive só no CSS scoped, que o jsdom não resolve.
