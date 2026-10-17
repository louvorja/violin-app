/**
 * A diretiva encolhe a linha para caber — e precisa medir o PALCO, não a
 * própria caixa.
 *
 * Desde que o fundo do texto encolhe até o texto (`width: fit-content`), medir
 * o próprio elemento daria sempre "cabe": a redução nunca dispararia e uma
 * hora/minuto longa quebraria linha em vez de encolher. Com `widthFrom`, quem
 * encolhe é o palco; sem ele, vale o comportamento antigo (medir o pai).
 *
 * O cenário do par de testes é o caso real: palco largo, caixa apertada.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, nextTick, ref } from "vue";
import { vFitClockLine } from "@/modules/clock/vFitClockLine";

/** Largura por classe: o jsdom não mede layout, então medimos o que importa. */
let larguras: Record<string, number> = {};
/** Largura do texto desenhado pela Range, para a diretiva comparar. */
let larguraDoTexto = 600;

const Alvo = defineComponent({
  directives: { fitClockLine: vFitClockLine },
  props: { tamanho: { type: String, default: "50" }, usarPalco: { type: Boolean, default: false } },
  /* O ref precisa existir no escopo para o template conseguir passá-lo à
     diretiva — sem declarar, `widthFrom` chegaria vazio e o teste mediria a
     coisa errada. */
  setup() {
    return { palco: ref(null) };
  },
  template: `<div class="palco" ref="palco">
      <div class="caixa" :style="{ width: usarPalco ? 'fit-content' : '100%' }">
        <span
          class="linha"
          v-fit-clock-line="usarPalco ? { size: tamanho, widthFrom: palco } : tamanho"
        >23:59:59</span>
      </div>
    </div>`,
});

beforeEach(() => {
  larguras = { palco: 1000, caixa: 100, linha: 600 };
  larguraDoTexto = 600;

  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get(this: HTMLElement) {
      return larguras[this.className] ?? 1000;
    },
  });
  vi.spyOn(document, "createRange").mockReturnValue({
    selectNodeContents: () => {},
    getBoundingClientRect: () => ({ width: larguraDoTexto }),
  } as unknown as Range);
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth;
});

const fonteDa = (w: Awaited<ReturnType<typeof mount>>) =>
  Number.parseFloat((w.find(".linha").element as HTMLElement).style.fontSize);

describe("v-fit-clock-line", () => {
  it("com o palco informado, a linha NÃO encolhe por causa da caixa apertada", async () => {
    /* Palco de 1000px e texto de 600px: cabe inteiro. A caixa encolhe até o
       texto, e medir ELA daria "cabe" só por acidente — o que prova que a
       diretiva está olhando o lugar certo. */
    const w = mount(Alvo, { props: { tamanho: "50", usarPalco: true } });
    await nextTick();

    expect(fonteDa(w)).toBe(50);
  });

  it("sem palco informado, vale o comportamento antigo: mede o pai", async () => {
    /* Mesma tela, sem `widthFrom`: a diretiva mede a caixa (100px) e encolhe o
       bastante para caber ali. É o comportamento de antes — preservado. */
    const w = mount(Alvo, { props: { tamanho: "50", usarPalco: false } });
    await nextTick();

    const fonte = fonteDa(w);
    expect(fonte).toBeGreaterThan(0);
    expect(fonte).toBeLessThan(50);
  });

  it("quando o texto NÃO cabe no palco, encolhe até caber", async () => {
    larguras = { palco: 400, caixa: 400, linha: 400 };
    larguraDoTexto = 900;

    const w = mount(Alvo, { props: { tamanho: "50", usarPalco: true } });
    await nextTick();

    /* 50px * (398 do palco / 900 do texto) — encolheu, e continua legível. */
    const fonte = fonteDa(w);
    expect(fonte).toBeGreaterThan(0);
    expect(fonte).toBeLessThan(50);
  });

  it("tamanho inválido não mexe na fonte", async () => {
    const w = mount(Alvo, { props: { tamanho: "abc", usarPalco: true } });
    await nextTick();

    expect((w.find(".linha").element as HTMLElement).style.fontSize).toBe("");
  });
});
