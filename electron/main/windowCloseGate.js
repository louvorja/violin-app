"use strict";

const DEFAULT_CLOSE_ACK_TIMEOUT_MS = 2500;

/** Coordinates a feature's native close and next open without reusing a closing BrowserWindow. */
function createWindowCloseGate(timeoutMs = DEFAULT_CLOSE_ACK_TIMEOUT_MS) {
  const pending = new Map();

  function close(feature, win, initiateClose) {
    const existing = pending.get(feature);
    if (existing) return existing.promise;
    if (!win || win.isDestroyed()) return Promise.resolve(true);

    let resolveResult;
    let settled = false;
    const promise = new Promise((resolve) => { resolveResult = resolve; });
    const entry = { promise };
    pending.set(feature, entry);
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolveResult(false);
      // Keep the feature reserved until the real `closed` event. A caller may
      // fail this reopen attempt, but it must never reuse the old instance.
    }, timeoutMs);
    const onClosed = () => {
      clearTimeout(timeout);
      if (pending.get(feature) === entry) pending.delete(feature);
      if (!settled) {
        settled = true;
        resolveResult(true);
      }
    };

    win.once("closed", onClosed);
    try {
      initiateClose();
      if (win.isDestroyed()) onClosed();
    } catch {
      if (win.isDestroyed()) onClosed();
      else if (!settled) {
        settled = true;
        resolveResult(false);
      }
    }
    return promise;
  }

  /** Track native/user-initiated closes that did not pass through close(). */
  function observeClose(feature, win) {
    return close(feature, win, () => {});
  }

  async function beforeOpen(feature) {
    const entry = pending.get(feature);
    return entry ? entry.promise : true;
  }

  return { close, observeClose, beforeOpen };
}

module.exports = { createWindowCloseGate, DEFAULT_CLOSE_ACK_TIMEOUT_MS };
