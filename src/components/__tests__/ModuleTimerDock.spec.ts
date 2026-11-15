import { afterEach, describe, expect, it } from "vitest";
import { nextTick } from "vue";
import type { VueWrapper } from "@vue/test-utils";
import ModuleTimerDock from "@/components/ModuleTimerDock.vue";
import { mountUi } from "@/components/ui/__tests__/mountUi";

const LABELS = {
  mode: "Modo",
  up: "Para cima",
  down: "Para baixo",
  warning: "Avisar faltando",
  warnings: ["30 s", "1 min", "2 min", "5 min", "10 min", "Não"],
  custom: "Personalizado em segundos",
  customPlaceholder: "0",
};

const WARNINGS = [30, 60, 120, 300, 600, 0] as const;

const montados: VueWrapper[] = [];

afterEach(() => {
  while (montados.length) montados.pop()?.unmount();
  document.body.innerHTML = "";
});

function montar(props: Record<string, unknown> = {}) {
  const wrapper = mountUi(ModuleTimerDock, {
    attachTo: document.body,
    props: {
      mode: "down",
      warningSeconds: 0,
      warnings: WARNINGS,
      customWarning: true,
      labels: LABELS,
      ...props,
    },
  });
  montados.push(wrapper as unknown as VueWrapper);
  return wrapper;
}

const tabs = () =>
  Array.from(document.querySelectorAll('.timer-dock__warning [role="tab"]')).map((el) =>
    (el.textContent || "").replace(/\s+/g, " ").trim()
  );

const customInput = () =>
  document.querySelector<HTMLInputElement>('[data-testid="timer-dock-custom-input"]');

describe("ModuleTimerDock — aviso personalizado", () => {
  it("mostra o campo de segundos antes do 30 s", () => {
    montar();
    const custom = document.querySelector('[data-testid="timer-dock-custom"]');
    expect(custom).not.toBeNull();
    expect(custom!.nextElementSibling?.querySelector('[role="tablist"]')).not.toBeNull();
    expect(tabs()).toEqual(["30 s", "1 min", "2 min", "5 min", "10 min", "Não"]);
  });

  it("emite os segundos digitados ao sair do campo", async () => {
    const w = montar();
    const input = customInput()!;
    input.value = "45";
    input.dispatchEvent(new Event("input"));
    input.dispatchEvent(new Event("blur"));
    await nextTick();
    expect(w.emitted("update:warningSeconds")?.at(-1)).toEqual([45]);
  });

  it("limita o valor a 24 h e ignora zero/negativo", async () => {
    const w = montar({ warningSeconds: 45 });
    const input = customInput()!;

    input.value = "0";
    input.dispatchEvent(new Event("input"));
    input.dispatchEvent(new Event("blur"));
    await nextTick();
    expect(w.emitted("update:warningSeconds")).toBeUndefined();
    expect(input.value).toBe("45");

    input.value = "999999";
    input.dispatchEvent(new Event("input"));
    input.dispatchEvent(new Event("blur"));
    await nextTick();
    expect(w.emitted("update:warningSeconds")?.at(-1)).toEqual([86400]);
  });

  it("mostra o valor personalizado ativo e limpa quando escolhe uma opção", async () => {
    const w = montar({ warningSeconds: 45 });
    expect(customInput()!.value).toBe("45");
    expect(
      document.querySelector('[data-testid="timer-dock-custom"]')!.classList.contains("is-active")
    ).toBe(true);

    await w.setProps({ warningSeconds: 30 });
    expect(customInput()!.value).toBe("");
    expect(
      document.querySelector('[data-testid="timer-dock-custom"]')!.classList.contains("is-active")
    ).toBe(false);
  });

  it("sem a opção personalizada, mantém o seletor antigo (Stopwatch)", () => {
    const w = montar({
      customWarning: false,
      warnings: [0, 60, 120, 300, 600],
      labels: { ...LABELS, warnings: ["Não", "1 min", "2 min", "5 min", "10 min"] },
    });
    expect(customInput()).toBeNull();
    expect(tabs()).toEqual(["Não", "1 min", "2 min", "5 min", "10 min"]);
    expect(w.emitted("update:warningSeconds")).toBeUndefined();
  });
});
