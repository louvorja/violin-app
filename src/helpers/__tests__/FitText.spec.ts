import { describe, it, expect } from "vitest";
import { largestFit, chooseFit, fitTextToBox, WRAP_TOLERANCE } from "@/helpers/FitText";

/**
 * O jsdom não calcula layout, então o "navegador" destes testes é um modelo:
 * cada caractere ocupa 0,45 do corpo em largura e cada linha 1,3 do corpo em
 * altura — a régua da fonte condensada de projeção.
 */
const CHAR = 0.45;
const LINE = 1.3;

function modelo(linhas: string[], largura: number) {
  return (px: number, wrap: boolean) => {
    const larguras = linhas.map((l) => l.length * CHAR * px);
    const quebras = wrap ? larguras.map((w) => Math.max(1, Math.ceil(w / largura))) : larguras.map(() => 1);
    return {
      scrollWidth: wrap ? Math.min(Math.max(...larguras), largura) : Math.max(...larguras),
      altura: quebras.reduce((a, b) => a + b, 0) * LINE * px,
    };
  };
}

describe("largestFit", () => {
  it("usa o teto quando o texto cabe nele", () => {
    expect(largestFit(() => true, 10, 100)).toBe(100);
  });

  it("encontra o maior tamanho que ainda cabe, com 1px de tolerância e nunca acima", () => {
    const px = largestFit((p) => p <= 63, 10, 200);
    expect(px).toBeGreaterThanOrEqual(62);
    expect(px).toBeLessThanOrEqual(63);
  });

  it("devolve o piso, e não um corte, quando nem o menor cabe", () => {
    expect(largestFit(() => false, 12, 100)).toBe(12);
  });

  it("aceita teto abaixo do piso sem laço infinito", () => {
    expect(largestFit(() => true, 50, 20)).toBe(50);
  });
});

describe("chooseFit", () => {
  const LARGURA = 1000;
  const cabe = (linhas: string[], altura = 600) => {
    const m = modelo(linhas, LARGURA);
    return (px: number, wrap: boolean) => {
      const r = m(px, wrap);
      return r.scrollWidth <= LARGURA && r.altura <= altura;
    };
  };

  it("mantém o tamanho pedido quando a letra cabe", () => {
    const r = chooseFit(cabe(["Aleluia!", "Aleluia!"]), 20, 150);
    expect(r).toEqual({ px: 150, wrap: false });
  });

  it("encolhe para caber a linha mais comprida sem quebrá-la", () => {
    // 4 linhas de 37 caracteres: a largura manda (1000 / (37 × 0,45) ≈ 60).
    const linha = "x".repeat(37);
    const r = chooseFit(cabe([linha, linha, linha, linha]), 20, 150);
    expect(r.wrap).toBe(false);
    expect(r.px).toBeGreaterThanOrEqual(59);
    expect(r.px).toBeLessThanOrEqual(61);
  });

  it("não quebra uma linha do verso só por ganhar um pouco de tamanho", () => {
    // Sem quebra a linha de 53 caracteres limita a 41px. Quebrá-la custaria uma
    // sexta linha e, com a altura já apertada, só renderia 42px: não compensa.
    const longa = "x".repeat(53);
    const curta = "x".repeat(30);
    const escolha = cabe([curta, curta, longa, curta, curta], 330);
    const r = chooseFit(escolha, 20, 150);
    expect(r.wrap).toBe(false);
    expect(r.px).toBeGreaterThanOrEqual(40);
  });

  it("quebra quando isso rende bem mais que a linha inteira", () => {
    // Uma linha enorme força o tamanho sem quebra lá para baixo.
    const enorme = "x".repeat(200);
    const r = chooseFit(cabe([enorme, "x".repeat(10)]), 10, 150);
    const semQuebra = largestFit((px) => cabe([enorme, "x".repeat(10)])(px, false), 10, 150);
    expect(r.wrap).toBe(true);
    expect(r.px).toBeGreaterThan(semQuebra / WRAP_TOLERANCE);
  });

  it("o resultado sempre cabe, para qualquer quantidade de linhas", () => {
    for (let n = 1; n <= 9; n++) {
      const linhas = Array.from({ length: n }, (_, i) => "x".repeat(20 + i * 4));
      const f = cabe(linhas);
      const r = chooseFit(f, 8, 160);
      expect(f(r.px, r.wrap), `${n} linhas`).toBe(true);
    }
  });
});

describe("fitTextToBox", () => {
  function montar(linhas: string[], largura: number, altura: number) {
    const caixa = document.createElement("div");
    const texto = document.createElement("div");
    caixa.appendChild(texto);
    document.body.appendChild(caixa);
    Object.defineProperty(caixa, "clientWidth", { value: largura });
    Object.defineProperty(caixa, "clientHeight", { value: altura });
    const m = modelo(linhas, largura);
    const atual = () => m(parseFloat(texto.style.fontSize), texto.style.whiteSpace !== "nowrap");
    Object.defineProperty(texto, "scrollWidth", { get: () => atual().scrollWidth });
    texto.getBoundingClientRect = () => ({ height: atual().altura }) as DOMRect;
    return { caixa, texto };
  }

  it("deixa no elemento o tamanho que cabe e o modo de quebra escolhido", () => {
    const linha = "x".repeat(37);
    const { caixa, texto } = montar([linha, linha, linha, linha], 1000, 600);
    const r = fitTextToBox(caixa, texto, 20, 150);
    expect(texto.style.fontSize).toBe(`${r.px}px`);
    expect(texto.style.whiteSpace).toBe(r.wrap ? "normal" : "nowrap");
    expect(parseFloat(texto.style.fontSize)).toBeLessThan(150);
  });

  it("não escreve text-wrap inline: ele e white-space são atalhos da mesma propriedade", () => {
    // Nos navegadores novos, limpar `text-wrap` depois de `white-space: nowrap`
    // apagava o nowrap — o ajuste passava a medir sempre com quebra de linha.
    const { caixa, texto } = montar(["Aleluia!"], 1000, 600);
    fitTextToBox(caixa, texto, 20, 150);
    expect(texto.getAttribute("style")).not.toMatch(/text-wrap/);
  });
});
