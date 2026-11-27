// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  WINDOW_ANIMATION,
  DEFAULT_WINDOW_ANIMATION,
  OPEN_FADE_MS,
  CLOSE_FADE_MS,
  normalizeWindowAnimation,
  normalizeWindowAnimationDuration,
  closeDurationFor,
  shouldControlOpacity,
  easeOutCubic,
  easeOutQuad,
  easeInOutQuad,
  revealWindow,
  closeWindowWithAnimation,
  cancelAnimation,
} = require("../windowAnimation.js");

function makeFakeWindow({ opacity = 0, visible = true } = {}) {
  let destroyed = false;
  let currentOpacity = opacity;
  const history = [];
  return {
    history,
    isDestroyed: () => destroyed,
    destroy: () => {
      destroyed = true;
    },
    isVisible: () => visible,
    getOpacity: () => currentOpacity,
    setOpacity: vi.fn((val) => {
      currentOpacity = val;
      history.push(val);
    }),
  };
}

describe("windowAnimation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("normalizes known modes and falls back to fade for invalid values", () => {
    expect(DEFAULT_WINDOW_ANIMATION).toBe("fade");
    expect(normalizeWindowAnimation("fade")).toBe(WINDOW_ANIMATION.FADE);
    expect(normalizeWindowAnimation("none")).toBe(WINDOW_ANIMATION.NONE);
    expect(normalizeWindowAnimation("system")).toBe(WINDOW_ANIMATION.SYSTEM);
    expect(normalizeWindowAnimation("invalid")).toBe(WINDOW_ANIMATION.FADE);
    expect(normalizeWindowAnimation(null)).toBe(WINDOW_ANIMATION.FADE);
    expect(normalizeWindowAnimation(undefined)).toBe(WINDOW_ANIMATION.FADE);
  });

  it("normalizes fade duration within bounds and derives close duration", () => {
    expect(normalizeWindowAnimationDuration(undefined)).toBe(OPEN_FADE_MS);
    expect(normalizeWindowAnimationDuration(0)).toBe(OPEN_FADE_MS);
    expect(normalizeWindowAnimationDuration("abc")).toBe(OPEN_FADE_MS);
    expect(normalizeWindowAnimationDuration(40)).toBe(100);
    expect(normalizeWindowAnimationDuration(1500)).toBe(800);
    expect(normalizeWindowAnimationDuration(420)).toBe(420);

    expect(closeDurationFor(OPEN_FADE_MS)).toBe(CLOSE_FADE_MS);
    expect(closeDurationFor(500)).toBe(Math.round(500 * 0.77));
    expect(closeDurationFor(100)).toBe(80);
  });

  it("controls opacity only on Windows/macOS when not system, background, or excluded", () => {
    expect(shouldControlOpacity("fade", { platform: "win32" })).toBe(true);
    expect(shouldControlOpacity("none", { platform: "darwin" })).toBe(true);
    expect(shouldControlOpacity("system", { platform: "win32" })).toBe(false);
    expect(shouldControlOpacity("fade", { platform: "linux" })).toBe(false);
    expect(shouldControlOpacity("fade", { platform: "win32", backgroundWindows: true })).toBe(false);
    expect(shouldControlOpacity("fade", { platform: "win32", excluded: true })).toBe(false);
  });

  it("easing curves start at 0, end at 1, and ease out smoothly", () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);

    expect(easeOutQuad(0)).toBe(0);
    expect(easeOutQuad(1)).toBe(1);
    expect(easeOutQuad(0.5)).toBeGreaterThan(0.5);

    expect(easeInOutQuad(0)).toBe(0);
    expect(easeInOutQuad(0.5)).toBe(0.5);
    expect(easeInOutQuad(1)).toBe(1);
    expect(easeInOutQuad(0.25)).toBeLessThan(0.25);
    expect(easeInOutQuad(0.75)).toBeGreaterThan(0.75);
  });

  it("reveals with a smooth monotonic cubic ease-out fade from 0 to 1", () => {
    let clock = 0;
    const now = () => clock;
    const win = makeFakeWindow({ opacity: 0 });

    revealWindow(win, "fade", {
      platform: "win32",
      settleMs: 16,
      durationMs: 240,
      now,
    });

    // Still settling during the first frame
    expect(win.setOpacity).not.toHaveBeenCalled();

    clock = 16;
    vi.advanceTimersByTime(16);
    expect(win.history[0]).toBe(0);

    // Advance in 16ms increments through the 240ms fade
    for (let elapsed = 16; elapsed <= 256; elapsed += 16) {
      clock = 16 + elapsed;
      vi.advanceTimersByTime(16);
    }

    expect(win.getOpacity()).toBe(1);
    expect(win.history.length).toBeGreaterThan(10);
    // Strictly non-decreasing
    for (let i = 1; i < win.history.length; i += 1) {
      expect(win.history[i]).toBeGreaterThanOrEqual(win.history[i - 1]);
    }
  });

  it("reveals immediately after settle in none mode", () => {
    const win = makeFakeWindow({ opacity: 0 });
    revealWindow(win, "none", { platform: "win32", settleMs: 16 });
    expect(win.setOpacity).not.toHaveBeenCalled();

    vi.advanceTimersByTime(16);
    expect(win.setOpacity).toHaveBeenCalledTimes(1);
    expect(win.getOpacity()).toBe(1);
  });

  it("does not touch opacity in system mode or on Linux", () => {
    const winWin = makeFakeWindow({ opacity: 1 });
    revealWindow(winWin, "system", { platform: "win32", settleMs: 0 });
    expect(winWin.setOpacity).not.toHaveBeenCalled();

    const winLinux = makeFakeWindow({ opacity: 1 });
    revealWindow(winLinux, "fade", { platform: "linux", settleMs: 0 });
    expect(winLinux.setOpacity).not.toHaveBeenCalled();
  });

  it("fades out smoothly and then invokes doClose in fade mode", () => {
    let clock = 0;
    const now = () => clock;
    const win = makeFakeWindow({ opacity: 1, visible: true });
    const doClose = vi.fn();

    closeWindowWithAnimation(win, "fade", doClose, {
      platform: "win32",
      durationMs: 200,
      now,
    });

    expect(doClose).not.toHaveBeenCalled();

    for (let elapsed = 16; elapsed <= 220; elapsed += 16) {
      clock = elapsed;
      vi.advanceTimersByTime(16);
    }

    expect(win.getOpacity()).toBe(0);
    expect(doClose).toHaveBeenCalledTimes(1);
  });

  it("cancels an in-flight fade-in when close is requested mid-animation", () => {
    let clock = 0;
    const now = () => clock;
    const win = makeFakeWindow({ opacity: 0, visible: true });
    const doClose = vi.fn();

    revealWindow(win, "fade", { platform: "win32", settleMs: 0, durationMs: 240, now });
    clock = 60;
    vi.advanceTimersByTime(60);
    const midOpacity = win.getOpacity();
    expect(midOpacity).toBeGreaterThan(0);
    expect(midOpacity).toBeLessThan(1);

    closeWindowWithAnimation(win, "fade", doClose, {
      platform: "win32",
      durationMs: 200,
      now,
    });

    for (let step = 1; step <= 25; step += 1) {
      clock += 16;
      vi.advanceTimersByTime(16);
    }

    expect(win.getOpacity()).toBe(0);
    expect(doClose).toHaveBeenCalledTimes(1);
  });

  it("sets opacity to 0 synchronously before close in none mode", () => {
    const win = makeFakeWindow({ opacity: 1, visible: true });
    const order = [];
    win.setOpacity.mockImplementation((v) => order.push(`opacity:${v}`));
    const doClose = vi.fn(() => order.push("close"));

    closeWindowWithAnimation(win, "none", doClose, { platform: "win32" });

    expect(order).toEqual(["opacity:0", "close"]);
  });

  it("closes immediately without opacity changes when immediate=true or system", () => {
    const win = makeFakeWindow({ opacity: 1, visible: true });
    const doClose = vi.fn();

    closeWindowWithAnimation(win, "fade", doClose, { platform: "win32", immediate: true });
    expect(win.setOpacity).not.toHaveBeenCalled();
    expect(doClose).toHaveBeenCalledTimes(1);

    const win2 = makeFakeWindow({ opacity: 1, visible: true });
    const doClose2 = vi.fn();
    closeWindowWithAnimation(win2, "system", doClose2, { platform: "win32" });
    expect(win2.setOpacity).not.toHaveBeenCalled();
    expect(doClose2).toHaveBeenCalledTimes(1);
  });

  it("skips fade loops when OS reduced motion is active", () => {
    const winReveal = makeFakeWindow({ opacity: 0 });
    revealWindow(winReveal, "fade", {
      platform: "win32",
      settleMs: 16,
      reducedMotion: true,
    });
    vi.advanceTimersByTime(16);
    expect(winReveal.setOpacity).toHaveBeenCalledTimes(1);
    expect(winReveal.getOpacity()).toBe(1);

    const winClose = makeFakeWindow({ opacity: 1, visible: true });
    const doClose = vi.fn();
    closeWindowWithAnimation(winClose, "fade", doClose, {
      platform: "darwin",
      reducedMotion: true,
    });
    expect(winClose.getOpacity()).toBe(0);
    expect(doClose).toHaveBeenCalledTimes(1);
  });

  it("stops safely when a window is destroyed mid-animation", () => {
    let clock = 0;
    const win = makeFakeWindow({ opacity: 0 });
    revealWindow(win, "fade", { platform: "win32", settleMs: 0, durationMs: 240, now: () => clock });
    clock = 32;
    vi.advanceTimersByTime(32);
    const callsBeforeDestroy = win.setOpacity.mock.calls.length;

    win.destroy();
    cancelAnimation(win);
    clock = 300;
    vi.advanceTimersByTime(300);

    expect(win.setOpacity.mock.calls.length).toBe(callsBeforeDestroy);
  });
});
