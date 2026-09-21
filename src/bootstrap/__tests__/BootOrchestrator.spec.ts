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

  describe("com funções que se comportam como as do navegador", () => {
    // setTimeout e requestAnimationFrame do Chromium lançam "Illegal invocation" quando
    // chamados como método de outro objeto (`this.defer(...)`); só valem soltos ou em window.
    const realSetTimeout = globalThis.setTimeout;
    const strict = <T extends (..._args: never[]) => unknown>(fn: T) =>
      function (this: unknown, ...args: Parameters<T>) {
        if (this !== undefined && this !== globalThis) throw new TypeError("Illegal invocation");
        return fn(...args);
      } as unknown as T;
    const wait = () => new Promise((resolve) => realSetTimeout(resolve, 20));

    it("a manutenção ociosa funciona com o setTimeout padrão, sem opções", async () => {
      vi.stubGlobal(
        "setTimeout",
        strict(((callback: () => void, delay?: number) => realSetTimeout(callback, delay)) as typeof setTimeout)
      );
      try {
        const run = vi.fn();
        const orchestrator = new BootOrchestrator();
        expect(() => orchestrator.idleMaintenance([{ id: "maintenance", run }])).not.toThrow();
        await wait();
        expect(run).toHaveBeenCalledOnce();
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it("aceita as funções do window entregues soltas, sem lançar ao chamá-las", async () => {
      const raf = strict(((callback: FrameRequestCallback) =>
        realSetTimeout(() => callback(0), 0) as unknown as number) as typeof requestAnimationFrame);
      const idle = strict(((callback: IdleRequestCallback) => {
        realSetTimeout(() => callback({} as IdleDeadline), 0);
        return 1;
      }) as typeof requestIdleCallback);
      const defer = strict(((callback: () => void, delay?: number) =>
        realSetTimeout(callback, delay)) as typeof setTimeout);
      const paint = vi.fn();
      const idleRun = vi.fn();
      const deferRun = vi.fn();

      await new BootOrchestrator({ requestAnimationFrame: raf }).afterFirstPaint([{ id: "paint", run: paint }]);
      new BootOrchestrator({ requestIdleCallback: idle }).idleMaintenance([{ id: "idle", run: idleRun }]);
      new BootOrchestrator({ setTimeout: defer }).idleMaintenance([{ id: "defer", run: deferRun }]);
      await wait();

      expect(paint).toHaveBeenCalledOnce();
      expect(idleRun).toHaveBeenCalledOnce();
      expect(deferRun).toHaveBeenCalledOnce();
    });
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
