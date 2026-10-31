/**
 * Quem pode assumir o foco quando um diálogo termina de abrir.
 *
 * O bug real: abrir o player e, em seguida, a paleta de comandos. O autofocus
 * da janela do player chegava ATRASADO e roubava o foco da paleta — o operador
 * abria o Ctrl+K e o que digitava caía na janela de trás.
 */
import { describe, expect, it } from "vitest";
import { deveAssumirFoco } from "../FocusGuard";

function camada(nome: string): HTMLElement {
  const el = document.createElement("div");
  el.className = nome;
  el.setAttribute("data-dismissable-layer", "");
  document.body.append(el);
  return el;
}

describe("deveAssumirFoco", () => {
  it("assume quando o foco não está em camada nenhuma", () => {
    const janela = camada("janela");

    expect(deveAssumirFoco(document.body, janela)).toBe(true);
    expect(deveAssumirFoco(null, janela)).toBe(true);
  });

  it("assume quando o foco já está dentro do próprio diálogo", () => {
    const janela = camada("janela");
    const campo = document.createElement("input");
    janela.append(campo);

    expect(deveAssumirFoco(campo, janela)).toBe(true);
  });

  it("NÃO assume quando outra camada por cima já tem o foco", () => {
    const janela = camada("janela");
    const paleta = camada("paleta");
    const campo = document.createElement("input");
    paleta.append(campo);

    expect(deveAssumirFoco(campo, janela)).toBe(false);
  });

  it("ASSUME quando esta camada é a mais nova (janela aberta sobre outra)", () => {
    const janelaAntiga = camada("janela-antiga");
    const campo = document.createElement("input");
    janelaAntiga.append(campo);
    const janelaNova = camada("janela-nova");

    expect(deveAssumirFoco(campo, janelaNova)).toBe(true);
  });

  it("NÃO assume quando o foco está num menu aberto por cima do diálogo", () => {
    const janela = camada("janela");
    const menu = camada("menu");
    const item = document.createElement("button");
    menu.append(item);
    janela.append(menu);

    expect(deveAssumirFoco(item, janela)).toBe(false);
  });
});
