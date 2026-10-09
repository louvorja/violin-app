import { beforeEach, describe, expect, it, vi } from "vitest";

const { show, platform } = vi.hoisted(() => ({ show: vi.fn(), platform: { isDesktop: false } }));
vi.mock("@/helpers/Snackbar", () => ({ default: { show: (o: unknown) => show(o) } }));
vi.mock("@/helpers/Platform", () => ({ default: platform }));
vi.mock("@/i18n", () => ({ i18nAtual: () => ({ global: { t: (k: string) => k } }) }));

import { isStaleChunkError, notifyStaleVersion, watchStaleVersion } from "../StaleVersion";

/**
 * Depois de uma publicação, a aba aberta perde os arquivos da versão anterior.
 * O aviso precisa aparecer venha a falha de onde vier — módulo, menu, CSS.
 */
describe("StaleVersion", () => {
  beforeEach(() => {
    show.mockClear();
    platform.isDesktop = false;
  });

  it("reconhece as três formas da falha (Chrome, Safari, CSS)", () => {
    expect(isStaleChunkError(new TypeError("Failed to fetch dynamically imported module: x"))).toBe(true);
    expect(isStaleChunkError(new TypeError("Importing a module script failed."))).toBe(true);
    expect(isStaleChunkError(new Error("Unable to preload CSS for /assets/a.css"))).toBe(true);
    expect(isStaleChunkError(new Error("HTTP 404"))).toBe(false);
  });

  it("avisa na web e fica calado no desktop", () => {
    notifyStaleVersion();
    expect(show).toHaveBeenCalledOnce();
    platform.isDesktop = true;
    notifyStaleVersion();
    expect(show).toHaveBeenCalledOnce();
  });

  it("o evento do Vite dispara o aviso só para arquivo que sumiu", () => {
    watchStaleVersion();
    const fire = (payload: unknown) =>
      window.dispatchEvent(Object.assign(new Event("vite:preloadError"), { payload }));
    fire(new Error("outra coisa"));
    expect(show).not.toHaveBeenCalled();
    fire(new TypeError("Importing a module script failed."));
    expect(show).toHaveBeenCalledOnce();
  });
});
