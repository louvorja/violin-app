import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * O toast nasce na base da janela, onde o rodapé do player aparece quando há
 * mídia tocando. Com `bottom` fixo ele ficava por cima da barra de progresso e
 * dos controles — sem erro no console, só um aviso cobrindo o que o operador
 * precisa clicar. O contrato tem três pontas, e qualquer uma que se perca
 * devolve o defeito em silêncio: o token existe, o toast o consome, o rodapé o
 * publica (e o limpa ao sair).
 */
const ler = (caminho: string) => readFileSync(caminho, "utf8");

describe("toast apoiado no rodapé (--lj-dock-offset)", () => {
  it("o token nasce em ui.css com valor neutro", () => {
    expect(ler("src/assets/styles/ui.css")).toMatch(/--lj-dock-offset:\s*0px;/);
  });

  it("o LjToast soma a altura do rodapé ao afastamento da base", () => {
    const toast = ler("src/components/ui/LjToast.vue");
    expect(toast).toMatch(/bottom:\s*calc\(var\(--lj-dock-offset,\s*0px\)\s*\+\s*var\(--lj-space-7\)\)/);
    expect(toast, "sem `bottom` fixo, que ignorava o rodapé").not.toMatch(/bottom:\s*var\(--lj-space-7\);/);
  });

  it("o Footer publica a altura real em :root e limpa ao desmontar", () => {
    const footer = ler("src/layout/Footer.vue");
    expect(footer).toMatch(/setProperty\("--lj-dock-offset"/);
    expect(footer).toMatch(/removeProperty\("--lj-dock-offset"\)/);
    expect(footer, "a altura varia com o que o rodapé mostra: precisa observar o tamanho").toMatch(
      /new ResizeObserver\(/
    );
    expect(footer, "recolhido, o offset é zero").toMatch(/footerActive\.value && footerEl\.value/);
  });

  it("o design system documenta o token", () => {
    expect(ler("docs/design-system.md")).toContain("--lj-dock-offset");
  });
});
