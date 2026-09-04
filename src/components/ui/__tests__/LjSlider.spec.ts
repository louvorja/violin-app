import { beforeAll, describe, expect, it } from "vitest";
import { nextTick } from "vue";
import LjSlider from "../LjSlider.vue";
import { mountUi } from "./mountUi";

/**
 * O Slider do Reka mede o thumb com ResizeObserver, que o jsdom não tem. O
 * dublê abaixo só impede o erro de montagem — nenhuma asserção depende de
 * medida, porque medida não é testável fora do navegador.
 */
beforeAll(() => {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  const g = globalThis as unknown as { ResizeObserver?: unknown };
  g.ResizeObserver = g.ResizeObserver || ResizeObserverStub;
});

/** O thumb é o elemento que carrega o papel e o estado ARIA do controle. */
const thumb = (w: ReturnType<typeof mountUi>) => w.find('[role="slider"]');

/**
 * O Reka só escreve aria-valuenow depois do primeiro tick (ele espera a
 * montagem do thumb), então toda montagem aqui já espera esse tick.
 */
async function montar(props: Record<string, unknown>) {
  const w = mountUi(LjSlider, { props });
  await nextTick();
  return w;
}

/** Primeiro payload do v-model, já desembrulhado do array de argumentos. */
const primeiroValor = (w: ReturnType<typeof mountUi>) => {
  const eventos = w.emitted("update:modelValue") as unknown[][] | undefined;
  return eventos?.[0]?.[0];
};

describe("LjSlider", () => {
  it("expõe um único thumb com papel de slider e foco por teclado", async () => {
    const w = await montar({ modelValue: 30 });
    expect(w.findAll('[role="slider"]')).toHaveLength(1);
    expect(thumb(w).attributes("tabindex")).toBe("0");
    expect(thumb(w).attributes("aria-orientation")).toBe("horizontal");
  });

  it("leva o número recebido para o estado ARIA do thumb", async () => {
    const w = await montar({ modelValue: 42 });
    expect(thumb(w).attributes("aria-valuenow")).toBe("42");
  });

  it("anuncia min e max recebidos", async () => {
    const w = await montar({ modelValue: 20, min: 10, max: 50 });
    expect(thumb(w).attributes("aria-valuemin")).toBe("10");
    expect(thumb(w).attributes("aria-valuemax")).toBe("50");
  });

  it("devolve um número no update:modelValue, nunca um array", async () => {
    const w = await montar({ modelValue: 30, step: 5 });
    await thumb(w).trigger("keydown", { key: "ArrowRight" });

    const eventos = w.emitted("update:modelValue") as unknown[][];
    expect(eventos).toHaveLength(1);
    // Um argumento só: o valor cru, sem o array de thumbs do Reka vazando.
    expect(eventos[0]).toHaveLength(1);
    expect(Array.isArray(eventos[0][0])).toBe(false);
    expect(typeof eventos[0][0]).toBe("number");
    expect(eventos[0][0]).toBe(35);
  });

  it("anda de acordo com o step, inclusive decimal", async () => {
    const inteiro = await montar({ modelValue: 30, step: 25 });
    await thumb(inteiro).trigger("keydown", { key: "ArrowRight" });
    expect(primeiroValor(inteiro)).toBe(50);

    const decimal = await montar({ modelValue: 1, min: 0, max: 2, step: 0.1 });
    await thumb(decimal).trigger("keydown", { key: "ArrowRight" });
    expect(primeiroValor(decimal)).toBe(1.1);
  });

  it("não passa do min nem do max pelo teclado", async () => {
    const w = await montar({ modelValue: 20, min: 10, max: 50 });
    await thumb(w).trigger("keydown", { key: "Home" });
    await thumb(w).trigger("keydown", { key: "End" });
    expect(w.emitted("update:modelValue")).toEqual([[10], [50]]);
  });

  it("não emite quando já está no limite", async () => {
    const w = await montar({ modelValue: 100, min: 0, max: 100 });
    await thumb(w).trigger("keydown", { key: "ArrowRight" });
    await thumb(w).trigger("keydown", { key: "End" });
    expect(w.emitted("update:modelValue")).toBeUndefined();
  });

  it("é controlado: só se move quando o pai devolve o valor", async () => {
    const w = await montar({ modelValue: 30, step: 5, showValue: true });

    await thumb(w).trigger("keydown", { key: "ArrowRight" });
    expect(primeiroValor(w)).toBe(35);
    // Enquanto o pai não confirmar, o controle continua marcando 30.
    expect(thumb(w).attributes("aria-valuenow")).toBe("30");
    expect(w.find(".lj-slider__value").text()).toBe("30");

    await w.setProps({ modelValue: 35 });
    await nextTick();
    expect(thumb(w).attributes("aria-valuenow")).toBe("35");
    expect(w.find(".lj-slider__value").text()).toBe("35");

    // E a próxima tecla parte do valor novo, não do antigo.
    await thumb(w).trigger("keydown", { key: "ArrowRight" });
    expect(w.emitted("update:modelValue")).toEqual([[35], [40]]);
  });

  it("mostra o valor com a unidade quando pedido", async () => {
    const w = await montar({ modelValue: 30, showValue: true, unit: "%" });
    // "30%" — não "[ 30 ]%", que é o que apareceria se o array do Reka vazasse.
    expect(w.find(".lj-slider__value").text()).toBe("30%");

    await w.setProps({ modelValue: 80 });
    await nextTick();
    expect(w.find(".lj-slider__value").text()).toBe("80%");
  });

  it("mostra só o número quando não há unidade", async () => {
    const w = await montar({ modelValue: 7, showValue: true });
    expect(w.find(".lj-slider__value").text()).toBe("7");
  });

  it("esconde o valor por padrão, mesmo com unidade", async () => {
    const w = await montar({ modelValue: 7, unit: "%" });
    expect(w.find(".lj-slider__value").exists()).toBe(false);
  });

  it("desabilitado anuncia o estado, sai da ordem de foco e não emite", async () => {
    const w = await montar({ modelValue: 30, disabled: true });
    expect(w.find(".lj-slider").attributes("aria-disabled")).toBe("true");
    expect(thumb(w).attributes("tabindex")).toBeUndefined();

    await thumb(w).trigger("keydown", { key: "ArrowRight" });
    expect(w.emitted("update:modelValue")).toBeUndefined();
  });

  it("para de emitir assim que é desabilitado em tempo de execução", async () => {
    const w = await montar({ modelValue: 30, disabled: false });
    await w.setProps({ disabled: true });
    await nextTick();
    await thumb(w).trigger("keydown", { key: "ArrowRight" });
    expect(w.emitted("update:modelValue")).toBeUndefined();
  });

  it("dá o nome acessível ao thumb, não ao invólucro", async () => {
    const w = await montar({ modelValue: 30, ariaLabel: "Volume" });
    expect(thumb(w).attributes("aria-label")).toBe("Volume");
    expect(w.find(".lj-slider-wrap").attributes("aria-label")).toBeUndefined();
  });

  // Fora do alcance do jsdom: arrastar o thumb e clicar na trilha dependem de
  // getBoundingClientRect e de captura de ponteiro reais — sem layout, o Reka
  // não consegue converter posição em valor. Só o caminho de teclado é testável.
  // Também fora: LjSlider não tem prop `size` nem rótulo traduzido, então não há
  // contrato de tamanho nem chave i18n a travar aqui.
});
