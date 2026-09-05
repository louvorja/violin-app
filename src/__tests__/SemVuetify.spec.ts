import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";

/**
 * O Vuetify saiu do projeto. Este teste existe para que ele não volte sem que
 * alguém perceba — e a razão é que duas das três amarras falham em silêncio.
 *
 * A tag `<v-card>` some do render e a tela fica vazia sem erro no console. Pior:
 * `d-flex`, `pa-4` e `text-caption` são classes que vinham de `vuetify/styles`;
 * enquanto a folha estava importada, escrevê-las funcionava, e no dia em que ela
 * saiu tudo que dependia delas desmontou de uma vez. Uma classe montada em tempo
 * de execução (`:class="\`align-${x}\`"`) nem aparece numa busca por texto.
 */

const RAIZ = "src";

/** Utilitárias do Vuetify. O filtro real é "está declarada em algum CSS nosso?". */
const UTILITARIA = new RegExp(
  "^(" +
    [
      "d-(flex|none|block|inline|inline-flex|inline-block|inline-table|table)",
      "flex-(column|row|grow-[01]|shrink-[01]|wrap|nowrap|column-reverse|row-reverse|[01])",
      "align-(center|start|end|baseline|stretch|content-[a-z]+|self-[a-z]+)",
      "justify-(center|start|end|space-between|space-around|space-evenly)",
      "text-(caption|body-[12]|h[1-6]|subtitle-[12]|overline|button|center|left|right|start|end" +
        "|justify|truncate|no-wrap|pre-wrap|break|medium-emphasis|high-emphasis|disabled" +
        "|uppercase|lowercase|capitalize|none" +
        "|(primary|secondary|success|info|warning|error|surface|white|black|grey)[-a-z0-9]*)",
      "font-(weight-(thin|light|regular|medium|bold|black)|italic)",
      "rounded(-(0|sm|lg|xl|pill|circle|shaped|te|ts|be|bs|t|b|s|e))?",
      "elevation-([0-9]|1[0-9]|2[0-4])",
      "(w|h)-(100|75|66|50|33|25|auto)",
      "fill-height",
      "ga-[0-9]+",
      "g[xy]-[0-9]+",
      "(m|p)[atrblxysne]?-(auto|n?([0-9]|1[0-6]))",
      "overflow-(auto|hidden|visible|[xy]-(auto|hidden))",
      "position-(relative|absolute|fixed|sticky|static)",
      "bg-(primary|secondary|success|info|warning|error|surface|surface-variant|surface-light" +
        "|surface-bright|background|transparent|white|black|grey[a-z0-9-]*)",
      "border(-(0|opacity-[0-9]+|s|e|t|b|dashed|thin|sm|md|lg|xl))?",
      "opacity-[0-9]+",
      "cursor-pointer",
    ].join("|") +
    ")$"
);

function arquivos(dir: string, ext: string[], saida: string[] = []): string[] {
  for (const entrada of readdirSync(dir)) {
    if (entrada === "node_modules" || entrada === "assets") continue;
    const caminho = `${dir}/${entrada}`;
    if (statSync(caminho).isDirectory()) arquivos(caminho, ext, saida);
    else if (ext.some((e) => entrada.endsWith(e))) saida.push(caminho);
  }
  return saida;
}

const vues = arquivos(RAIZ, [".vue"]);
const fontes = arquivos(RAIZ, [".vue", ".ts", ".js"]);

/** Toda classe declarada em qualquer CSS nosso — folhas globais e `<style>` de SFC. */
const declaradas = (() => {
  const nomes = new Set<string>();
  const colhe = (css: string) => {
    for (const m of css.matchAll(/\.([A-Za-z][\w-]*)/g)) nomes.add(m[1]);
  };
  for (const f of arquivos(`${RAIZ}/assets/styles`, [".css"])) colhe(readFileSync(f, "utf8"));
  for (const f of vues) {
    const src = readFileSync(f, "utf8");
    for (const bloco of src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) colhe(bloco[1]);
  }
  return nomes;
})();

const template = (src: string) => src.split("<script")[0];

