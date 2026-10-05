import { beforeEach, describe, expect, it } from "vitest";
import { acquireDialogLevel, releaseDialogLevel, resetDialogStack } from "../dialogStack";

describe("pilha de diálogos", () => {
  beforeEach(() => resetDialogStack());

  it("o primeiro diálogo fica na base e o segundo acima", () => {
    const primeiro = Symbol("a");
    const segundo = Symbol("b");
    expect(acquireDialogLevel(primeiro)).toBe(0);
    expect(acquireDialogLevel(segundo)).toBe(1);
  });

  it("quem fecha volta para o nível de baixo, sem deixar buraco", () => {
    const primeiro = Symbol("a");
    const segundo = Symbol("b");
    acquireDialogLevel(primeiro);
    acquireDialogLevel(segundo);
    releaseDialogLevel(segundo);
    // Um terceiro diálogo agora nasce no nível 1, e não no 2 que ficou vago.
    expect(acquireDialogLevel(Symbol("c"))).toBe(1);
  });

  it("soltar o do meio não joga os de cima para baixo", () => {
    const a = Symbol("a");
    const b = Symbol("b");
    const c = Symbol("c");
    expect(acquireDialogLevel(a)).toBe(0);
    expect(acquireDialogLevel(b)).toBe(1);
    expect(acquireDialogLevel(c)).toBe(2);
    releaseDialogLevel(b);
    // `c` continua acima de `a`: a ordem relativa nunca se inverte, que é o
    // que garante que o diálogo do topo-pinte acima.
    expect(acquireDialogLevel(Symbol("d"))).toBe(2);
  });

  it("reabrir põe o diálogo de volta no topo", () => {
    const primeiro = Symbol("a");
    acquireDialogLevel(primeiro);
    const segundo = Symbol("b");
    acquireDialogLevel(segundo);
    releaseDialogLevel(segundo);
    expect(acquireDialogLevel(segundo)).toBe(1);
  });

  it("devolver duas vezes não corrói a pilha", () => {
    const a = Symbol("a");
    acquireDialogLevel(a);
    acquireDialogLevel(Symbol("b"));
    releaseDialogLevel(a);
    releaseDialogLevel(a);
    releaseDialogLevel(a);
    // Se `a` tivesse sido removido três vezes, `b` estaria na base.
    expect(acquireDialogLevel(Symbol("c"))).toBe(1);
  });

  it("devolver um token que nunca entrou é inócuo", () => {
    acquireDialogLevel(Symbol("a"));
    releaseDialogLevel(Symbol("fantasma"));
    expect(acquireDialogLevel(Symbol("b"))).toBe(1);
  });

  it("reservar o mesmo token duas vezes não duplica a entrada", () => {
    const a = Symbol("a");
    acquireDialogLevel(a);
    expect(acquireDialogLevel(a)).toBe(0);
    expect(acquireDialogLevel(Symbol("b"))).toBe(1);
  });
});