// @vitest-environment node
import { describe, expect, it } from "vitest";
import { normalizeKeyName } from "../routes.js";

describe("normalizeKeyName — nome DOM esperado pelo Hotkeys do renderer", () => {
  it("mantém os nomes DOM enviados pelo app", () => {
    expect(normalizeKeyName("ArrowLeft")).toBe("ArrowLeft");
    expect(normalizeKeyName("ArrowRight")).toBe("ArrowRight");
    expect(normalizeKeyName("ArrowUp")).toBe("ArrowUp");
    expect(normalizeKeyName("ArrowDown")).toBe("ArrowDown");
    expect(normalizeKeyName("Home")).toBe("Home");
    expect(normalizeKeyName("End")).toBe("End");
    expect(normalizeKeyName("Space")).toBe("Space");
    expect(normalizeKeyName("Escape")).toBe("Escape");
  });

  it("traduz os códigos VK do modo clássico", () => {
    expect(normalizeKeyName("37")).toBe("ArrowLeft");
    expect(normalizeKeyName("38")).toBe("ArrowUp");
    expect(normalizeKeyName("39")).toBe("ArrowRight");
    expect(normalizeKeyName("40")).toBe("ArrowDown");
    expect(normalizeKeyName("32")).toBe("Space");
    expect(normalizeKeyName("27")).toBe("Escape");
    expect(normalizeKeyName("36")).toBe("Home");
    expect(normalizeKeyName("35")).toBe("End");
  });

  it("aceita aliases comuns", () => {
    expect(normalizeKeyName("esc")).toBe("Escape");
    expect(normalizeKeyName(" ")).toBe("Space");
    expect(normalizeKeyName("space")).toBe("Space");
    expect(normalizeKeyName("arrowright")).toBe("ArrowRight");
  });

  it("deixa letras e teclas simples passarem", () => {
    expect(normalizeKeyName("o")).toBe("o");
    expect(normalizeKeyName("p")).toBe("p");
    expect(normalizeKeyName("PageUp")).toBe("PageUp");
  });

  it("retorna null para entrada vazia", () => {
    expect(normalizeKeyName("")).toBeNull();
    expect(normalizeKeyName(undefined)).toBeNull();
    expect(normalizeKeyName("   ")).toBeNull();
  });
});
