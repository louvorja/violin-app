import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";

vi.mock("@/helpers/Platform", () => ({ default: { download: null, isDesktop: true } }));

import { useBackgroundTasks } from "@/composables/useBackgroundTasks";

describe("useBackgroundTasks — tempo restante", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-13T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("calcula etaSeconds pelo ritmo do progresso e limpa quando conclui", async () => {
    const bg = useBackgroundTasks();
    bg.registerTask("eta-teste", "test");
    for (let s = 1; s <= 10; s++) {
      vi.advanceTimersByTime(1_000);
      bg.updateTask("eta-teste", { progress: s * 2 });
      await nextTick();
    }
    const task = bg.tasks.value.find((t) => t.id === "eta-teste");
    // 20% em 10 s => 80% restantes em ~40 s.
    expect(task?.etaSeconds).toBeGreaterThanOrEqual(36);
    expect(task?.etaSeconds).toBeLessThanOrEqual(44);

    bg.completeTask("eta-teste");
    await nextTick();
    expect(bg.tasks.value.find((t) => t.id === "eta-teste")?.etaSeconds).toBeNull();
    bg.dismissTask("eta-teste");
  });

  it("mostra 'calculando' enquanto o avanço não chega ao percentual mínimo", async () => {
    const bg = useBackgroundTasks();
    bg.registerTask("eta-calculo", "test");
    vi.advanceTimersByTime(5_000);
    bg.updateTask("eta-calculo", { progress: 0.02 });
    await nextTick();

    let task = bg.tasks.value.find((t) => t.id === "eta-calculo");
    expect(task?.etaSeconds ?? null).toBeNull();
    expect(task?.etaCalculating).toBe(true);

    vi.advanceTimersByTime(5_000);
    bg.updateTask("eta-calculo", { progress: 1 });
    await nextTick();

    task = bg.tasks.value.find((t) => t.id === "eta-calculo");
    expect(task?.etaSeconds).not.toBeNull();
    expect(task?.etaCalculating).toBe(false);
    bg.dismissTask("eta-calculo");
  });

  it("fica sem estimativa enquanto a tarefa é nova", async () => {
    const bg = useBackgroundTasks();
    bg.registerTask("eta-nova", "test");
    vi.advanceTimersByTime(1_000);
    bg.updateTask("eta-nova", { progress: 3 });
    await nextTick();
    expect(bg.tasks.value.find((t) => t.id === "eta-nova")?.etaSeconds ?? null).toBeNull();
    bg.dismissTask("eta-nova");
  });
});
