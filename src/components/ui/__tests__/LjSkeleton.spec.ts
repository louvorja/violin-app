import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import LjSkeleton from "../LjSkeleton.vue";
import { mountUi } from "./mountUi";

/**
 * O esqueleto é puro enfeite: ocupa o lugar de um conteúdo que ainda não
 * chegou. Duas coisas, portanto, precisam ser verdade ao mesmo tempo — ele tem
 * de ser invisível para o leitor de tela (senão o operador cego ouve caixas
 * vazias no lugar da lista de músicas) e tem de respeitar exatamente as medidas
 * pedidas (senão o layout pula quando o conteúdo real entra).
 *
 * Fora de teste, por natureza do jsdom: o shimmer (animação e gradiente vêm de
 * estilo com escopo, que o test-utils não injeta) e qualquer medida real em
 * pixels — só dá para afirmar o que o componente declara, não o que o
 * navegador calcularia.
 */
describe("LjSkeleton", () => {
  it("fica escondido do leitor de tela", () => {
    const w = mountUi(LjSkeleton);
    expect(w.attributes("aria-hidden")).toBe("true");
    // Nada de papel, nome ou parada de tabulação: não há o que anunciar nem
    // onde focar em um espaço reservado.
    expect(w.attributes("role")).toBeUndefined();
    expect(w.attributes("aria-label")).toBeUndefined();
    expect(w.attributes("tabindex")).toBeUndefined();
    expect(w.text()).toBe("");
  });

  it("honra width, height e radius informados", () => {
    const w = mountUi(LjSkeleton, { props: { width: "70%", height: "40px", radius: "8px" } });
    const style = w.attributes("style") ?? "";
    expect(style).toContain("width: 70%");
    expect(style).toContain("height: 40px");
    expect(style).toContain("border-radius: 8px");
  });

  it("aceita qualquer unidade CSS, inclusive calc e porcentagem", () => {
    const w = mountUi(LjSkeleton, {
      props: { width: "calc(100% - 8px)", height: "3rem", radius: "50%" },
    });
    const style = w.attributes("style") ?? "";
    expect(style).toContain("width: calc(100% - 8px)");
    expect(style).toContain("height: 3rem");
    expect(style).toContain("border-radius: 50%");
  });

  it("desenha uma linha de 100% por 12px quando nada é informado", () => {
    const style = mountUi(LjSkeleton).attributes("style") ?? "";
    expect(style).toContain("width: 100%");
    expect(style).toContain("height: 12px");
  });

  it("medida indefinida cai no padrão em vez de sumir do estilo", () => {
    // Caso real: :width="larguraCalculada" antes de a conta existir.
    const w = mountUi(LjSkeleton, {
      props: { width: undefined, height: undefined, radius: undefined },
    });
    const el = w.element as HTMLElement;
    expect(el.style.width).toBe("100%");
    expect(el.style.height).toBe("12px");
    expect(el.style.borderRadius).not.toBe("");
  });

  it("raio zero fica em zero e não volta ao padrão do tema", () => {
    const el = mountUi(LjSkeleton, { props: { radius: "0" } }).element as HTMLElement;
    expect(el.style.borderRadius).not.toContain("var(");
    expect(parseFloat(el.style.borderRadius)).toBe(0);
  });

  it("acompanha a troca de medidas em tempo de execução e segue escondido", async () => {
    const w = mountUi(LjSkeleton, { props: { width: "10px" } });
    await w.setProps({ width: "90px", height: "3rem", radius: "999px" });
    const style = w.attributes("style") ?? "";
    expect(style).toContain("width: 90px");
    expect(style).toContain("height: 3rem");
    expect(style).toContain("border-radius: 999px");
    expect(style).not.toContain("width: 10px");
    expect(w.attributes("aria-hidden")).toBe("true");
  });

  it("não perde as próprias medidas ao receber estilo de layout de fora", () => {
    // Uso do catálogo: vários esqueletos empilhados, com espaçamento vindo do
    // consumidor. O espaçamento entra, a medida do esqueleto permanece.
    const w = mountUi(LjSkeleton, {
      props: { width: "45%" },
      attrs: { style: "margin-bottom: 8px" },
    });
    const style = w.attributes("style") ?? "";
    expect(style).toContain("width: 45%");
    expect(style).toContain("height: 12px");
    expect(style).toContain("margin-bottom: 8px");
  });

  it("ignora conteúdo passado por engano", () => {
    const w = mountUi(LjSkeleton, { slots: { default: "Carregando" } });
    expect(w.text()).toBe("");
  });

  it("o raio padrão aponta para um token que existe no tema", () => {
    // Um token renomeado não quebra nada visível no teste de unidade, mas deixa
    // o esqueleto de canto reto no app — por isso a checagem vai à fonte.
    const raio = (mountUi(LjSkeleton).element as HTMLElement).style.borderRadius;
    const token = /var\((--[\w-]+)\)/.exec(raio)?.[1];
    expect(token, `o raio padrão deveria vir de um token do tema, veio "${raio}"`).toBeTruthy();

    const tokens = readFileSync(resolve(process.cwd(), "src/assets/styles/tokens.css"), "utf8");
    expect(tokens).toContain(`${token}:`);
  });
});
