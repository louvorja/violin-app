import { beforeEach, describe, expect, it, vi } from "vitest";

const convertPresentation = vi.fn();

vi.mock("@/helpers/Platform", () => ({
  default: {
    api: { pptx: {} },
    convertPresentation: (...args: unknown[]) => convertPresentation(...args),
  },
}));
vi.mock("@/helpers/Snackbar", () => ({
  default: { show: vi.fn(), warning: vi.fn(), error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));
vi.mock("@/helpers/Telemetry", () => ({
  default: { track: vi.fn(), captureException: vi.fn(), histogram: vi.fn(), log: vi.fn() },
}));
vi.mock("@/i18n", () => ({ i18nAtual: () => null }));

import { loadPowerPointInfo, powerPointInfo } from "../usePowerPoint";

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

/**
 * `loadPowerPointInfo` roda ao ver o arquivo no palco. Falhas não podem ser
 * repetidas a cada troca de mídia: o cache negativo vale por 5 minutos.
 */
describe("usePowerPoint — cache negativo", () => {
  beforeEach(() => {
    convertPresentation.mockReset();
    powerPointInfo.clear();
    vi.useRealTimers();
  });

  it("não reconverte o mesmo arquivo logo depois de falhar", async () => {
    convertPresentation.mockResolvedValue({
      ok: false,
      error: "conversion_failed",
      message: "sem PowerPoint",
    });
    const file = "/tmp/review-cache-negativo-1.pptx";

    loadPowerPointInfo(file);
    await flush();
    expect(convertPresentation).toHaveBeenCalledTimes(1);

    loadPowerPointInfo(file);
    await flush();
    expect(convertPresentation).toHaveBeenCalledTimes(1);
  });

  it("depois do TTL tenta de novo", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-17T10:00:00Z"));
    convertPresentation.mockResolvedValue({
      ok: false,
      error: "conversion_failed",
      message: "sem PowerPoint",
    });
    const file = "/tmp/review-cache-negativo-2.pptx";

    loadPowerPointInfo(file);
    await flush();
    expect(convertPresentation).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date("2026-11-17T10:06:00Z"));
    loadPowerPointInfo(file);
    await flush();
    expect(convertPresentation).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
