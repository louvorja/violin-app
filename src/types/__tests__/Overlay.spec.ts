import { describe, expect, it } from "vitest";
import { createOverlaySlot } from "@/types/Overlay";

/**
 * "Duplicar" pede um id novo passando `id: undefined` junto com o resto do slot
 * copiado. O spread dos overrides vem por último na fábrica, então esse
 * `undefined` apagava o id gerado e a cópia chegava ao IndexedDB sem chave:
 * `put` falhava com "key path did not yield a value" e o botão não fazia nada
 * além de encher o console de erro.
 */
describe("createOverlaySlot", () => {
  it("gera um id quando nenhum é pedido", () => {
    expect(createOverlaySlot().id).toMatch(/[0-9a-f-]{36}/);
  });

  it("gera um id novo quando o override traz id undefined", () => {
    const original = createOverlaySlot({ name: "Logo" });
    const copy = createOverlaySlot({ ...original, id: undefined, name: "Logo (cópia)" });

    expect(copy.id).toBeTruthy();
    expect(copy.id).not.toBe(original.id);
    expect(copy.name).toBe("Logo (cópia)");
  });

  it("gera um id novo quando o override traz id vazio", () => {
    expect(createOverlaySlot({ id: "" }).id).toBeTruthy();
  });

  it("respeita um id explícito", () => {
    expect(createOverlaySlot({ id: "fixo" }).id).toBe("fixo");
  });
});
