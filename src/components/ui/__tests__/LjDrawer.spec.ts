/**
 * O LjDrawer tem duas formas com DOM bem diferente:
 *
 * - permanente: fica na árvore do próprio componente e dá para consultar pelo
 *   wrapper do test-utils;
 * - temporário: o painel vai para um portal no <body>, então monta com
 *   `attachTo: document.body` e consulta `document.body` — procurar no wrapper
 *   acha só os marcadores do teleport.
 */
import { afterEach, describe, expect, it } from "vitest";
import { nextTick } from "vue";
import type { VueWrapper } from "@vue/test-utils";
import LjDrawer from "../LjDrawer.vue";
import { expectKeyExists, mountUi } from "./mountUi";

/** Deixa a fila de macrotasks rodar — o Reka só registra o listener de
 *  pointerdown num setTimeout(0) depois da montagem. */
const macrotask = () => new Promise((resolve) => setTimeout(resolve, 0));

let aberto: VueWrapper | null = null;

afterEach(() => {
  aberto?.unmount();
  aberto = null;
  document.body.innerHTML = "";
});

type Props = Record<string, unknown>;
type Opcoes = { slots?: Record<string, string>; locale?: "pt" | "es" };

function montarPermanente(props: Props = {}, options: Opcoes = {}) {
  const w = mountUi(
    LjDrawer,
    { props: { modelValue: true, ...props }, slots: options.slots },
    options.locale ?? "pt"
  );
  aberto = w as VueWrapper;
  return w;
}

async function montarTemporario(props: Props = {}, options: Opcoes = {}) {
  const w = mountUi(
    LjDrawer,
    {
      attachTo: document.body,
      props: { modelValue: true, temporary: true, ...props },
      slots: options.slots,
    },
    options.locale ?? "pt"
  );
  aberto = w as VueWrapper;
  await nextTick();
  await macrotask();
  return w;
}

const painel = () => document.body.querySelector('[role="dialog"]');
const overlay = () => document.body.querySelector(".lj-drawer__overlay");

function descartar() {
  aberto?.unmount();
  aberto = null;
  document.body.innerHTML = "";
}

async function pressionarEscape() {
  document.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })
  );
  await nextTick();
  await nextTick();
}

async function clicarFora() {
  const alvo = document.createElement("button");
  document.body.appendChild(alvo);
  alvo.dispatchEvent(
    new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 })
  );
  await macrotask();
  await nextTick();
  await nextTick();
  alvo.remove();
}

