import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/helpers/Platform", () => ({ default: { download: null, isDesktop: true } }));

import { useBackgroundTasks } from "@/composables/useBackgroundTasks";

const bg = useBackgroundTasks();

const ids = () => bg.tasks.value.map((t) => t.id).sort();
const concluidas = () =>
  bg.tasks.value.filter((t) => t.status === "completed").map((t) => t.id);

beforeEach(() => {
  for (const task of [...bg.tasks.value]) bg.dismissTask(task.id);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useBackgroundTasks — limpar concluídas", () => {
  it("conta somente as tarefas concluídas com sucesso", () => {
    bg.registerTask("ok-1", "A");
    bg.registerTask("ok-2", "B");
    bg.registerTask("rodando", "C");
    bg.registerTask("falhou", "D");
    bg.completeTask("ok-1");
    bg.completeTask("ok-2");
    bg.updateTask("falhou", { status: "error" });

    expect(bg.completedCount.value).toBe(2);
    expect(bg.tasks.value.find((t) => t.id === "rodando")?.status).toBe("running");
  });

  it("remove só as concluídas e preserva andamento, erro e cancelamento", async () => {
    for (const id of ["ok-1", "ok-2", "rodando", "falhou", "cancelada"]) {
      bg.registerTask(id, id);
    }
    bg.completeTask("ok-1");
    bg.completeTask("ok-2");
    bg.updateTask("falhou", { status: "error" });
    bg.updateTask("cancelada", { status: "cancelled" });

    await bg.clearCompleted();

    expect(ids()).toEqual(["cancelada", "falhou", "rodando"]);
    expect(bg.completedCount.value).toBe(0);
  });

  it("sem concluídas não muda nada", async () => {
    bg.registerTask("rodando", "A");
    await bg.clearCompleted();
    expect(ids()).toEqual(["rodando"]);
  });

  it("com stagger, tira uma a cada intervalo e resolve no fim", async () => {
    vi.useFakeTimers();
    for (const id of ["ok-1", "ok-2", "ok-3"]) bg.registerTask(id, id);
    bg.completeTask("ok-1");
    bg.completeTask("ok-2");
    bg.completeTask("ok-3");

    const terminou = bg.clearCompleted({ staggerMs: 100 });
    expect(concluidas()).toEqual(["ok-1", "ok-2", "ok-3"]);

    /* O primeiro card sai já no primeiro tick; os outros esperam o intervalo. */
    await vi.advanceTimersByTimeAsync(0);
    expect(concluidas()).toEqual(["ok-2", "ok-3"]);

    await vi.advanceTimersByTimeAsync(99);
    expect(concluidas()).toEqual(["ok-2", "ok-3"]);

    await vi.advanceTimersByTimeAsync(1);
    expect(concluidas()).toEqual(["ok-3"]);

    await vi.advanceTimersByTimeAsync(100);
    expect(concluidas()).toEqual([]);
    await terminou;
    expect(bg.completedCount.value).toBe(0);
  });

  it("dispensar um card durante a cascata não quebra o restante", async () => {
    vi.useFakeTimers();
    for (const id of ["ok-1", "ok-2"]) bg.registerTask(id, id);
    bg.completeTask("ok-1");
    bg.completeTask("ok-2");

    const terminou = bg.clearCompleted({ staggerMs: 100 });
    await vi.advanceTimersByTimeAsync(0);
    bg.dismissTask("ok-2");
    await vi.advanceTimersByTimeAsync(100);
    await terminou;

    expect(bg.tasks.value).toEqual([]);
  });
});
