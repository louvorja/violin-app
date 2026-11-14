import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { YTAPI } from "@/types/Media";

const ytWindow = window as unknown as { YT?: YTAPI; onYouTubeIframeAPIReady?: () => void };

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  delete ytWindow.YT;
  delete ytWindow.onYouTubeIframeAPIReady;
});

afterEach(() => {
  document.querySelectorAll('script[src*="iframe_api"]').forEach((tag) => tag.remove());
  delete ytWindow.YT;
  delete ytWindow.onYouTubeIframeAPIReady;
  vi.useRealTimers();
});

describe("carregamento da API do YouTube", () => {
  it("refaz a requisição depois de timeout seguido por erro tardio de rede", async () => {
    const { loadYtApi } = await import("@/composables/useYouTubeApi");
    const first = loadYtApi().catch((error: Error) => error);
    const stale = document.querySelector('script[src*="iframe_api"]')!;
    await vi.advanceTimersByTimeAsync(8000);
    expect(await first).toBeInstanceOf(Error);
    stale.dispatchEvent(new Event("error"));

    const next = loadYtApi();
    expect(loadYtApi()).toBe(next);
    const retry = document.querySelector('script[src*="iframe_api"]');
    expect(retry).not.toBe(stale);
    expect(retry).not.toBeNull();
    expect(document.querySelectorAll('script[src*="iframe_api"]')).toHaveLength(1);

    ytWindow.YT = { Player: vi.fn() } as unknown as YTAPI;
    ytWindow.onYouTubeIframeAPIReady?.();
    expect(await next).toBe(ytWindow.YT);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("permite tentar novamente após erro e reaproveita a API que chegou atrasada", async () => {
    const { loadYtApi } = await import("@/composables/useYouTubeApi");
    const first = loadYtApi().catch((error: Error) => error);
    document.querySelector('script[src*="iframe_api"]')!.dispatchEvent(new Event("error"));
    expect(await first).toBeInstanceOf(Error);
    expect(document.querySelector('script[src*="iframe_api"]')).toBeNull();

    ytWindow.YT = { Player: vi.fn() } as unknown as YTAPI;
    expect(await loadYtApi()).toBe(ytWindow.YT);
    expect(document.querySelector('script[src*="iframe_api"]')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});
