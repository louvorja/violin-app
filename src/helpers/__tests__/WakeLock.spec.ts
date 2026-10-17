import { beforeEach, describe, expect, it, vi } from "vitest";

function installWakeLock() {
  const sentinels: { release: ReturnType<typeof vi.fn> }[] = [];
  const request = vi.fn(async () => {
    const sentinel = { release: vi.fn(async () => {}), addEventListener: vi.fn() };
    sentinels.push(sentinel);
    return sentinel;
  });
  Object.defineProperty(navigator, "wakeLock", { value: { request }, configurable: true });
  return { request, sentinels };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("WakeLock", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("pede a trava no primeiro motivo e só solta no último", async () => {
    const { request, sentinels } = installWakeLock();
    const WakeLock = (await import("../WakeLock")).default;

    WakeLock.hold("a");
    WakeLock.hold("b");
    await flush();
    expect(request).toHaveBeenCalledTimes(1);

    WakeLock.release("a");
    await flush();
    expect(sentinels[0].release).not.toHaveBeenCalled();

    WakeLock.release("b");
    await flush();
    expect(sentinels[0].release).toHaveBeenCalledTimes(1);
  });

  it("não falha quando o navegador recusa a trava", async () => {
    const request = vi.fn(async () => {
      throw new Error("NotAllowedError");
    });
    Object.defineProperty(navigator, "wakeLock", { value: { request }, configurable: true });
    const WakeLock = (await import("../WakeLock")).default;

    expect(() => WakeLock.hold("a")).not.toThrow();
    await flush();
    expect(request).toHaveBeenCalled();
  });

  it("é no-op sem a API", async () => {
    Object.defineProperty(navigator, "wakeLock", { value: undefined, configurable: true });
    const WakeLock = (await import("../WakeLock")).default;
    expect(WakeLock.isSupported()).toBe(false);
    expect(() => WakeLock.hold("a")).not.toThrow();
  });
});