describe("LjDrawer — modo permanente", () => {
  it("não desenha nada enquanto fechado", () => {
    const w = montarPermanente({ modelValue: false }, { slots: { default: "segredo" } });
    expect(w.find(".lj-drawer").exists()).toBe(false);
    expect(w.text()).not.toContain("segredo");
  });

  it("abre e fecha acompanhando o v-model", async () => {
    const w = montarPermanente({ modelValue: false });
    await w.setProps({ modelValue: true });
    expect(w.find(".lj-drawer").exists()).toBe(true);

    await w.setProps({ modelValue: false });
    expect(w.find(".lj-drawer").exists()).toBe(false);
  });

  it("fica no fluxo do consumidor, sem portal e sem overlay", () => {
    const w = montarPermanente({}, { slots: { default: "conteúdo" } });
    expect(w.find(".lj-drawer--permanent").exists()).toBe(true);
    expect(w.text()).toContain("conteúdo");
    // Sem overlay não há nada cobrindo o resto da tela — é o que separa
    // "empurra o conteúdo" de "sobrepõe".
    expect(w.find(".lj-drawer__overlay").exists()).toBe(false);
    expect(overlay()).toBeNull();
  });

  it("não vira diálogo — nada de papel modal para um painel que só ocupa espaço", () => {
    montarPermanente({ title: "Formatação" });
    expect(painel()).toBeNull();
  });

  it("é um <aside>, não uma div genérica", () => {
    const w = montarPermanente();
    expect(w.get(".lj-drawer").element.tagName).toBe("ASIDE");
  });

  it("marca o lado esquerdo e o direito", () => {
    const esquerdo = montarPermanente();
    expect(esquerdo.get(".lj-drawer").classes()).toContain("lj-drawer--left");
    expect(esquerdo.get(".lj-drawer").classes()).not.toContain("lj-drawer--right");
    descartar();

    const direito = montarPermanente({ side: "right" });
    expect(direito.get(".lj-drawer").classes()).toContain("lj-drawer--right");
  });

  it("Escape não fecha — sem overlay não há o que dispensar", async () => {
    const w = montarPermanente();
    await pressionarEscape();
    expect(w.emitted("update:modelValue")).toBeUndefined();
    expect(w.find(".lj-drawer").exists()).toBe(true);
  });

  it("largura numérica vira px e string passa direto", () => {
    const numero = montarPermanente({ width: 220 });
    expect(numero.get(".lj-drawer").attributes("style")).toContain("--lj-drawer-w: 220px");
    descartar();

    const texto = montarPermanente({ width: "30%" });
    expect(texto.get(".lj-drawer").attributes("style")).toContain("--lj-drawer-w: 30%");
  });

  it("sem título e sem slot de cabeçalho, não sobra cabeçalho vazio", () => {
    const sem = montarPermanente({}, { slots: { default: "corpo" } });
    expect(sem.find(".lj-drawer__header").exists()).toBe(false);
    descartar();

    const com = montarPermanente({ title: "Lista" });
    expect(com.get(".lj-drawer__title").text()).toBe("Lista");
  });

  it("cabeçalho próprio substitui o título, e o slot de ações fica ao lado", () => {
    const w = montarPermanente({ title: "Ignorado" }, { slots: { header: "<b>Meu</b>" } });
    expect(w.find(".lj-drawer__title").exists()).toBe(false);
    expect(w.get(".lj-drawer__header").text()).toBe("Meu");
    descartar();

    const comAcoes = montarPermanente(
      { title: "Formatação" },
      { slots: { actions: "<button>Restaurar</button>" } }
    );
    expect(comAcoes.get(".lj-drawer__actions").text()).toBe("Restaurar");
  });

  it("classe do consumidor pousa no painel em vez de virar aviso de atributo solto", () => {
    const w = mountUi(LjDrawer, {
      props: { modelValue: true },
      attrs: { class: "meu-painel" },
    });
    aberto = w as VueWrapper;
    expect(w.get(".lj-drawer").classes()).toContain("meu-painel");
  });
});

