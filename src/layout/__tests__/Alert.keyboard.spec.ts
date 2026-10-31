import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick, reactive } from "vue";
import { mount, type VueWrapper } from "@vue/test-utils";

// AppData de mentira, reativo: o Alert lê e grava `alert.*` nele.
const state = reactive<Record<string, unknown>>({});
function get(path: string) {
  return path.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], state);
}
function set(path: string, value: unknown) {
  const keys = path.split(".");
  let o = state as Record<string, unknown>;
  for (const k of keys.slice(0, -1)) o = (o[k] ??= {}) as Record<string, unknown>;
  o[keys.at(-1)!] = value;
}
vi.mock("@/helpers/AppData", () => ({ default: { get, set } }));

const Alert = (await import("../Alert.vue")).default;
const Hotkeys = (await import("@/helpers/Hotkeys")).default;

let wrapper: VueWrapper | null = null;

/** O botão marcado na pergunta aberta agora (a de um teste anterior pode estar saindo da tela). */
function marcado(): string | undefined {
  const caixas = document.querySelectorAll(".alert");
  return caixas[caixas.length - 1]?.querySelector(".alert-btn--picked")?.textContent?.trim();
}

function abrirPergunta(title = "Deseja fechar este slide?", default_button: string | null = "yes") {
  state.alert = {
    show: true,
    title,
    translate: false,
    default_button,
    buttons: [
      { text: "alert.no", color: "error", value: "no" },
      { text: "alert.yes", color: "info", value: "yes" },
    ],
  };
}

/** A tecla nasce dentro do player (o foco fica preso nele), não na pergunta. */
function tecla(key: string) {
  const player = document.createElement("button");
  document.body.appendChild(player);
  player.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  player.remove();
}

beforeEach(() => {
  for (const k of Object.keys(state)) delete state[k];
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  Hotkeys.destroy();
});

async function montar(...pergunta: Parameters<typeof abrirPergunta>) {
  // Como no app: o Alert já está montado e a pergunta abre depois.
  state.alert = { show: false };
  wrapper = mount(Alert, {
    attachTo: document.body,
    global: { mocks: { $t: (k: string) => k }, stubs: { Transition: false } },
  });
  abrirPergunta(...pergunta);
  await nextTick();
  await nextTick();
  await nextTick();
}

describe("Alert — pergunta pelo teclado", () => {
  it("Esc e depois Enter: confirma o Sim", async () => {
    await montar();
    tecla("Enter");
    expect(get("alert.value")).toBe("yes");
    expect(get("alert.show")).toBe(false);
  });

  it("as setas escolhem o botão e o Enter confirma o escolhido", async () => {
    await montar();
    await nextTick();
    // Abre com o "Sim" marcado; a seta para a esquerda vai para o "Não".
    expect(marcado()).toBe("alert.yes");
    tecla("ArrowLeft");
    await nextTick();
    expect(marcado()).toBe("alert.no");
    tecla("Enter");
    expect(get("alert.value")).toBe("no");
  });

  it("Esc na pergunta fica com o Não", async () => {
    await montar();
    tecla("Escape");
    expect(get("alert.value")).toBe("no");
  });

  it("com a pergunta aberta, a seta não passa o slide por baixo", async () => {
    Hotkeys.init();
    const passarSlide = vi.fn();
    Hotkeys.register("ArrowRight", passarSlide, { context: "media", allowInForm: true });
    await montar();
    tecla("ArrowRight");
    expect(passarSlide).not.toHaveBeenCalled();
    // E o Enter, mesmo nascendo dentro do player, responde a pergunta (a seta
    // para a direita saiu do "Sim" e deu a volta no "Não").
    tecla("Enter");
    expect(get("alert.value")).toBe("no");
    Hotkeys.unregister("ArrowRight", passarSlide);
  });

  it("confirmação sem botão padrão não abre armada: Enter não confirma nada", async () => {
    await montar("Limpar todos os arquivos baixados?", null);
    await nextTick();
    expect(marcado()).toBeUndefined();
    tecla("Enter");
    tecla(" ");
    expect(get("alert.show")).toBe(true);
    expect(get("alert.value")).not.toBe("yes");

    // Só a escolha deliberada pelas setas arma o Sim.
    tecla("ArrowRight");
    tecla("ArrowRight");
    await nextTick();
    expect(marcado()).toBe("alert.yes");
    tecla("Enter");
    expect(get("alert.value")).toBe("yes");
  });

  it("pergunta nova com outra ainda aberta recomeça a marcação", async () => {
    await montar();
    await nextTick();
    expect(marcado()).toBe("alert.yes");
    abrirPergunta("Excluir a playlist?", null);
    await nextTick();
    expect(marcado()).toBeUndefined();
    tecla("Enter");
    expect(get("alert.show")).toBe(true);
  });
});
