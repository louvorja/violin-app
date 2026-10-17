import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import ProgressBar from "@/components/ProgressBar.vue";

const i18n = createI18n({
  legacy: false,
  locale: "pt",
  messages: { pt: { shell: { background_tasks: { eta: "{time} restantes" } } } },
});

describe("ProgressBar — tempo restante", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-13T12:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("mostra o tempo restante depois de algum progresso e some ao concluir", async () => {
    const wrapper = mount(ProgressBar, {
      props: { done: 0, total: 1000 },
      global: { plugins: [i18n] },
    });
    expect(wrapper.find(".pgb__eta").exists()).toBe(false);

    for (let s = 1; s <= 10; s++) {
      vi.advanceTimersByTime(1_000);
      await wrapper.setProps({ done: s * 50 });
    }
    // 50% em 10 s => ~10 s restantes.
    const text = wrapper.find(".pgb__eta").text();
    expect(text).toMatch(/restantes$/);
    expect(text).toMatch(/\d+ s/);

    await wrapper.setProps({ done: 1000, completedMsg: "Concluído" });
    expect(wrapper.find(".pgb__eta").exists()).toBe(false);
  });
});
