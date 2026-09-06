import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * `fetch` sem prazo não falha: ele espera. E o padrão do Chrome é de minutos.
 *
 * O sintoma não é "deu erro" — é a tela que não responde. No wifi de igreja com
 * portal cativo, a conexão é aceita e nada volta; o app não descobre que está
 * sem internet, fica pendurado. Foi assim que a tela de projeção congelou
 * esperando a API do YouTube durante um culto.
 *
 * `fetchWithTimeout` resolve as duas pontas: desiste na hora certa e conta o
 * resultado ao indicador de conexão do cabeçalho. Uma chamada crua não faz nem
 * uma coisa nem outra, e o buraco só aparece na igreja, nunca aqui.
 */

const RAIZ = "src";

/** `fetch(` que não seja `fetchWithTimeout(` nem método de algum objeto. */
const FETCH_CRU = /(?<![\w.$])fetch\s*\(/g;

/** Único lugar autorizado: é ele quem embrulha o `fetch` do navegador. */
const AUTORIZADO = join("src", "helpers", "Http.ts");

function arquivos(dir: string): string[] {
  const achados: string[] = [];
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) {
      achados.push(...arquivos(caminho));
    } else if (/\.(vue|ts|js)$/.test(nome) && !/\.spec\.[tj]s$/.test(nome)) {
      achados.push(caminho);
    }
  }
  return achados;
}

describe("toda ida à rede passa por fetchWithTimeout", () => {
  it("não há fetch cru fora de helpers/Http.ts", () => {
    const infratores: string[] = [];

    for (const caminho of arquivos(RAIZ)) {
      if (caminho === AUTORIZADO) continue;
      const conteudo = readFileSync(caminho, "utf8");
      for (const achado of conteudo.matchAll(FETCH_CRU)) {
        const linha = conteudo.slice(0, achado.index).split("\n").length;
        infratores.push(`${caminho}:${linha}`);
      }
    }

    expect(infratores).toEqual([]);
  });
});