describe("o Vuetify não voltou", () => {
  it("nenhum template usa tag <v-*>", () => {
    const achados: string[] = [];
    for (const f of vues) {
      for (const m of template(readFileSync(f, "utf8")).matchAll(/<(v-[a-z-]+)[\s/>]/g)) {
        achados.push(`${f}: <${m[1]}>`);
      }
    }
    expect(achados).toEqual([]);
  });

  it("nenhum template usa classe utilitária que o projeto não declara", () => {
    const achados: string[] = [];
    for (const f of vues) {
      const tpl = template(readFileSync(f, "utf8"));
      for (const m of tpl.matchAll(/(?:^|\s):?class="([^"]*)"/g)) {
        for (const bruto of m[1].split(/[\s{}[\],:?()|&!=<>+]+/)) {
          const c = bruto.replace(/['"`]/g, "");
          if (c && UTILITARIA.test(c) && !declaradas.has(c)) achados.push(`${f}: ${c}`);
        }
      }
    }
    expect(achados).toEqual([]);
  });

  it("a escala de espaçamento do Material não volta nem redeclarada", () => {
    // Esta checagem ignora de propósito se a classe está declarada no repositório.
    // Foi assim que `mr-2` sobreviveu no menu do app: a migração manteve o nome no
    // template e escreveu uma regra local só para ele dentro de um @media — a
    // checagem geral passou a considerá-la "declarada", e no resto das larguras o
    // ícone ficou colado no rótulo. Espaçamento aqui é `gap` no contêiner ou uma
    // classe com nome próprio, sempre em token --lj-space-*.
    const ESCALA = /^(m|p)[atrblxysne]?-(auto|n?([0-9]|1[0-6]))$/;
    const achados: string[] = [];
    for (const f of vues) {
      const tpl = template(readFileSync(f, "utf8"));
      for (const m of tpl.matchAll(/(?:^|\s):?class="([^"]*)"/g)) {
        for (const bruto of m[1].split(/[\s{}[\],:?()|&!=<>+]+/)) {
          const c = bruto.replace(/['"`]/g, "");
          if (c && ESCALA.test(c)) achados.push(`${f}: ${c}`);
        }
      }
    }
    expect(achados).toEqual([]);
  });

  it("nenhum CSS lê variável --v-* do tema do Vuetify", () => {
    // A mais traiçoeira das quatro. `rgba(var(--v-border-color), .2)` sem o
    // pacote não fica "quase certo": a variável não existe, a declaração inteira
    // é inválida no tempo de cálculo e a borda some. Com fallback é pior de
    // notar — a cor congela no valor de emergência e para de seguir o tema.
    const achados: string[] = [];
    for (const f of [...vues, ...arquivos(`${RAIZ}/assets/styles`, [".css"])]) {
      for (const m of readFileSync(f, "utf8").matchAll(/--v-[a-z][\w-]*/g)) {
        achados.push(`${f}: ${m[0]}`);
      }
    }
    expect(achados).toEqual([]);
  });

  it("nada importa do pacote vuetify", () => {
    const achados: string[] = [];
    for (const f of fontes) {
      for (const m of readFileSync(f, "utf8").matchAll(/^.*\bfrom\s+["']vuetify.*$/gm)) {
        achados.push(`${f}: ${m[0].trim()}`);
      }
    }
    expect(achados).toEqual([]);
  });

  it("vuetify e @mdi/font não estão nas dependências", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    expect(Object.keys(deps).filter((d) => d === "vuetify" || d === "@mdi/font")).toEqual([]);
  });
});

/**
 * O reset que o `vuetify/styles` fornecia — e que agora é nosso.
 *
 * Não dá para verificar isto pelo comportamento: o jsdom não calcula layout, e
 * no navegador a falha é silenciosa. Então o teste afirma a presença das regras
 * mesmo, que é o que impede alguém de "limpar" o topo do main.css sem saber que
 * está mudando a geometria do app inteiro.
 */
describe("a base do documento está declarada", () => {
  const css = readFileSync(`${RAIZ}/assets/styles/main.css`, "utf8");

  it("box-sizing universal — sem ele, largura mais padding estoura o container", () => {
    expect(css).toMatch(/\*,\s*\*::before,\s*\*::after\s*\{[^}]*box-sizing:\s*border-box/);
  });

  it("line-height e fonte no html — sem eles o documento cai no padrão do navegador", () => {
    const bloco = css.match(/(^|\n)html\s*\{[^}]*\}/)?.[0] ?? "";
    expect(bloco).toMatch(/line-height:\s*1\.5/);
    expect(bloco).toMatch(/font-family:\s*var\(--lj-font-shell\)/);
  });

  it("controles nativos herdam fonte e cor — o app tem <button> em dezenas de telas", () => {
    const bloco = css.match(/button,\s*\n\s*input,[^}]*\}/)?.[0] ?? "";
    expect(bloco).toMatch(/font:\s*inherit/);
    expect(bloco).toMatch(/color:\s*inherit/);
  });
});
