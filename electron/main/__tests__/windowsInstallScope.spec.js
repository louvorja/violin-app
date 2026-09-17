// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { installRequiresWindowsElevation } = require("../windowsInstallScope.js");

const env = {
  ProgramW6432: "C:\\Program Files",
  ProgramFiles: "C:\\Program Files",
  "ProgramFiles(x86)": "C:\\Program Files (x86)",
};

describe("windowsInstallScope", () => {
  it("não sinaliza instalações fora do Windows", () => {
    expect(
      installRequiresWindowsElevation({
        platform: "darwin",
        execPath: "/Applications/LouvorJA Violin.app/Contents/MacOS/LouvorJA Violin",
        env,
      })
    ).toBe(false);
  });

  it("reconhece Program Files em qualquer capitalização e separador", () => {
    expect(
      installRequiresWindowsElevation({
        platform: "win32",
        execPath: "c:/PROGRAM FILES/LouvorJA Violin/LouvorJA Violin.exe",
        env,
      })
    ).toBe(true);
    expect(
      installRequiresWindowsElevation({
        platform: "win32",
        execPath: "C:\\Program Files (x86)\\LouvorJA Violin\\LouvorJA Violin.exe",
        env,
      })
    ).toBe(true);
  });

  it("não confunde uma pasta com nome parecido", () => {
    expect(
      installRequiresWindowsElevation({
        platform: "win32",
        execPath: "C:\\Program Files Backup\\LouvorJA Violin.exe",
        env,
      })
    ).toBe(false);
    expect(
      installRequiresWindowsElevation({
        platform: "win32",
        execPath: "C:\\Users\\Igreja\\AppData\\Local\\Programs\\LouvorJA Violin\\LouvorJA Violin.exe",
        env,
      })
    ).toBe(false);
  });

  it("usa ProgramW6432 quando ProgramFiles aponta para a árvore 32-bit", () => {
    expect(
      installRequiresWindowsElevation({
        platform: "win32",
        execPath: "D:\\Apps\\LouvorJA\\LouvorJA Violin.exe",
        env: { ProgramW6432: "D:\\Apps", ProgramFiles: "C:\\Program Files" },
      })
    ).toBe(true);
  });
});
