/**
 * O conteúdo do LjDialog vive num portal no <body>, fora do wrapper do
 * test-utils. Por isso tudo aqui monta com `attachTo: document.body` e consulta
 * `document.body` — procurar no wrapper acha apenas os marcadores do teleport.
 */
import { afterEach, describe, expect, it } from "vitest";
import { nextTick } from "vue";
import type { VueWrapper } from "@vue/test-utils";
import LjDialog from "../LjDialog.vue";
import { resetDialogStack } from "../dialogStack";
import { expectKeyExists, mountUi } from "./mountUi";

/** Deixa a fila de macrotasks rodar — o Reka só registra o listener de
 *  pointerdown num setTimeout(0) depois da montagem. */
const macrotask = () => new Promise((resolve) => setTimeout(resolve, 0));

let aberto: VueWrapper | null = null;

afterEach(() => {
  aberto?.unmount();
  aberto = null;
  document.body.innerHTML = "";
  // A pilha é estado de módulo: sem isto o nível de um caso vaza para o outro.
  resetDialogStack();
});

type Props = Record<string, unknown>;

async function abrir(
  props: Props = {},
  options: { slots?: Record<string, string>; locale?: "pt" | "es" } = {}
) {
  const w = mountUi(
    LjDialog,
    {
      attachTo: document.body,
      props: { modelValue: true, title: "Confirmar saída", ...props },
      slots: options.slots,
    },
    options.locale ?? "pt"
  );
  aberto = w as VueWrapper;
  await nextTick();
  await macrotask();
  return w;
}

const dialogo = () => document.body.querySelector('[role="dialog"]');

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

