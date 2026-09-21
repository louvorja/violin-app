import { afterEach, beforeAll, describe, expect, it } from "vitest";
import LjCombobox from "../LjCombobox.vue";
import { expectKeyExists, mountUi } from "./mountUi";
import es from "@/lang/es.json";
import pt from "@/lang/pt.json";

/**
 * O conteúdo do combobox vai para um portal no <body>, fora do wrapper — por
 * isso tudo é montado com `attachTo: document.body` e a lista é consultada em
 * `document`, não em `wrapper.find`.
 *
 * A lista é virtual, e o virtualizador só desenha as linhas que cabem na altura
 * do contêiner, lida de `offsetHeight`. O jsdom não faz layout e devolve 0, o que
 * esvaziaria a lista — por isso o `beforeAll` dá uma altura ao painel. Quem monta
 * um combobox em outro teste precisa do mesmo.
 *
 * Fora de teste (jsdom não é navegador):
 * - posicionamento do popper, medidas e transições;
 * - fechar ao clicar fora / ao perder o foco (depende de ponteiro real e de
 *   requestAnimationFrame dentro do Reka);
 * - rolagem até o item destacado (`scrollIntoView` é apenas um stub aqui).
 *
 * Sem teste de nome acessível: o primitivo não oferece como dar nome ao campo —
 * `aria-label` cai na div raiz (sem papel), não no input `role="combobox"`.
 */

const montados: Array<{ unmount: () => void }> = [];
const passar = () => new Promise((r) => setTimeout(r, 0));

const ALTURA_PAINEL = 280;

beforeAll(() => {
  // O Reka rola até o item destacado ao abrir; jsdom não implementa isso.
  Element.prototype.scrollIntoView = () => {};
  // O virtualizador mede o contêiner por offsetHeight/offsetWidth.
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get: () => ALTURA_PAINEL,
  });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get: () => 300,
  });
});

afterEach(() => {
  while (montados.length) montados.pop()?.unmount();
  document.body.innerHTML = "";
});

function montar(props: Record<string, unknown> = {}, locale: "pt" | "es" = "pt") {
  const w = mountUi(LjCombobox, { attachTo: document.body, props }, locale);
  montados.push(w);
  return w;
}

function campo(w: ReturnType<typeof montar>) {
  return w.find(".lj-combobox__input");
}

async function abrir(w: ReturnType<typeof montar>) {
  await w.find(".lj-combobox__trigger").trigger("click");
  await passar();
}

async function digitar(w: ReturnType<typeof montar>, texto: string) {
  const input = campo(w);
  (input.element as HTMLInputElement).value = texto;
  await input.trigger("input");
  await passar();
}

function textos() {
  return itensNaTela().map((n) => n.textContent?.trim());
}

function itensNaTela() {
  return [...document.querySelectorAll<HTMLElement>(".lj-combobox__item")];
}

function textoVazio() {
  return document.querySelector(".lj-combobox__empty")?.textContent?.trim();
}

const FRUTAS = ["Alfa", "Beta"];
const MUITAS = Array.from({ length: 2000 }, (_, i) => ({
  id: i + 1,
  name: `Música ${String(i + 1).padStart(4, "0")}`,
}));
const MUSICAS = [
  { id: 1, name: "Alfa" },
  { id: 2, name: "Beta" },
];

