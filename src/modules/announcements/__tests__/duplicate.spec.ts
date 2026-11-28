import { describe, expect, it } from "vitest";
import { reactive } from "vue";
import { duplicarAnuncio } from "../duplicate";

interface Anuncio {
  id: string;
  nome: string;
  ordem: number;
  texto?: string;
  imageData?: Blob;
  imageMime?: string;
  style: { bgColor: string; textColor: string; fontSize: number; align: "left" | "center" };
}

function anuncio(extra: Partial<Anuncio> = {}): Anuncio {
  return {
    id: "a1",
    nome: "Culto jovem",
    ordem: 2,
    texto: "Sábado às 17h",
    style: { bgColor: "#000000", textColor: "#ffffff", fontSize: 48, align: "center" },
    ...extra,
  };
}

describe("duplicarAnuncio", () => {
  /* O caso que quebrava em produção: o item do menu é um Proxy reativo, e
     structuredClone recusa Proxy. A cópia tem de sair um objeto comum. */
  it("copia um anúncio reativo sem lançar e devolve um objeto que o IndexedDB aceita", () => {
    const original = reactive(anuncio());
    expect(() => structuredClone(original)).toThrow();

    const copia = duplicarAnuncio(original, [1, 2, 3], "novo");

    expect(() => structuredClone(copia)).not.toThrow();
    expect(() => structuredClone(copia.style)).not.toThrow();
  });

  it("dá id novo, marca o nome como cópia e põe no fim da lista", () => {
    const copia = duplicarAnuncio(reactive(anuncio()), [1, 2, 7], "novo");

    expect(copia.id).toBe("novo");
    expect(copia.nome).toBe("Culto jovem (cópia)");
    expect(copia.ordem).toBe(8);
    expect(copia.texto).toBe("Sábado às 17h");
  });

  it("começa a ordem em 1 quando a lista está vazia", () => {
    expect(duplicarAnuncio(anuncio(), [], "novo").ordem).toBe(1);
  });

  it("leva a imagem junto, pelo mesmo Blob", () => {
    const imagem = new Blob(["png"], { type: "image/png" });
    const copia = duplicarAnuncio(
      reactive(anuncio({ imageData: imagem, imageMime: "image/png" })),
      [2],
      "novo"
    );

    expect(copia.imageData).toBe(imagem);
    expect(copia.imageMime).toBe("image/png");
  });

  it("dá à cópia um style próprio, sem mexer no original", () => {
    const original = reactive(anuncio());
    const copia = duplicarAnuncio(original, [2], "novo");

    copia.style.fontSize = 72;

    expect(original.style.fontSize).toBe(48);
    expect(original.id).toBe("a1");
    expect(original.nome).toBe("Culto jovem");
  });
});
