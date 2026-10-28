import { afterEach, describe, expect, it, vi } from "vitest";
import { installCompat } from "../compat";

const originals = {
  hasOwn: Object.hasOwn,
  timeout: AbortSignal.timeout,
  any: AbortSignal.any,
};

function remove(target: object, name: string): void {
  Object.defineProperty(target, name, { value: undefined, configurable: true, writable: true });
}

describe("compat de navegadores antigos", () => {
  afterEach(() => {
    Object.defineProperty(Object, "hasOwn", { value: originals.hasOwn, configurable: true, writable: true });
    Object.defineProperty(AbortSignal, "timeout", { value: originals.timeout, configurable: true, writable: true });
    Object.defineProperty(AbortSignal, "any", { value: originals.any, configurable: true, writable: true });
    vi.useRealTimers();
  });

  it("não troca as funções nativas", () => {
    installCompat();
    expect(Object.hasOwn).toBe(originals.hasOwn);
    expect(AbortSignal.any).toBe(originals.any);
  });

  it("Object.hasOwn só enxerga propriedades próprias", () => {
    remove(Object, "hasOwn");
    installCompat();
    expect(Object.hasOwn({ a: 1 }, "a")).toBe(true);
    expect(Object.hasOwn({}, "toString")).toBe(false);
  });

  it("AbortSignal.any aborta com o primeiro sinal, já abortado ou não", () => {
    remove(AbortSignal, "any");
    installCompat();
    const a = new AbortController();
    const b = new AbortController();
    const merged = AbortSignal.any([a.signal, b.signal]);
    expect(merged.aborted).toBe(false);
    b.abort("trocou de música");
    expect(merged.aborted).toBe(true);
    expect(merged.reason).toBe("trocou de música");
    const done = new AbortController();
    done.abort("antes");
    expect(AbortSignal.any([done.signal]).reason).toBe("antes");
  });

  it("AbortSignal.timeout aborta com TimeoutError no prazo", () => {
    vi.useFakeTimers();
    remove(AbortSignal, "timeout");
    installCompat();
    const signal = AbortSignal.timeout(100);
    vi.advanceTimersByTime(99);
    expect(signal.aborted).toBe(false);
    vi.advanceTimersByTime(1);
    expect(signal.aborted).toBe(true);
    expect((signal.reason as DOMException).name).toBe("TimeoutError");
  });
});
