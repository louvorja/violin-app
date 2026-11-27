import { afterEach, describe, expect, it } from "vitest";
import {
  awaitingModule,
  heldModuleId,
  navDirection,
  pickNavDirection,
  pickShownModule,
  resetModuleSwap,
  shownModuleId,
} from "@/composables/useModuleSwap";

/**
 * Quem fica na tela enquanto o próximo módulo carrega.
 *
 * O defeito que isto evita não aparece em teste de componente: é um punhado de
 * quadros com o fundo do tema à mostra, entre a aba anterior sair e o chunk da
 * nova chegar. A decisão é uma função pura justamente para poder ser travada
 * aqui.
 */
const ready =
  (...ids: string[]) =>
  (id: string) =>
    ids.includes(id);
const open =
  (...ids: string[]) =>
  (id: string) =>
    ids.includes(id);

describe("pickShownModule", () => {
  it("sem módulo ativo não mostra nenhum (tela inicial)", () => {
    expect(pickShownModule(null, "musics", ready("musics"), open("musics"))).toBeNull();
  });

  it("módulo ativo já carregado entra na hora", () => {
    expect(pickShownModule("bible", "musics", ready("bible"), open("musics", "bible"))).toBe(
      "bible"
    );
  });

  it("módulo ativo ainda carregando: o anterior continua na tela", () => {
    expect(pickShownModule("bible", "musics", ready(), open("musics", "bible"))).toBe("musics");
  });

  it("o anterior fechado no meio da espera não é ressuscitado", () => {
    expect(pickShownModule("bible", "musics", ready(), open("bible"))).toBe("bible");
  });

  it("sem anterior, o próprio ativo ocupa o lugar enquanto carrega", () => {
    expect(pickShownModule("bible", null, ready(), open("bible"))).toBe("bible");
  });

  it("o anterior nunca é o próprio ativo", () => {
    expect(pickShownModule("bible", "bible", ready(), open("bible"))).toBe("bible");
  });
});

describe("estado compartilhado", () => {
  afterEach(resetModuleSwap);

  it("nasce neutro: com Modules.vue desmontado ninguém muda de comportamento", () => {
    expect(shownModuleId.value).toBeNull();
    expect(heldModuleId.value).toBeNull();
    expect(awaitingModule.value).toBe(false);
  });

  it("resetModuleSwap devolve tudo ao valor neutro", () => {
    shownModuleId.value = "musics";
    heldModuleId.value = "musics";
    awaitingModule.value = true;
    resetModuleSwap();
    expect(shownModuleId.value).toBeNull();
    expect(heldModuleId.value).toBeNull();
    expect(awaitingModule.value).toBe(false);
  });
});

describe("pickNavDirection", () => {
  const order = ["musics", "hymnal", "bible", "clock"];

  it("aba mais à direita entra pela direita", () => {
    expect(pickNavDirection("musics", "bible", order)).toBe(1);
  });

  it("aba mais à esquerda entra pela esquerda", () => {
    expect(pickNavDirection("clock", "hymnal", order)).toBe(-1);
  });

  it("vindo da tela inicial não há lado: a página sobe", () => {
    expect(pickNavDirection(null, "musics", order)).toBe(0);
  });

  it("voltando à tela inicial não há lado", () => {
    expect(pickNavDirection("musics", null, order)).toBe(0);
  });

  it("aba que acabou de fechar já saiu da faixa: sem lado", () => {
    expect(pickNavDirection("draw", "musics", order)).toBe(0);
  });

  it("a mesma aba não tem direção", () => {
    expect(pickNavDirection("bible", "bible", order)).toBe(0);
  });
});

describe("resetModuleSwap também limpa a troca de página", () => {
  it("a direção volta ao neutro", () => {
    navDirection.value = 1;
    resetModuleSwap();
    expect(navDirection.value).toBe(0);
  });
});
