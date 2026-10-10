import { beforeEach, describe, expect, it, vi } from "vitest";

const info = vi.fn();
vi.mock("@/helpers/Alert", () => ({ default: { info: (d: unknown) => info(d) } }));
vi.mock("@/i18n", () => ({
  i18nAtual: () => ({
    global: { t: (key: string, p: { names: string }) => `${key}|${p.names}` },
  }),
}));

import { reportLocalFileFailure } from "@/helpers/LocalFailureNotice";

describe("reportLocalFileFailure", () => {
  beforeEach(() => {
    info.mockClear();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("avisa o operador e devolve true para falha do ambiente", () => {
    const error = Object.assign(new Error("x"), { name: "NotReadableError" });
    expect(reportLocalFileFailure(error, ["a & b.mp3"])).toBe(true);
    expect(info).toHaveBeenCalledWith({
      text: "alert.local_file_unreadable|a &amp; b.mp3",
      translate: false,
    });
  });

  it("devolve false e não avisa para defeito do código", () => {
    expect(reportLocalFileFailure(new TypeError("boom"), ["a.mp3"])).toBe(false);
    expect(info).not.toHaveBeenCalled();
  });
});
