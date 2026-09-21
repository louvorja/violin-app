export type BootStage = "after_first_paint" | "idle_maintenance";

export interface BootTask {
  id: string;
  run: () => Promise<void> | void;
}

export interface BootOrchestratorOptions {
  onStage?: (_stage: BootStage, _properties?: Record<string, unknown>) => void;
  onTaskError?: (_task: BootTask, _error: unknown) => void;
  requestAnimationFrame?: (_callback: FrameRequestCallback) => number;
  requestIdleCallback?: (_callback: IdleRequestCallback, _options?: IdleRequestOptions) => number;
  setTimeout?: (_callback: () => void, _delay?: number) => ReturnType<typeof globalThis.setTimeout>;
}

/**
 * Coordena tarefas que não pertencem ao caminho crítico da primeira pintura.
 *
 * Contrato:
 * 1. `afterFirstPaint()` só executa depois de dois frames;
 * 2. tarefas da mesma fila são sequenciais, evitando disputa de I/O;
 * 3. a fila idle usa requestIdleCallback quando disponível e um fallback
 *    determinístico para runtimes Electron que não o exponham;
 * 4. falhas são isoladas por tarefa para que uma migração não impeça as demais.
 */
export class BootOrchestrator {
  private readonly onStage?: BootOrchestratorOptions["onStage"];
  private readonly onTaskError?: BootOrchestratorOptions["onTaskError"];
  private readonly requestFrame: (_callback: FrameRequestCallback) => number;
  private readonly requestIdle?: BootOrchestratorOptions["requestIdleCallback"];
  private readonly defer: (_callback: () => void, _delay?: number) => ReturnType<typeof globalThis.setTimeout>;

  constructor(options: BootOrchestratorOptions = {}) {
    this.onStage = options.onStage;
    this.onTaskError = options.onTaskError;
    this.requestFrame =
      options.requestAnimationFrame ??
      ((callback) => globalThis.setTimeout(() => callback(Date.now()), 0) as unknown as number);
    this.requestIdle = options.requestIdleCallback;
    this.defer = options.setTimeout ?? globalThis.setTimeout;
  }

  afterFirstPaint(tasks: BootTask[] = []): Promise<void> {
    return new Promise((resolve) => {
      this.requestFrame(() => {
        this.requestFrame(async () => {
          this.onStage?.("after_first_paint");
          await this.runQueue(tasks);
          resolve();
        });
      });
    });
  }

  idleMaintenance(tasks: BootTask[] = [], timeout = 2000): void {
    const run = () => {
      void this.runQueue(tasks, "idle_maintenance");
    };

    if (this.requestIdle) {
      this.requestIdle(run, { timeout });
      return;
    }

    this.defer(run, 0);
  }

  private async runQueue(tasks: BootTask[], stage?: BootStage): Promise<void> {
    for (const task of tasks) {
      try {
        await task.run();
      } catch (error) {
        this.onTaskError?.(task, error);
      }
    }
    if (stage) this.onStage?.(stage);
  }
}
