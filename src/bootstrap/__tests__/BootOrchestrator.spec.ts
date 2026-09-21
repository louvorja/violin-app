import { describe, expect, it, vi } from "vitest";
import { BootOrchestrator } from "../BootOrchestrator";

describe("BootOrchestrator", () => {
  it("executa tarefas pós-paint somente após dois frames e de forma sequencial", async () => {
    const frames: FrameRequestCallback[] = [];
    const order: string[] = [];
    const orchestrator = new BootOrchestrator({
      requestAnimationFrame: (callback) => {
        frames.push(callback);
        return frames.length;
      },
      onStage: (stage) => order.push(`stage:${stage}`),
    });

    const done = orchestrator.afterFirstPaint([
      {
        id: "first",
        run: async () => {
          order.push("first:start");
          await Promise.resolve();
          order.push("first:end");
        },
      },
      {
        id: "second",
        run: () => {
          order.push("second");
        },
      },
    ]);

    expect(order).toEqual([]);
    expect(frames).toHaveLength(1);

    frames.shift()?.(0);
    expect(order).toEqual([]);
    expect(frames).toHaveLength(1);

    frames.shift()?.(16);
    await done;

    expect(order).toEqual([
      "stage:after_first_paint",
      "first:start",
      "first:end",
      "second",
    ]);
  });

  it("usa fallback com timeout para manutenção quando requestIdleCallback não existe", async () => {
    const defer = vi.fn((callback: () => void) => {
      callback();
      return 1 as unknown as ReturnType<typeof setTimeout>;
    });
    const run = vi.fn();
    const orchestrator = new BootOrchestrator({ setTimeout: defer });

    orchestrator.idleMaintenance([{ id: "maintenance", run }]);
    await Promise.resolve();

    expect(defer).toHaveBeenCalledWith(expect.any(Function), 0);
    expect(run).toHaveBeenCalledOnce();
  });

  it("isola falha de uma tarefa de manutenção e continua a fila", async () => {
    const errors: string[] = [];
    const run = vi.fn();
    const orchestrator = new BootOrchestrator({
      requestIdleCallback: (callback) => {
        callback({} as IdleDeadline);
        return 1;
      },
      onTaskError: (task) => errors.push(task.id),
    });

    orchestrator.idleMaintenance([
      { id: "fails", run: () => Promise.reject(new Error("expected")) },
      { id: "continues", run },
    ]);
    await Promise.resolve();
    await Promise.resolve();

    expect(errors).toEqual(["fails"]);
    expect(run).toHaveBeenCalledOnce();
  });
});
