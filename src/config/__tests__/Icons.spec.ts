import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { ICONS } from "../Icons";

/**
 * Todo nome do catálogo tem de ter arquivo em `src/assets/icons/`.
 *
 * Este teste existe porque seis nomes não existiam — e dois eram renderizados:
 * o cabeçalho do diálogo de inicialização e todo item de liturgia do tipo
 * overlay apareciam com um espaço vazio no lugar do ícone. Nada acusava. Com o
 * acervo em SVG a falha é a mesma: `Icon.vue` não acha o arquivo, o `v-else-if`
 * não renderiza nada e a tela sai com um buraco do tamanho do ícone.
 */
const acervo = new Set(
  readdirSync("src/assets/icons")
    .filter((f) => f.endsWith(".svg"))
    .map((f) => f.replace(/\.svg$/, ""))
);

function achataIcons(obj: Record<string, unknown>, prefixo = ""): [string, string][] {
  const saida: [string, string][] = [];
  for (const [chave, valor] of Object.entries(obj)) {
    const caminho = prefixo ? `${prefixo}.${chave}` : chave;
    if (typeof valor === "string") saida.push([caminho, valor]);
    else if (valor && typeof valor === "object")
      saida.push(...achataIcons(valor as Record<string, unknown>, caminho));
  }
  return saida;
}

const catalogo = achataIcons(ICONS as unknown as Record<string, unknown>);

function arquivosDeCodigo(dir: string, saida: string[] = []): string[] {
  for (const entrada of readdirSync(dir)) {
    const caminho = `${dir}/${entrada}`;
    if (statSync(caminho).isDirectory()) {
      if (entrada !== "__tests__" && entrada !== "assets") arquivosDeCodigo(caminho, saida);
      continue;
    }
    if (/\.(vue|ts|js)$/.test(entrada)) saida.push(caminho);
  }
  return saida;
}

describe("catálogo de ícones", () => {
  it("o acervo foi lido", () => {
    expect(acervo.size).toBeGreaterThan(200);
  });

  it("toda constante ICONS.* aponta para um arquivo que existe", () => {
    const quebrados = catalogo
      .filter(([, valor]) => !acervo.has(valor))
      .map(([caminho, valor]) => `ICONS.${caminho} = ${valor}`);
    expect(quebrados).toEqual([]);
  });

  it("nenhum nome de ícone fica escrito fora do catálogo", () => {
    // A troca de acervo acontece editando só o Icons.ts. Um nome escrito direto
    // num template escapa dessa troca e sobrevive como ícone órfão. Foi assim
    // que a família "mdi-" resistiu à primeira tentativa de migração.
    const fora: string[] = [];
    for (const caminho of arquivosDeCodigo("src")) {
      if (caminho.endsWith("config/Icons.ts")) continue;
      readFileSync(caminho, "utf8")
        .split("\n")
        .forEach((linha, i) => {
          if (/^\s*(\*|\/\/)/.test(linha)) return; // menções em comentário
          if (/(["'])mdi-[a-z0-9-]+\1/.test(linha)) fora.push(`${caminho}:${i + 1}`);
        });
    }
    expect(fora).toEqual([]);
  });

  it("todo SVG do acervo é referenciado por alguma constante", () => {
    // Arquivo sem dono é peso morto no bundle: entra pelo import.meta.glob do
    // Icon.vue, que é eager, e ninguém pede.
    const usados = new Set(catalogo.map(([, valor]) => valor));
    expect([...acervo].filter((nome) => !usados.has(nome)).sort()).toEqual([]);
  });

  it("os desenhos de contorno não trazem preenchimento próprio", () => {
    // `Icon.vue` só repinta o SVG que NÃO usa currentColor — é assim que ele
    // distingue as marcas do projeto, de cor fixa, dos ícones de interface. Um
    // ícone de contorno com cor cravada escaparia da regra e ficaria preto em
    // tema escuro, sem erro nenhum.
    const suspeitos: string[] = [];
    for (const nome of acervo) {
      const svg = readFileSync(`src/assets/icons/${nome}.svg`, "utf8");
      if (!svg.includes("currentColor")) continue;
      if (/(?:fill|stroke)="#[0-9a-fA-F]/.test(svg)) suspeitos.push(nome);
    }
    expect(suspeitos).toEqual([]);
  });
});
