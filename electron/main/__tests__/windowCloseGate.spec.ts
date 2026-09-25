import { afterEach, describe, expect, it, vi } from "vitest";
import { createWindowCloseGate } from "../windowCloseGate.js";

function fakeWindow() {
  const listeners = new Map<string, () => void>();
  let destroyed = false;
  return {
    once: (event: string, callback: () => void) => listeners.set(event, callback),
    close: vi.fn(),
    isDestroyed: () => destroyed,
    closed: () => {
      destroyed = true;
      listeners.get("closed")?.();
    },
  };
}

afterEach(() => vi.useRealTimers());

describe("windowCloseGate", () => {
  it("waits for BrowserWindow closed before allowing a same-feature reopen", async () => {
    const gate = createWindowCloseGate(2500);
    const win = fakeWindow();
    const close = gate.close("music", win, () => win.close());
    let opened = false;
    const open = gate.beforeOpen("music").then((allowed: boolean) => { opened = allowed; });

    await Promise.resolve();
    expect(opened).toBe(false);
    expect(win.close).toHaveBeenCalledOnce();

    win.closed();
    await expect(close).resolves.toBe(true);
    await open;
    expect(opened).toBe(true);
  });

  it("fails a reopen after the bounded close wait and only clears the gate on late closed", async () => {
    vi.useFakeTimers();
    const gate = createWindowCloseGate(2500);
    const win = fakeWindow();
    const close = gate.close("file", win, () => win.close());
    const open = gate.beforeOpen("file");

    await vi.advanceTimersByTimeAsync(2500);
    await expect(close).resolves.toBe(false);
    await expect(open).resolves.toBe(false);
    await expect(gate.beforeOpen("file")).resolves.toBe(false);

    win.closed();
    await expect(gate.beforeOpen("file")).resolves.toBe(true);
  });

  it("does not reserve unrelated features or reuse a window when close throws", async () => {
    const gate = createWindowCloseGate(2500);
    const win = fakeWindow();
    await expect(gate.close("music", win, () => { throw new Error("native close failed"); })).resolves.toBe(false);
    await expect(gate.beforeOpen("return")).resolves.toBe(true);
    await expect(gate.beforeOpen("music")).resolves.toBe(false);

    win.closed();
    await expect(gate.beforeOpen("music")).resolves.toBe(true);
  });

  it("reserves a feature for a native close until Electron emits closed", async () => {
    const gate = createWindowCloseGate(2500);
    const win = fakeWindow();
    const observed = gate.observeClose("music", win);
    let reopened = false;
    const opening = gate.beforeOpen("music").then((allowed: boolean) => { reopened = allowed; });
    await Promise.resolve();
    expect(reopened).toBe(false);
    expect(win.close).not.toHaveBeenCalled();

    win.closed();
    await expect(observed).resolves.toBe(true);
    await opening;
    expect(reopened).toBe(true);
  });
});
