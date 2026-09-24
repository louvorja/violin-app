import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  progress: null as ((data: unknown) => void) | null,
  fileDone: null as (() => void) | null,
  fileError: null as (() => void) | null,
  queueDone: null as ((data: unknown) => void) | null,
  queueCancelled: null as (() => void) | null,
}));

vi.mock("@/helpers/Platform", () => ({
  default: {
    download: {
      onProgress: (cb: (data: unknown) => void) => { h.progress = cb; return () => {}; },
      onFileDone: (cb: () => void) => { h.fileDone = cb; return () => {}; },
      onFileError: (cb: () => void) => { h.fileError = cb; return () => {}; },
      onQueueDone: (cb: (data: unknown) => void) => { h.queueDone = cb; return () => {}; },
      onQueueCancelled: (cb: () => void) => { h.queueCancelled = cb; return () => {}; },
    },
  },
}));

beforeEach(() => {
  vi.resetModules();
  h.progress = null;
  h.fileDone = null;
  h.fileError = null;
  h.queueDone = null;
  h.queueCancelled = null;
});

describe("background download terminal result", () => {
  it("reports worker crash as error even without file-error events", async () => {
    const { useBackgroundTasks } = await import("@/composables/useBackgroundTasks");
    const tasks = useBackgroundTasks();
    tasks.registerTask("sync-collections", "collections");

    h.queueDone?.({ downloaded: 0, failed: 3, error: "download_worker_exited" });

    expect(tasks.tasks.value[0]).toMatchObject({ status: "error", _failed: 3, _total: 3 });
  });

  it("only marks a zero-failure queue completed", async () => {
    const { useBackgroundTasks } = await import("@/composables/useBackgroundTasks");
    const tasks = useBackgroundTasks();
    tasks.registerTask("sync-collections", "collections");

    h.queueDone?.({ downloaded: 2, failed: 0 });

    expect(tasks.tasks.value[0]).toMatchObject({ status: "completed", _done: 2, progress: 100 });
  });
});
