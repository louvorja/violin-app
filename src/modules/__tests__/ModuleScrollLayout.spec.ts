import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// jsdom não calcula layout; o contrato que garante rolagem é o CSS: raiz flex
// com altura fixa e grade flexível com overflow. Sem isso a grade cresce e é
// cortada pelo `overflow:hidden` do módulo.
function cssOf(relativePath: string): string {
  return readFileSync(resolve(__dirname, "..", relativePath), "utf8");
}

function rule(source: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return source.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
}

function expectScrollableGrid(css: string, selector: string): void {
  const grid = rule(css, selector);
  expect(grid).toMatch(/overflow-y:\s*auto/);
  expect(grid).toMatch(/min-height:\s*0/);
  expect(grid).toMatch(/flex:\s*1/);
  // Sem max-content as linhas encolhem para caber na altura em vez de rolar.
  expect(grid).toMatch(/grid-auto-rows:\s*max-content/);
}

describe("layout de rolagem dos módulos com grade", () => {
  it("Projeção de Fundo: raiz flex e grade com rolagem própria", () => {
    const css = cssOf("background_projection/components/Index.vue");
    expect(rule(css, ".bg-root")).toMatch(/display:\s*flex/);
    expectScrollableGrid(css, ".bg-grid");
  });

  it("Biblioteca de Mídia: coluna flex e grade com rolagem própria", () => {
    const css = cssOf("media_library/components/Index.vue");
    expect(rule(css, ".media-library")).toMatch(/display:\s*flex/);
    expect(rule(css, ".media-library")).toMatch(/min-height:\s*0/);
    expect(rule(css, ".media-search")).toMatch(/flex-shrink:\s*0/);
    expect(rule(css, ".media-chips")).toMatch(/flex-shrink:\s*0/);
    expectScrollableGrid(css, ".media-grid");
  });

  it("Som de Fundo: raiz flex e grade com rolagem própria", () => {
    const css = cssOf("background_sound/components/Index.vue");
    expect(rule(css, ".bgm-root")).toMatch(/display:\s*flex/);
    expectScrollableGrid(css, ".bgs-audio-grid");
  });
});
