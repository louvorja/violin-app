import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const appdata: Record<string, unknown> = {};
vi.mock("@/helpers/AppData", () => ({
  default: { get: (key: string, fallback?: unknown) => (key in appdata ? appdata[key] : fallback) },
}));

const { KEYS } = await import("@/constants/UserDataKeys");
const PlayerKeyboard = (await import("../PlayerKeyboard")).default;

// O jsdom só cria eventos não confiáveis; a tecla de verdade é simulada pela flag.
const realKey = { isTrusted: true } as KeyboardEvent;
const remoteKey = new KeyboardEvent("keydown", { key: "ArrowRight" });

function click(el: Element): void {
  el.dispatchEvent(new Event("pointerdown", { bubbles: true }));
}

function setUserActivation(isActive: boolean | undefined): void {
  Object.defineProperty(navigator, "userActivation", {
    configurable: true,
    value: isActive === undefined ? undefined : { isActive },
  });
}

let player: HTMLElement;
let list: HTMLElement;

beforeEach(() => {
  PlayerKeyboard.init();
  PlayerKeyboard.release();
  delete appdata[KEYS.MODULES.MEDIA.SHOW];
  player = document.createElement("footer");
  player.setAttribute("data-lj-player", "");
  player.append(document.createElement("button"));
  list = document.createElement("div");
  document.body.append(player, list);
});

afterEach(() => {
  player.remove();
  list.remove();
  setUserActivation(undefined);
  vi.restoreAllMocks();
});

describe("o teclado é do player ou da tela", () => {
  it("um clique no player dá as setas ao slide; um clique fora as devolve à tela", () => {
    expect(PlayerKeyboard.hasKeys(realKey)).toBe(false);
    click(player.querySelector("button")!);
    expect(PlayerKeyboard.hasKeys(realKey)).toBe(true);
    click(list);
    expect(PlayerKeyboard.hasKeys(realKey)).toBe(false);
  });

  it("trocar de aba devolve as teclas à tela, mesmo sem clique (Ctrl+Tab)", () => {
    click(player);
    window.dispatchEvent(new CustomEvent("lj:module-open", { detail: { id: "bible" } }));
    expect(PlayerKeyboard.hasKeys(realKey)).toBe(false);
  });

  it("com a janela da mídia na tela o player tem o teclado: ela é modal", () => {
    appdata[KEYS.MODULES.MEDIA.SHOW] = true;
    expect(PlayerKeyboard.hasKeys(realKey)).toBe(true);
  });

  it("minimizar a janela da mídia devolve as teclas à tela", () => {
    click(player);
    PlayerKeyboard.release();
    expect(PlayerKeyboard.hasKeys(realKey)).toBe(false);
  });

  it("o controle remoto passa o slide de qualquer foco", () => {
    click(list);
    expect(PlayerKeyboard.hasKeys(remoteKey)).toBe(true);
  });

  it("o que o operador põe no ar leva o teclado junto", () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    setUserActivation(true);
    PlayerKeyboard.claim();
    expect(PlayerKeyboard.hasKeys(realKey)).toBe(true);
  });

  it("o que entra no ar sozinho não tira as teclas de onde o operador está", () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    setUserActivation(false);
    PlayerKeyboard.claim();
    expect(PlayerKeyboard.hasKeys(realKey)).toBe(false);
  });

  it("com a janela em segundo plano o claim não vale (abertura pelo controle remoto)", () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    setUserActivation(true);
    PlayerKeyboard.claim();
    expect(PlayerKeyboard.hasKeys(realKey)).toBe(false);
  });
});
