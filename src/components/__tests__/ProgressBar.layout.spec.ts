import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// jsdom não calcula layout; o que se pode travar é a regra que impede o botão
// de acompanhar a largura do nome do arquivo.
describe("ProgressBar — layout estável", () => {
  const source = readFileSync(resolve(__dirname, "../ProgressBar.vue"), "utf8");

  it("estica a raiz, para não herdar o alinhamento ao início de .opt-row--col", () => {
    expect(source).toMatch(/\.pgb\s*{[^}]*align-items:\s*stretch/);
    expect(source).toMatch(/\.pgb\s*{[^}]*width:\s*100%/);
  });

  it("separa o nome do arquivo do botão e corta o nome em uma linha", () => {
    expect(source).toMatch(/\.pgb__foot\s*{[^}]*justify-content:\s*space-between/);
    expect(source).toMatch(/\.pgb__current\s*{[^}]*text-overflow:\s*ellipsis/);
    expect(source).toMatch(/\.pgb__current\s*{[^}]*white-space:\s*nowrap/);
  });
});