describe("LjDrawer — modo temporário", () => {
  it("não renderiza nada enquanto fechado", async () => {
    await montarTemporario({ modelValue: false }, { slots: { default: "segredo" } });
    expect(painel()).toBeNull();
    expect(document.body.textContent).not.toContain("segredo");
  });

  it("abre quando o v-model vira true depois da montagem", async () => {
    const w = await montarTemporario({ modelValue: false });
    await w.setProps({ modelValue: true });
    await nextTick();
    expect(painel()).not.toBeNull();
  });

  it("renderiza no portal, fora da árvore do próprio componente", async () => {
    const w = await montarTemporario({}, { slots: { default: "corpo" } });
    expect(w.find('[role="dialog"]').exists()).toBe(false);
    expect(painel()!.textContent).toContain("corpo");
  });

  it("sobrepõe com overlay — é o que o distingue do permanente", async () => {
    await montarTemporario();
    expect(overlay()).not.toBeNull();
  });

  it("marca o lado esquerdo e o direito", async () => {
    await montarTemporario();
    expect([...painel()!.classList]).toContain("lj-drawer--left");
    descartar();

    await montarTemporario({ side: "right" });
    expect([...painel()!.classList]).toContain("lj-drawer--right");
  });

  it("Escape fecha, pedindo o fechamento pelo v-model", async () => {
    const w = await montarTemporario();
    await pressionarEscape();
    expect(w.emitted("update:modelValue")).toEqual([[false]]);
  });

  it("clique fora fecha", async () => {
    const w = await montarTemporario();
    await clicarFora();
    expect(w.emitted("update:modelValue")).toEqual([[false]]);
  });

  it("o botão de fechar do cabeçalho fecha e se chama Fechar em PT, Cerrar em ES", async () => {
    expectKeyExists("actions.close");

    const w = await montarTemporario({ title: "Lista" });
    const fechar = document.body.querySelector<HTMLElement>(".lj-drawer__close");
    expect(fechar!.getAttribute("aria-label")).toBe("Fechar");
    fechar!.click();
    await nextTick();
    expect(w.emitted("update:modelValue")).toEqual([[false]]);
    descartar();

    await montarTemporario({ title: "Lista" }, { locale: "es" });
    expect(document.body.querySelector(".lj-drawer__close")!.getAttribute("aria-label")).toBe(
      "Cerrar"
    );
  });

  it("o título vira o nome acessível do painel", async () => {
    await montarTemporario({ title: "Formatação" });
    const labelId = painel()!.getAttribute("aria-labelledby");
    expect(labelId).toBeTruthy();
    expect(document.getElementById(labelId!)!.textContent).toBe("Formatação");
  });

  it("sem título não sobra aria apontando para id inexistente", async () => {
    await montarTemporario();
    // A Reka reserva os dois ids mesmo sem os elementos; um id órfão faz o
    // leitor de tela anunciar o painel sem nome nenhum.
    expect(painel()!.hasAttribute("aria-labelledby")).toBe(false);
    expect(painel()!.hasAttribute("aria-describedby")).toBe(false);
  });

  it("cabeçalho próprio também não deixa aria-labelledby órfão", async () => {
    await montarTemporario({ title: "Ignorado" }, { slots: { header: "<b>Meu</b>" } });
    expect(painel()!.hasAttribute("aria-labelledby")).toBe(false);
    expect(document.body.querySelector(".lj-drawer__title")).toBeNull();
  });

  it("classe do consumidor atravessa o portal", async () => {
    const w = mountUi(LjDrawer, {
      attachTo: document.body,
      props: { modelValue: true, temporary: true },
      attrs: { class: "meu-painel" },
    });
    aberto = w as VueWrapper;
    await nextTick();
    await macrotask();
    // A raiz do modo temporário é um fragmento (portal), onde a herança
    // automática de atributo do Vue descarta tudo com aviso no console.
    expect([...painel()!.classList]).toContain("meu-painel");
  });

  it("largura numérica vira px também no portal", async () => {
    await montarTemporario({ width: 280 });
    expect(painel()!.getAttribute("style")).toContain("--lj-drawer-w: 280px");
  });

  it("ao abrir, o foco vai para o painel e não para o primeiro campo", async () => {
    await montarTemporario({}, { slots: { default: '<input class="campo" />' } });
    await macrotask();
    const ativo = document.activeElement as HTMLElement;
    expect(ativo.getAttribute("role")).toBe("dialog");
    expect(ativo.classList.contains("campo")).toBe(false);
  });
});

/*
 * Fora do alcance do jsdom (não vale fingir teste):
 *
 * - O deslize lateral (lj-drawer-in / lj-drawer-out) e a transição de largura
 *   do modo permanente: dependem de CSS aplicado e de layout, que o jsdom não
 *   calcula. Aqui só dá para afirmar qual classe de lado e qual largura saíram.
 * - `prefers-reduced-motion`: o jsdom não avalia media query de preferência.
 * - "Empurrar o conteúdo ao lado" é resultado de layout em flex — o teste
 *   afirma o que o produz (painel no fluxo, sem overlay, com largura própria).
 * - Trap de foco em ciclo (Tab do último para o primeiro): o jsdom não
 *   implementa ordem de tabulação nem foco por Tab.
 */
