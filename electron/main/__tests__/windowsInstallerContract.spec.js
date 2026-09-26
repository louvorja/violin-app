// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const installer = readFileSync(`${root}/build/installer.nsh`, "utf8");
const builderConfig = readFileSync(`${root}/electron-builder.yml`, "utf8");

function macroBody(name) {
  const match = installer.match(new RegExp(`!macro ${name}\\b([\\s\\S]*?)!macroend`));
  expect(match, `macro ${name} ausente`).not.toBeNull();
  return match[1];
}

describe("contrato do instalador Windows", () => {
  it("compara a conta elevada com a conta do shell pelo SID", () => {
    expect(installer).toContain("Function LouvorJA.CompareShellUserSid");
    expect(installer).toContain("user32::GetShellWindow()");
    expect(installer).toContain("advapi32::OpenProcessToken");
    expect(installer).toContain("advapi32::GetTokenInformation");
    expect(installer).toContain("advapi32::IsValidSid");
    expect(installer).toContain("advapi32::EqualSid");
    expect(installer).toContain('StrCpy $0 "error"');
    expect(installer).toContain('StrCpy $0 "same"');
    expect(installer).toContain('StrCpy $0 "different"');
    expect(installer).toContain("System::Free $9");
    expect(installer).toContain("kernel32::CloseHandle");
  });

  it("aceita a mesma conta elevada e reserva a instância UAC para o legado", () => {
    const customInit = macroBody("customInit");
    const legacyDetection = customInit.indexOf('$PROGRAMFILES\\"');
    const innerInstance = customInit.indexOf("${If} ${UAC_IsInnerInstance}");

    expect(legacyDetection).toBeGreaterThanOrEqual(0);
    expect(innerInstance).toBeGreaterThan(legacyDetection);
    expect(customInit).toContain("!insertmacro setInstallModePerAllUsers");
    expect(customInit).toContain("${If} ${UAC_IsAdmin}");
    expect(customInit).toContain("Call LouvorJA.CompareShellUserSid");
    expect(customInit).toContain('${If} $R0 != "same"');
    expect(customInit).toContain("SetErrorLevel 1");
    expect(customInit).not.toContain("Execute o instalador normalmente, sem 'Executar como administrador'. O LouvorJA será instalado apenas para este usuário.");
  });

  it("mantém o instalador assistido no escopo do usuário", () => {
    const nsisConfig = builderConfig.replace(/\r\n/g, "\n").match(/^nsis:\n([\s\S]*?)(?=^# -{10,}|^mac:)/m)?.[1];

    expect(nsisConfig).toBeDefined();
    expect(nsisConfig).toMatch(/^  oneClick: false$/m);
    expect(nsisConfig).toMatch(/^  perMachine: false$/m);
    expect(nsisConfig).toMatch(/^  allowElevation: false$/m);
  });
});
