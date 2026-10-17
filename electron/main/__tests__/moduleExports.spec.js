// @vitest-environment node
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Nenhum export órfão no processo principal.
 *
 * `electron/**` é JavaScript puro: o `typecheck` não passa por lá e nenhum
 * teste importa esses módulos de verdade (importar `main.cjs` carrega o
 * Electron inteiro). Então um nome que ficou no `module.exports` sem
 * definição só estoura no BOOT do app, na frente do operador:
 *
 *   ReferenceError: isTransparent is not defined
 *       at Object.<anonymous> (electron/main/windowFactory.js:1076:3)
 *
 * Este teste é a única rede que pega isso antes do primeiro start.
 */
/* O diretório `electron/` em si: dois níveis acima deste arquivo. */
const raiz = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

function arquivosJs(dir, acc = []) {
  for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
    const alvo = path.join(dir, entrada.name);
    if (entrada.isDirectory()) arquivosJs(alvo, acc);
    else if (entrada.name.endsWith(".js")) acc.push(alvo);
  }
  return acc;
}

/** Bloco de `module.exports` com entradas simples (`nome,`). */
function exportadosDe(source) {
  const bloco = source.match(/module\.exports\s*=\s*\{([\s\S]*?)\n\};/);
  if (!bloco) return [];
  return [...bloco[1].matchAll(/^\s*([A-Za-z0-9_]+),\s*$/gm)].map((m) => m[1]);
}

describe("processo principal — nenhum export órfão", () => {
  const modulos = arquivosJs(raiz);

  it("varre os módulos do main (e não varre vazio)", () => {
    expect(modulos.length).toBeGreaterThan(10);
  });

  it.each(modulos)("%s não exporta nome que não existe", (arquivo) => {
    const source = fs.readFileSync(arquivo, "utf8");
    const orfaos = exportadosDe(source).filter((nome) => {
      const definido = new RegExp(`(?:function|const|let|var|class)\\s+${nome}\\b`).test(source);
      /*
       * Reexportação é só de duas formas legítimas: puxado de outro módulo
       * (`const { X } = require(...)`) ou atribuído direto
       * (`exports.X = X`). A entrada da própria lista de exports NÃO conta —
       * foi exatamente ela que deixou o `isTransparent` passar.
       */
      const reexportado =
        new RegExp(`\\{[^}]*\\b${nome}\\b[^}]*\\}\\s*=\\s*require\\(`).test(source) ||
        new RegExp(`(?:module\\.)?exports\\.${nome}\\s*=`).test(source);
      return !definido && !reexportado;
    });

    expect(orfaos, `export sem definição: ${orfaos.join(", ")}`).toEqual([]);
  });
});
