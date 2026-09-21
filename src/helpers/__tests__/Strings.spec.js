// @vitest-environment node
import { describe, it, expect } from "vitest";
import Strings from "../Strings";

describe("Strings.clean", () => {
  it("converte para minúsculas", () => {
    expect(Strings.clean("ALELUIA")).toBe("aleluia");
  });

  it("remove acentos", () => {
    expect(Strings.clean("ação")).toBe("acao");
    expect(Strings.clean("coração")).toBe("coracao");
    expect(Strings.clean("príncipe")).toBe("principe");
    expect(Strings.clean("glória")).toBe("gloria");
  });

  it("remove caracteres não-alfanuméricos", () => {
    expect(Strings.clean("olá, mundo!")).toBe("olamundo");
    expect(Strings.clean("a-b_c")).toBe("abc");
  });

  it("retorna string vazia para entrada vazia ou nula", () => {
    expect(Strings.clean("")).toBe("");
    expect(Strings.clean(null)).toBe("");
    expect(Strings.clean(undefined)).toBe("");
  });

  it("combina todas as transformações", () => {
    expect(Strings.clean("Ó Santo Espírito!")).toBe("osantoespirito");
  });
});

describe("Strings.sort", () => {
  it("ordena strings ignorando acentos", () => {
    const arr = ["Zéfiro", "aurora", "Água", "brisa"];
    const sorted = [...arr].sort(Strings.sort);
    expect(sorted).toEqual(["Água", "aurora", "brisa", "Zéfiro"]);
  });

  it("ordena números quando ambos são number", () => {
    expect(Strings.sort(1, 2)).toBeLessThan(0);
    expect(Strings.sort(10, 5)).toBeGreaterThan(0);
    expect(Strings.sort(3, 3)).toBe(0);
  });

  it("strings iguais retornam 0", () => {
    expect(Strings.sort("abc", "abc")).toBe(0);
  });

  it("trata entradas nulas/undefined como string vazia", () => {
    expect(Strings.sort(null, "abc")).toBeLessThanOrEqual(0);
    expect(Strings.sort(undefined, undefined)).toBe(0);
  });
});

describe("Strings.escapeHtml", () => {
  it("escapa os cinco caracteres que abrem marcação ou atributo", () => {
    expect(Strings.escapeHtml(`<a href="x" title='y'>&</a>`)).toBe(
      "&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;"
    );
  });

  it("neutraliza um nome que tenta injetar HTML", () => {
    expect(Strings.escapeHtml("<img src=x onerror=alert(1)>")).not.toContain("<");
  });

  it("preserva os acentos e escapa só o que é sintaxe de HTML", () => {
    expect(Strings.escapeHtml("Ação & Louvor")).toBe("Ação &amp; Louvor");
  });

  it("aceita vazio, nulo e indefinido", () => {
    expect(Strings.escapeHtml("")).toBe("");
    expect(Strings.escapeHtml(null)).toBe("");
    expect(Strings.escapeHtml(undefined)).toBe("");
  });
});
