import { describe, expect, it } from "vitest";
import {
  desktopDownloadUrl,
  desktopReleaseUrl,
  detectDesktopDownloadPlatform,
} from "../DesktopDownload";

describe("DesktopDownload", () => {
  it("detecta os sistemas desktop publicados", () => {
    expect(detectDesktopDownloadPlatform({ platform: "Win32" })).toBe("windows");
    expect(detectDesktopDownloadPlatform({ platform: "MacIntel" })).toBe("macos");
    expect(detectDesktopDownloadPlatform({ platform: "Linux x86_64" })).toBe("linux");
  });

  it("não oferece pacote Linux ou macOS para dispositivos móveis", () => {
    expect(
      detectDesktopDownloadPlatform({
        platform: "Linux armv8l",
        userAgent: "Mozilla/5.0 (Linux; Android 15)",
      })
    ).toBe("other");
    expect(
      detectDesktopDownloadPlatform({
        platform: "MacIntel",
        userAgent: "Mozilla/5.0 (Macintosh)",
        maxTouchPoints: 5,
      })
    ).toBe("other");
  });

  it("não trata ChromeOS como Linux compatível", () => {
    expect(
      detectDesktopDownloadPlatform({
        platform: "Linux x86_64",
        userAgent: "Mozilla/5.0 (X11; CrOS x86_64 16093.68.0)",
      })
    ).toBe("other");
  });

  it("gera download direto para Windows e macOS", () => {
    expect(desktopDownloadUrl("windows", "2.0.0-beta.7")).toBe(
      "https://github.com/louvorja/violin-app/releases/download/v2.0.0-beta.7/LouvorJA%20Violin-Setup-2.0.0-beta.7.exe"
    );
    expect(desktopDownloadUrl("macos", "v2.0.0-beta.7")).toBe(
      "https://github.com/louvorja/violin-app/releases/download/v2.0.0-beta.7/LouvorJA%20Violin-2.0.0-beta.7.dmg"
    );
  });

  it("leva Linux e plataformas desconhecidas à release correta", () => {
    const releaseUrl = "https://github.com/louvorja/violin-app/releases/tag/v2.0.0-beta.7";
    expect(desktopReleaseUrl("v2.0.0-beta.7")).toBe(releaseUrl);
    expect(desktopDownloadUrl("linux", "2.0.0-beta.7")).toBe(releaseUrl);
    expect(desktopDownloadUrl("other", "2.0.0-beta.7")).toBe(releaseUrl);
  });
});
