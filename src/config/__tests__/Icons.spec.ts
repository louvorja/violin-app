import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { ICONS } from "../Icons";
import { TABLER_ICONS } from "@/components/ui/tablerIcons";

/**
 * Todo nome do catálogo tem de resolver em algum desenho.
 *
 * Este teste existe porque seis nomes não existiam — e dois eram renderizados:
 * o cabeçalho do diálogo de inicialização e todo item de liturgia do tipo
 * overlay apareciam com um espaço vazio no lugar do ícone. Nada acusava, e a
 * falha continua muda: `LjIcon` não acha o nome, não renderiza nada, e a tela
 * sai com um buraco do tamanho do ícone.
 */
const marcas = new Set(
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

const pascal = (nome: string) =>
  "Icon" +
  nome
    .split("-")
    .map((p) => p[0].toUpperCase() + p.slice(1))
    .join("");

const vemDoPacote = (nome: string) =>
  existsSync(`node_modules/@tabler/icons-vue/dist/esm/icons/${pascal(nome)}.mjs`);

describe("catálogo de ícones", () => {
  it("o registro do pacote foi lido", () => {
    expect(Object.keys(TABLER_ICONS).length).toBeGreaterThan(200);
  });

  it("toda constante ICONS.* resolve no pacote ou numa marca do projeto", () => {
    const quebrados = catalogo
      .filter(([, valor]) => !TABLER_ICONS[valor] && !marcas.has(valor))
      .map(([caminho, valor]) => `ICONS.${caminho} = ${valor}`);
    expect(quebrados).toEqual([]);
  });

  it("o registro do pacote não guarda entrada que ninguém pede", () => {
    const usados = new Set(catalogo.map(([, valor]) => valor));
    expect(
      Object.keys(TABLER_ICONS)
        .filter((nome) => !usados.has(nome))
        .sort()
    ).toEqual([]);
  });

  it("src/assets/icons guarda só as marcas do projeto", () => {
    // A porta que este teste tranca: SVG solto no repositório. O acervo de
    // interface vem do pacote, e arquivo copiado ao lado dele congela na versão
    // do dia da cópia — foi disso que a troca do MDI veio nos livrar. Marca
    // nova é decisão consciente, e passa por ICONS.CUSTOM.
    const declaradas = new Set(Object.values(ICONS.CUSTOM));
    expect([...marcas].filter((nome) => !declaradas.has(nome)).sort()).toEqual([]);
    expect([...declaradas].filter((nome) => !marcas.has(nome)).sort()).toEqual([]);
  });

  it("nenhuma marca duplica desenho que o pacote já tem", () => {
    expect([...marcas].filter(vemDoPacote).sort()).toEqual([]);
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

  it("os desenhos de contorno não trazem preenchimento próprio", () => {
    // `LjIcon` só repinta a marca que NÃO usa currentColor — é assim que ele
    // distingue a de cor fixa da desenhada em contorno. Uma de contorno com cor
    // cravada escaparia da regra e ficaria preta em tema escuro, sem erro nenhum.
    const suspeitos: string[] = [];
    for (const nome of marcas) {
      const svg = readFileSync(`src/assets/icons/${nome}.svg`, "utf8");
      if (!svg.includes("currentColor")) continue;
      if (/(?:fill|stroke)="#[0-9a-fA-F]/.test(svg)) suspeitos.push(nome);
    }
    expect(suspeitos).toEqual([]);
  });
});
