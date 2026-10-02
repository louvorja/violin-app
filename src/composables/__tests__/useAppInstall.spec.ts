import { describe, expect, it } from "vitest";
import { detectInstallKind } from "../useAppInstall";

describe("detectInstallKind", () => {
  it("reconhece iPhone e iPad (inclusive iPadOS que se declara Mac)", () => {
    expect(detectInstallKind("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)", 5)).toBe("ios");
    expect(detectInstallKind("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 5)).toBe("ios");
  });

  it("separa Android com Chrome do Firefox, que não instala", () => {
    expect(detectInstallKind("Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile", 5)).toBe(
      "android"
    );
    expect(detectInstallKind("Mozilla/5.0 (Android 14; Mobile) Firefox/120", 5)).toBe(
      "unsupported"
    );
  });

  it("usa o passo a passo de Chromium no ChromeOS", () => {
    expect(detectInstallKind("Mozilla/5.0 (X11; CrOS x86_64) Chrome/120", 0)).toBe("chromium");
  });
});
