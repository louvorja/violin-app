import { reactive, computed, watch, effectScope } from "vue";
import Platform from "@/helpers/Platform";
import { createEtaEstimator, type EtaEstimator } from "@/helpers/Eta";

export interface BackgroundTask {
  id: string;
  label: string;
  status: "running" | "completed" | "error" | "cancelled";
  progress: number;
  detail?: string;
  error?: string;
  startedAt: number;
  completedAt?: number;
  /** Segundos que faltam, estimados pelo ritmo da própria tarefa; `null` até haver base. */
  etaSeconds?: number | null;
  _cancelFn?: () => void;
  _done?: number;
  _failed?: number;
  _total?: number;
}

type CleanupFn = () => void;

const _tasks = reactive(new Map<string, BackgroundTask>());
const _downloadListeners: CleanupFn[] = [];
const _estimators = new Map<string, EtaEstimator>();
let _etaWatching = false;

/**
 * Toda tarefa informa só a porcentagem; o tempo restante sai do ritmo dela. Um
 * observador único atualiza `etaSeconds` quando o progresso muda, e vale para
 * qualquer produtor (coletâneas, Bíblia, banco, atualização) sem mexer neles.
 */
function _watchEta(): void {
  if (_etaWatching) return;
  _etaWatching = true;
  effectScope(true).run(() =>
    watch(
      () =>
        Array.from(_tasks.values())
          .map((t) => `${t.id}:${t.status}:${t.progress}`)
          .join("|"),
      () => {
        const now = Date.now();
        const alive = new Set<string>();
        for (const task of _tasks.values()) {
          if (task.status !== "running") {
            task.etaSeconds = null;
            continue;
          }
          alive.add(task.id);
          let estimator = _estimators.get(task.id);
          if (!estimator) {
            estimator = createEtaEstimator();
            _estimators.set(task.id, estimator);
            estimator.push(task.startedAt, 0);
          }
          estimator.push(now, task.progress ?? 0);
          task.etaSeconds = estimator.eta(now);
        }
        for (const id of [..._estimators.keys()]) if (!alive.has(id)) _estimators.delete(id);
      },
    ),
  );
}

function _ensureDownloadListeners(): void {
  if (_downloadListeners.length > 0 || !Platform.download) return;

  _downloadListeners.push(
    Platform.download.onProgress((d: any) => {
      const task = _tasks.get("sync-collections");
      if (task && task.status === "running") {
        const total = d.total ?? task._total ?? 0;
        task._total = total;
        task.detail = d.file ? (d.file.split("/").pop() ?? "") : "";
        const processed = (task._done ?? 0) + (task._failed ?? 0);
        task.progress = total > 0 ? Math.round((processed / total) * 100) : 0;
      }
    }),
  );

  _downloadListeners.push(
    Platform.download.onFileDone(() => {
      const task = _tasks.get("sync-collections");
      if (task && task.status === "running") {
        task._done = (task._done ?? 0) + 1;
        const total = task._total ?? 0;
        const processed = task._done + (task._failed ?? 0);
        task.progress = total > 0 ? Math.round((processed / total) * 100) : 0;
      }
    }),
  );

  _downloadListeners.push(
    Platform.download.onFileError(() => {
      const task = _tasks.get("sync-collections");
      if (task && task.status === "running") {
        task._failed = (task._failed ?? 0) + 1;
        const total = task._total ?? 0;
        const processed = (task._done ?? 0) + task._failed;
        task.progress = total > 0 ? Math.round((processed / total) * 100) : 0;
      }
    }),
  );

  _downloadListeners.push(
    Platform.download.onQueueDone((result: { downloaded?: number; failed?: number }) => {
      const task = _tasks.get("sync-collections");
      if (task && task.status === "running") {
        const failed = typeof result?.failed === "number" &&
          Number.isSafeInteger(result.failed) && result.failed > 0 ? result.failed : 0;
        const downloaded = typeof result?.downloaded === "number" &&
          Number.isSafeInteger(result.downloaded) && result.downloaded > 0 ? result.downloaded : 0;
        task._failed = Math.max(task._failed ?? 0, failed);
        task._done = Math.max(task._done ?? 0, downloaded);
        task._total = Math.max(task._total ?? 0, downloaded + failed);
        task.status = task._failed > 0 ? "error" : "completed";
        task.progress = task.status === "completed" ? 100 : task.progress;
        task.completedAt = Date.now();
      }
    }),
  );

  _downloadListeners.push(
    Platform.download.onQueueCancelled(() => {
      const task = _tasks.get("sync-collections");
      if (task && task.status === "running") {
        task.status = "cancelled";
        task.completedAt = Date.now();
      }
    }),
  );

}

export function useBackgroundTasks() {
  _watchEta();
  const tasks = computed(() => Array.from(_tasks.values()));

  const hasActiveTasks = computed(() =>
    Array.from(_tasks.values()).some((t) => t.status === "running"),
  );

  const activeCount = computed(() =>
    Array.from(_tasks.values()).filter((t) => t.status === "running").length,
  );

  function registerTask(id: string, label: string, cancelFn?: () => void): void {
    if (id === "sync-collections") {
      _ensureDownloadListeners();
    }
    const existing = _tasks.get(id);
    if (existing && existing.status === "running") return;

    _tasks.set(id, {
      id,
      label,
      status: "running",
      progress: 0,
      startedAt: Date.now(),
      _cancelFn: cancelFn,
      _done: 0,
      _failed: 0,
      _total: 0,
    });
  }

  function updateTask(id: string, patch: Partial<Omit<BackgroundTask, "id" | "startedAt">>): void {
    const task = _tasks.get(id);
    if (!task) return;
    Object.assign(task, patch);
  }

  function completeTask(id: string): void {
    const task = _tasks.get(id);
    if (!task) return;
    task.status = "completed";
    task.progress = 100;
    task.completedAt = Date.now();
  }

  function cancelTask(id: string): void {
    const task = _tasks.get(id);
    if (!task) return;
    if (task._cancelFn) {
      try { task._cancelFn(); } catch { /* noop */ }
    }
    _tasks.delete(id);
    if (_tasks.size === 0) {
      _cleanupDownloadListeners();
    }
  }

  function dismissTask(id: string): void {
    _tasks.delete(id);
    if (_tasks.size === 0) {
      _cleanupDownloadListeners();
    }
  }

  return {
    tasks,
    hasActiveTasks,
    activeCount,
    registerTask,
    updateTask,
    completeTask,
    cancelTask,
    dismissTask,
  };
}

function _cleanupDownloadListeners(): void {
  _downloadListeners.forEach((fn) => {
    try { fn(); } catch { /* noop */ }
  });
  _downloadListeners.length = 0;
}
