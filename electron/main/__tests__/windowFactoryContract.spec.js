// @vitest-environment node
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Liga o `main.cjs` ao `module.exports` da factory.
 *
 * Nenhum teste unitário carrega os dois: um export que some passa em TODO o
 * `npm test` e só estoura quando o app abre — foi exatamente isso que
 * `windowFactory.setOperationMeasurer is not a function` apontou no boot.
 * Aqui a ligação é feita pelo texto, que é o que não depende de Electron.
 */
const ler = (rel) => fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const MAIN = ler("../../main.cjs");
const FACTORY = ler("../windowFactory.js");

const blocoExports = FACTORY.match(/module\.exports\s*=\s*\{([\s\S]*?)\};/);
const exportados = blocoExports
  ? [...blocoExports[1].matchAll(/^\s*([A-Za-z0-9_]+),\s*$/gm)].map((m) => m[1])
  : [];

/*
 * Propriedade acessada em qualquer lugar do main — com ou sem chamada.
 * Sai antes o que é referência de caminho e o que é comentário: sem isso o
 * `.js` de `require("./main/windowFactory.js")` e de `// (windowFactory.js)`
 * viram uma propriedade inventada e um falso "faltando".
 */
const SEM_RUIDO = MAIN
  .replace(/require\([^)]*\)/g, "")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");
const usados = [
  ...new Set([...SEM_RUIDO.matchAll(/windowFactory\.([A-Za-z0-9_]+)/g)].map((m) => m[1])),
];

describe("windowFactory: o que o main acessa existe na factory", () => {
  it("leu as duas pontas de verdade", () => {
    expect(exportados.length).toBeGreaterThan(5);
    expect(usados.length).toBeGreaterThan(0);
    /* Sanidade: o regex achou o objeto certo, não um comentário. */
    expect(exportados).toContain("openOnMonitor");
  });

  it("toda propriedade windowFactory.X usada no main está exportada", () => {
    expect(usados.filter((nome) => !exportados.includes(nome))).toEqual([]);
  });

  it("cobre o caso que derrubou o boot", () => {
    expect(usados).toContain("setOperationMeasurer");
    expect(exportados).toContain("setOperationMeasurer");
    expect(exportados).toContain("setSiteNavigationListener");
  });
});
