import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import ProgressBar from "@/components/ProgressBar.vue";

const i18n = createI18n({
  legacy: false,
  locale: "pt",
  messages: { pt: { shell: { background_tasks: { eta: "{time} restantes" } } } },
});

function barPercent(props: Record<string, unknown>): string | undefined {
  const wrapper = mount(ProgressBar, {
    props,
    global: { plugins: [i18n] },
  });
  return wrapper.find('[role="progressbar"]').attributes("aria-valuenow");
}

describe("ProgressBar — percentual pronto", () => {
  it("usa o percentual informado no lugar de done/total", () => {
    // Tarefa de Libras: 1 de 10 itens, mas 42% do trabalho já feito.
    expect(barPercent({ done: 1, total: 10, percent: 42 })).toBe("42");
  });

  it("sem percentual mantém o cálculo por itens", () => {
    expect(barPercent({ done: 1, total: 10 })).toBe("10");
  });

  it("protege contra percentual fora da faixa", () => {
    expect(barPercent({ done: 0, total: 0, percent: 130 })).toBe("100");
    expect(barPercent({ done: 0, total: 0, percent: -5 })).toBe("0");
  });
});
