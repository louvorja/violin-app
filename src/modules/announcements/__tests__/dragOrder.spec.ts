import { describe, expect, it } from "vitest";
import { aplicarOrdemDoDrag } from "../dragOrder";

interface Item {
  id: string;
  ordem: number;
}

/**
 * Modelo fiel do que o componente faz, sem montar o componente nem o Sortable:
 *
 * - `anuncios` é o array de origem (ordem A,B,C,D);
 * - o Sortable reordena a CÓPIA que o `sorted` devolveu (o arrasto);
 * - `sorted` é um `computed` que lê `a.ordem`: a primeira escrita o suja, e a
 *   próxima leitura reordena pelo valor parcial.
 *
 * O `Proxy` é o que a reatividade do Vue faz — sem ele não haveria sujeira e o
 * teste provaria nada.
 */
function montar(anuncioes: Item[], ordemAposDrag: string[]) {
  let sujo = false;
  /* Cópia profunda: a spec roda dois casos sobre o MESMO array base, e o
     primeiro escreve `ordem` nos objetos — sem copiar, o segundo caso já
     começaria com a ordem do anterior. */
  const origem = anuncioes.map((i) => ({ ...i }));
  const comReatividade = origem.map(
    (item) =>
      new Proxy(item, {
        set(alvo, prop, valor) {
          if (typeof prop !== "string") return true;
          (alvo as Record<string, unknown>)[prop] = valor;
          if (prop === "ordem") sujo = true;
          return true;
        },
      })
  );
  const porId = new Map(comReatividade.map((i) => [i.id, i]));

  let cache = ordemAposDrag.map((id) => porId.get(id)!);
  const sorted = () => {
    if (sujo) {
      cache = [...comReatividade].sort((a, b) => a.ordem - b.ordem);
      sujo = false;
    }
    return cache;
  };

  return { sorted, anuncios: comReatividade };
}

/**
 * O código antigo: relê `sorted.value` na condição E na indexação do laço —
 * que era exatamente `for (i < sorted.value.length) sorted.value[i].ordem = …`.
 */
function aplicarOrdemAntiga<T extends { ordem: number }>(leia: () => T[]): T[] {
  for (let i = 0; i < leia().length; i++) {
    leia()[i].ordem = i + 1;
  }
  return leia();
}

const ORIGINAL: Item[] = [
  { id: "A", ordem: 1 },
  { id: "B", ordem: 2 },
  { id: "C", ordem: 3 },
  { id: "D", ordem: 4 },
];

describe("aplicarOrdemDoDrag", () => {
  it("gravou a ordem do arrasto em cada item", () => {
    const { sorted, anuncios } = montar(ORIGINAL, ["D", "A", "B", "C"]);

    const ordenados = aplicarOrdemDoDrag(sorted);

    /* D foi para a primeira posição: D=1, A=2, B=3, C=4. */
    expect(anuncios.map((a) => [a.id, a.ordem])).toEqual([
      ["A", 2],
      ["B", 3],
      ["C", 4],
      ["D", 1],
    ]);
    /* E o que voltou é a MESMA lista do arrasto, não a antiga. */
    expect(ordenados.map((a) => a.id)).toEqual(["D", "A", "B", "C"]);
  });

  it("regressão: reler o computed no laço restaura a ordem antiga", () => {
    /*
     * É o sintoma relatado — "solta e não reorganiza". Cada escrita de
     * `ordem` suja o computed, a leitura seguinte reordena pelos parciais, e
     * o laço acaba devolvendo os `ordem` de sempre.
     */
    const { sorted, anuncios } = montar(ORIGINAL, ["D", "A", "B", "C"]);

    aplicarOrdemAntiga(sorted);

    expect(anuncios.map((a) => a.ordem)).toEqual([1, 2, 3, 4]);
  });

  it("lista vazia não estoura", () => {
    expect(aplicarOrdemDoDrag(() => [])).toEqual([]);
  });
});