describe("LjDialog", () => {
  it("não renderiza nada enquanto fechado", async () => {
    await abrir({ modelValue: false }, { slots: { default: "segredo" } });
    expect(dialogo()).toBeNull();
    expect(document.body.textContent).not.toContain("segredo");
  });

  it("abre quando o v-model vira true depois da montagem", async () => {
    const w = await abrir({ modelValue: false });
    await w.setProps({ modelValue: true });
    await nextTick();
    expect(dialogo()).not.toBeNull();
  });

  it("renderiza o conteúdo no portal, fora da árvore do próprio componente", async () => {
    const w = await abrir({}, { slots: { default: "corpo" } });
    expect(w.find('[role="dialog"]').exists()).toBe(false);
    expect(dialogo()).not.toBeNull();
    expect(dialogo()!.textContent).toContain("corpo");
  });

  it("expõe papel de diálogo com nome acessível vindo do título", async () => {
    await abrir({ title: "Excluir playlist" });
    const el = dialogo()!;
    const labelId = el.getAttribute("aria-labelledby");
    expect(labelId).toBeTruthy();
    const titulo = document.getElementById(labelId!);
    expect(titulo).not.toBeNull();
    expect(titulo!.textContent).toBe("Excluir playlist");
  });

  it("sem description não deixa aria-describedby apontando para id inexistente", async () => {
    await abrir();
    const referencia = dialogo()!.getAttribute("aria-describedby");
    // Ou o atributo some, ou fica vazio — o que não pode é sobrar um id órfão.
    if (referencia) {
      expect(document.getElementById(referencia)).not.toBeNull();
    } else {
      expect(referencia === null || referencia === "").toBe(true);
    }
  });

  it("mostra o texto de description apenas quando ele é informado", async () => {
    await abrir({ description: "Essa ação não pode ser desfeita." });
    expect(dialogo()!.textContent).toContain("Essa ação não pode ser desfeita.");
    expect(document.body.querySelector(".lj-dialog__description")).not.toBeNull();

    aberto!.unmount();
    aberto = null;
    document.body.innerHTML = "";

    await abrir();
    expect(document.body.querySelector(".lj-dialog__description")).toBeNull();
  });

  it("aplica a classe de tamanho do contrato e usa md por padrão", async () => {
    for (const size of ["sm", "md", "lg"] as const) {
      await abrir({ size });
      expect([...dialogo()!.classList]).toContain(`lj-dialog--${size}`);
      aberto!.unmount();
      aberto = null;
      document.body.innerHTML = "";
    }

    await abrir({ size: undefined });
    expect([...dialogo()!.classList]).toContain("lj-dialog--md");
  });

  it("fecha pelo botão do cabeçalho emitindo update:modelValue false", async () => {
    const w = await abrir();
    const fechar = document.body.querySelector<HTMLElement>(".lj-dialog__close");
    expect(fechar).not.toBeNull();
    fechar!.click();
    await nextTick();
    expect(w.emitted("update:modelValue")).toEqual([[false]]);
  });

  it("Escape fecha o diálogo comum", async () => {
    const w = await abrir();
    await pressionarEscape();
    expect(w.emitted("update:modelValue")).toEqual([[false]]);
  });

  it("clique fora fecha o diálogo comum", async () => {
    const w = await abrir();
    await clicarFora();
    expect(w.emitted("update:modelValue")).toEqual([[false]]);
  });

  it("não fecha no Escape quando persistent", async () => {
    const w = await abrir({ persistent: true });
    await pressionarEscape();
    expect(w.emitted("update:modelValue")).toBeUndefined();
    expect(dialogo()).not.toBeNull();
  });

  it("não fecha no clique fora quando persistent", async () => {
    const w = await abrir({ persistent: true });
    await clicarFora();
    expect(w.emitted("update:modelValue")).toBeUndefined();
    expect(dialogo()).not.toBeNull();
  });

  it("persistent esconde o botão de fechar — a saída é pelo rodapé", async () => {
    await abrir({ persistent: true }, { slots: { footer: "<button>Entendi</button>" } });
    expect(document.body.querySelector(".lj-dialog__close")).toBeNull();
    expect(document.body.querySelector(".lj-dialog__footer")!.textContent).toContain("Entendi");
  });

  it("o botão de fechar se chama Fechar em PT e Cerrar em ES", async () => {
    expectKeyExists("actions.close");

    await abrir();
    expect(document.body.querySelector(".lj-dialog__close")!.getAttribute("aria-label")).toBe(
      "Fechar"
    );

    aberto!.unmount();
    aberto = null;
    document.body.innerHTML = "";

    await abrir({}, { locale: "es" });
    expect(document.body.querySelector(".lj-dialog__close")!.getAttribute("aria-label")).toBe(
      "Cerrar"
    );
  });

  it("renderiza o rodapé só quando o slot é fornecido", async () => {
    await abrir({}, { slots: { footer: "<button>Salvar</button>" } });
    expect(document.body.querySelector(".lj-dialog__footer")).not.toBeNull();

    aberto!.unmount();
    aberto = null;
    document.body.innerHTML = "";

    await abrir();
    expect(document.body.querySelector(".lj-dialog__footer")).toBeNull();
  });

  it("mostra o ícone do cabeçalho apenas quando informado", async () => {
    await abrir();
    expect(document.body.querySelector(".lj-dialog__icon")).toBeNull();

    aberto!.unmount();
    aberto = null;
    document.body.innerHTML = "";

    await abrir({ icon: "alert-triangle-filled" });
    expect(document.body.querySelector(".lj-dialog__icon")).not.toBeNull();
  });

  it("ao abrir, o foco vai para o contêiner e não para o primeiro campo", async () => {
    await abrir({}, { slots: { default: '<input class="campo" />' } });
    await macrotask();
    const ativo = document.activeElement as HTMLElement;
    expect(ativo.getAttribute("role")).toBe("dialog");
    expect(ativo.classList.contains("campo")).toBe(false);
  });
});