describe("LjCombobox", () => {
  it("expõe um campo de texto com papel de combobox", () => {
    const w = montar({ items: FRUTAS });
    const input = campo(w);
    expect(input.element.tagName).toBe("INPUT");
    expect(input.attributes("role")).toBe("combobox");
    expect(input.attributes("aria-autocomplete")).toBe("list");
    expect(input.attributes("aria-expanded")).toBe("false");
    expect(itensNaTela()).toHaveLength(0);
  });

  it("aplica a classe de tamanho do contrato", () => {
    for (const size of ["sm", "md", "lg"] as const) {
      const w = montar({ size });
      expect(w.find(".lj-combobox__anchor").classes()).toContain(`lj-ui-size-${size}`);
    }
  });

  it("usa md quando o tamanho não é informado", () => {
    expect(montar().find(".lj-combobox__anchor").classes()).toContain("lj-ui-size-md");
  });

  it("abre a lista pelo gatilho e anuncia a expansão", async () => {
    const w = montar({ items: FRUTAS });
    await abrir(w);

    expect(campo(w).attributes("aria-expanded")).toBe("true");

    const lista = document.querySelector('[role="listbox"]');
    expect(lista).not.toBeNull();
    expect(campo(w).attributes("aria-controls")).toBe(lista?.id);
    expect(itensNaTela().map((n) => n.textContent?.trim())).toEqual(["Alfa", "Beta"]);
    expect(itensNaTela().every((n) => n.getAttribute("role") === "option")).toBe(true);
  });

  it("abre a lista com a seta para baixo no campo", async () => {
    const w = montar({ items: FRUTAS });
    await campo(w).trigger("keydown", { key: "ArrowDown" });
    await passar();

    expect(campo(w).attributes("aria-expanded")).toBe("true");
    expect(itensNaTela()).toHaveLength(2);
  });

  it("fecha a lista ao acionar o gatilho de novo", async () => {
    const w = montar({ items: FRUTAS });
    await abrir(w);
    expect(itensNaTela()).toHaveLength(2);

    await abrir(w);
    expect(itensNaTela()).toHaveLength(0);
    expect(campo(w).attributes("aria-expanded")).toBe("false");
  });

  it("emite update:modelValue com o item escolhido", async () => {
    const w = montar({ items: FRUTAS });
    await abrir(w);
    itensNaTela()[1].click();
    await passar();

    expect(w.emitted("update:modelValue")).toEqual([["Beta"]]);
  });

  it("emite o item inteiro quando a lista é de objetos", async () => {
    const w = montar({ items: MUSICAS, itemValue: "id", itemLabel: "name" });
    await abrir(w);
    expect(itensNaTela().map((n) => n.textContent?.trim())).toEqual(["Alfa", "Beta"]);

    itensNaTela()[1].click();
    await passar();

    expect(w.emitted("update:modelValue")).toEqual([[MUSICAS[1]]]);
  });

  it("mostra no campo o rótulo do item selecionado, não o objeto cru", async () => {
    const w = montar({
      items: MUSICAS,
      itemValue: "id",
      itemLabel: "name",
      modelValue: MUSICAS[1],
    });
    await passar();

    expect((campo(w).element as HTMLInputElement).value).toBe("Beta");
  });

  it("marca como escolhido apenas o item que está no v-model", async () => {
    const w = montar({
      items: MUSICAS,
      itemValue: "id",
      itemLabel: "name",
      modelValue: MUSICAS[1],
    });
    await abrir(w);

    const estados = itensNaTela().map((n) => [
      n.textContent?.trim(),
      n.getAttribute("aria-selected"),
    ]);
    expect(estados).toEqual([
      ["Alfa", "false"],
      ["Beta", "true"],
    ]);
  });

  it("reserva o espaço do marcador em todos os itens, e não só no selecionado", async () => {
    const w = montar({
      items: MUSICAS,
      itemValue: "id",
      itemLabel: "name",
      modelValue: MUSICAS[1],
    });
    await abrir(w);

    // Um marcador que só existisse no item escolhido desalinharia os demais.
    expect(document.querySelectorAll(".lj-combobox__check")).toHaveLength(MUSICAS.length);
    expect(itensNaTela().every((n) => !!n.querySelector(".lj-combobox__check"))).toBe(true);
  });

  it("desabilitado não abre a lista e anuncia aria-disabled", async () => {
    const w = montar({ items: FRUTAS, disabled: true });
    const input = campo(w);
    expect(input.attributes("disabled")).toBeDefined();
    expect(input.attributes("aria-disabled")).toBe("true");

    await abrir(w);
    expect(itensNaTela()).toHaveLength(0);
    expect(input.attributes("aria-expanded")).toBe("false");

    await input.trigger("keydown", { key: "ArrowDown" });
    await passar();
    expect(itensNaTela()).toHaveLength(0);
  });

  it("usa o placeholder de busca traduzido em PT e em ES", () => {
    expectKeyExists("components.ui.search_placeholder");

    // Comparado com o dicionário, e não com um literal: um texto fixo no
    // componente passaria despercebido enquanto as duas traduções coincidissem.
    const emPt = montar({ items: FRUTAS });
    expect((campo(emPt).element as HTMLInputElement).placeholder).toBe(
      pt.components.ui.search_placeholder
    );

    const emEs = montar({ items: FRUTAS }, "es");
    expect((campo(emEs).element as HTMLInputElement).placeholder).toBe(
      es.components.ui.search_placeholder
    );
  });

  it("mostra o texto de lista vazia traduzido em PT e em ES", async () => {
    expectKeyExists("components.ui.no_results");

    const emPt = montar({ items: [] });
    await abrir(emPt);
    expect(textoVazio()).toBe("Nenhum resultado.");
    expect(textoVazio()).toBe(pt.components.ui.no_results);
    emPt.unmount();
    document.body.innerHTML = "";

    const emEs = montar({ items: [] }, "es");
    await abrir(emEs);
    expect(textoVazio()).toBe("Ningún resultado.");
    expect(textoVazio()).toBe(es.components.ui.no_results);
  });

  it("as props de texto vencem a tradução", async () => {
    const w = montar({ items: [], placeholder: "Ache a música", emptyText: "Nada por aqui" });
    expect((campo(w).element as HTMLInputElement).placeholder).toBe("Ache a música");

    await abrir(w);
    expect(textoVazio()).toBe("Nada por aqui");
  });

  it("filtra os itens pelo que foi digitado e cai no vazio quando nada casa", async () => {
    const w = montar({ items: MUSICAS, itemValue: "id", itemLabel: "name" });
    const input = campo(w);

    (input.element as HTMLInputElement).value = "alf";
    await input.trigger("input");
    await passar();
    expect(itensNaTela().map((n) => n.textContent?.trim())).toEqual(["Alfa"]);
    expect(textoVazio()).toBeUndefined();

    (input.element as HTMLInputElement).value = "zzz";
    await input.trigger("input");
    await passar();
    expect(itensNaTela()).toHaveLength(0);
    expect(textoVazio()).toBe("Nenhum resultado.");
  });

  it("desenha só as linhas que cabem, não as 2000 da lista", async () => {
    const w = montar({ items: MUITAS, itemValue: "id", itemLabel: "name" });
    await abrir(w);

    const linhas = textos();
    expect(linhas[0]).toBe("Música 0001");
    expect(linhas.length).toBeGreaterThan(5);
    expect(linhas.length).toBeLessThan(50);
  });

  it("acha na lista enorme um item que está fora da janela desenhada", async () => {
    const w = montar({ items: MUITAS, itemValue: "id", itemLabel: "name" });
    await digitar(w, "1999");

    expect(textos()).toEqual(["Música 1999"]);
  });

  it("filtra ignorando acento, caixa, espaço e pontuação", async () => {
    const w = montar({
      items: [
        { id: 1, name: "Santo, Santo, Santo!" },
        { id: 2, name: "Você é Fiel" },
        { id: 3, name: "Outra" },
      ],
      itemValue: "id",
      itemLabel: "name",
    });

    await digitar(w, "VOCE e");
    expect(textos()).toEqual(["Você é Fiel"]);

    await digitar(w, "santo santo");
    expect(textos()).toEqual(["Santo, Santo, Santo!"]);
  });

  it("zera o termo digitado ao fechar: a lista volta inteira na próxima abertura", async () => {
    const w = montar({ items: MUSICAS, itemValue: "id", itemLabel: "name" });
    await digitar(w, "alf");
    expect(textos()).toEqual(["Alfa"]);

    await w.find(".lj-combobox__trigger").trigger("click");
    await passar();
    expect(itensNaTela()).toHaveLength(0);

    await abrir(w);
    expect(textos()).toEqual(["Alfa", "Beta"]);
  });

  it("marca o item de mesmo valor, ainda que o objeto do v-model esteja defasado", async () => {
    // A lista é recriada (troca de idioma, itens novos) e o v-model guarda a
    // versão antiga do item: só o valor, não o objeto inteiro, continua igual.
    const w = montar({
      items: MUSICAS,
      itemValue: "id",
      itemLabel: "name",
      modelValue: { id: 2, name: "Beta (versão antiga)" },
    });
    await abrir(w);

    expect(
      itensNaTela().map((n) => [n.textContent?.trim(), n.getAttribute("aria-selected")])
    ).toEqual([
      ["Alfa", "false"],
      ["Beta", "true"],
    ]);
  });

  it("mostra o texto secundário da linha, e só nos itens que o têm", async () => {
    const w = montar({
      items: [
        { id: 1, name: "Abrigo na Rocha", detail: "Hinário Adventista" },
        { id: 2, name: "Abrigo na Rocha", detail: "Hinário Adventista 1996" },
        { id: 3, name: "Sem álbum" },
      ],
      itemValue: "id",
      itemLabel: "name",
    });
    await abrir(w);

    const detalhes = [...document.querySelectorAll(".lj-combobox__detail")].map((n) =>
      n.textContent?.trim()
    );
    expect(detalhes).toEqual(["Hinário Adventista", "Hinário Adventista 1996"]);
    expect(itensNaTela()[2].querySelector(".lj-combobox__detail")).toBeNull();
  });

  it("o texto secundário não entra na busca: só o rótulo é filtrado", async () => {
    const w = montar({
      items: [
        { id: 1, name: "Abrigo na Rocha", detail: "Hinário Adventista" },
        { id: 2, name: "Adventista de Coração", detail: "Jovem" },
      ],
      itemValue: "id",
      itemLabel: "name",
    });
    await digitar(w, "adventista");

    const rotulos = [...document.querySelectorAll(".lj-combobox__label")].map((n) =>
      n.textContent?.trim()
    );
    expect(rotulos).toEqual(["Adventista de Coração"]);
  });

  it("uma regra de busca própria substitui a do rótulo e recebe o termo já normalizado", async () => {
    const termos: string[] = [];
    const w = montar({
      items: [
        { id: 1, name: "Abrigo na Rocha", detail: "Hinário Adventista" },
        { id: 2, name: "Adventista de Coração", detail: "Jovem" },
      ],
      itemValue: "id",
      itemLabel: "name",
      filter: (item: { id: number }, termo: string) => {
        termos.push(termo);
        return item.id === 2;
      },
    });
    await abrir(w);
    expect(termos).toEqual([]);
    expect(itensNaTela()).toHaveLength(2);

    await digitar(w, "Hinário Advent");

    const rotulos = [...document.querySelectorAll(".lj-combobox__label")].map((n) =>
      n.textContent?.trim()
    );
    expect(rotulos).toEqual(["Adventista de Coração"]);
    expect(new Set(termos)).toEqual(new Set(["hinarioadvent"]));
  });

  it("sinaliza o estado inválido só quando pedido", () => {
    expect(montar({ invalid: true }).find(".lj-combobox__anchor").classes()).toContain(
      "is-invalid"
    );
    expect(montar().find(".lj-combobox__anchor").classes()).not.toContain("is-invalid");
  });
});