describe("empilhamento automático", () => {
  /** Abre um diálogo sem registro no `aberto` global, para coexistir com outro. */
  async function abrirEmpilhado(title: string) {
    const w = mountUi(
      LjDialog,
      { attachTo: document.body, props: { modelValue: true, title } },
      "pt"
    ) as VueWrapper;
    await nextTick();
    await macrotask();
    return w;
  }

  const nivelDe = (el: Element | null) =>
    (el as HTMLElement | null)?.style.getPropertyValue("--lj-dialog-stack");

  it("o diálogo que abre por cima recebe um nível maior", async () => {
    // O defeito: com dois diálogos abertos, os quatro camadas (overlay e
    // conteúdo de cada um) empatavam, e o desempate era a ordem no <body>.
    // Aí a pintura (CSS) podia responder a uma ordem e o clique (a camada
    // DismissableLayer do Reka) a outra — um diálogo na frente sem receber
    // clique, outro atrás recebendo.
    const primeiro = await abrirEmpilhado("Formulário");
    const segundo = await abrirEmpilhado("Gerenciador");

    const conteudos = document.body.querySelectorAll(".lj-dialog");
    expect(conteudos).toHaveLength(2);
    expect(nivelDe(conteudos[0])).toBe("0");
    expect(nivelDe(conteudos[1])).toBe("1");

    // O overlay recebe o mesmo nível: cada um dos dois pertence ao mesmo
    // diálogo, senão o overlay do de cima ficaria atrás do conteúdo de baixo.
    const overlays = document.body.querySelectorAll(".lj-dialog__overlay");
    expect(nivelDe(overlays[0])).toBe("0");
    expect(nivelDe(overlays[1])).toBe("1");

    primeiro.unmount();
    segundo.unmount();
  });

  it("fechar o de cima devolve o nível para quem ficou", async () => {
    const primeiro = await abrirEmpilhado("Formulário");
    const segundo = await abrirEmpilhado("Gerenciador");
    segundo.unmount();
    await nextTick();

    const terceiro = await abrirEmpilhado("Ajuda");
    const conteudos = document.body.querySelectorAll(".lj-dialog");
    expect(nivelDe(conteudos[0])).toBe("0");
    // Reaproveitado, e não 2: quem fecha não deixa buraco na escala.
    expect(nivelDe(conteudos[conteudos.length - 1])).toBe("1");

    primeiro.unmount();
    terceiro.unmount();
  });

  it("diálogo único não recebe empilhamento nenhum", async () => {
    // Nível 0 é o mesmo z-index de sempre (2500/2501): a escala não muda para
    // quem abre um diálogo por vez, que é o caso comum no app.
    await abrir();
    expect(nivelDe(document.body.querySelector(".lj-dialog"))).toBe("0");
  });

  it("desmontar com v-if enquanto aberto não vaza nível", async () => {
    // O watcher de `modelValue` não roda nesse caminho; sem a devolução no
    // descarte do escopo, o nível ficaria reservado para sempre.
    const primeiro = await abrirEmpilhado("Formulário");
    primeiro.unmount();
    await nextTick();

    const segundo = await abrirEmpilhado("Gerenciador");
    expect(nivelDe(document.body.querySelector(".lj-dialog"))).toBe("0");
    segundo.unmount();
  });
});

/*
 * Fora do alcance do jsdom (não vale fingir teste):
 *
 * - Posicionamento, largura máxima por tamanho e as animações de entrada
 *   (lj-dialog-in / lj-dialog-fade): dependem de layout e CSS aplicado, que o
 *   jsdom não calcula. Aqui só dá para afirmar qual classe de tamanho saiu.
 * - Trap de foco em ciclo (Tab do último para o primeiro elemento): o jsdom não
 *   implementa a ordem de tabulação nem dispara foco por Tab.
 * - Bloqueio real de ponteiro no conteúdo de fora (`pointer-events: none` no
 *   body enquanto o modal está aberto): o efeito é visual/CSS.
 * - Devolução do foco ao elemento que abriu o diálogo: depende de um gatilho
 *   focado de verdade antes da abertura, que o jsdom não sustenta de forma
 *   confiável entre montagens.
 */
