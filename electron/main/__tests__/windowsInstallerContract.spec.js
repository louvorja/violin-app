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

  it("restringe a checagem de SID ao modo por usuário após a escolha", () => {
    const init = macroBody("customInit");
    const guard = installer.match(/Function LouvorJA.EnsureCurrentUserScope([\s\S]*?)FunctionEnd/)[1];
    expect(init).toContain('${If} ${UAC_IsInnerInstance}');
    expect(init).toContain('${ElseIf} ${Silent}');
    expect(init).toContain("Call LouvorJA.EnsureCurrentUserScope");
    expect(guard).toContain('${If} $installMode != "all"');
    expect(guard).toContain('${AndIf} ${UAC_IsAdmin}');
    expect(guard).toContain("Call LouvorJA.CompareShellUserSid");
    expect(guard).toContain("SetErrorLevel 1");
    expect(macroBody("customPageAfterChangeDir")).toContain("LouvorJA.ValidateScopePage");
  });

  it("preserva escopo existente em upgrades e reinstalações manuais", () => {
    const mode = macroBody("customInstallMode");
    expect(mode).toContain('${ElseIf} $hasPerUserInstallation == "1"');
    expect(mode).toContain('StrCpy $isForceCurrentInstall "1"');
    expect(mode).toContain('StrCpy $isForceMachineInstall "1"');
    expect(mode).not.toContain('${isUpdated}');
    expect(macroBody("customInit")).toContain('$perUserInstallationFolder');
    expect(macroBody("customInit")).toContain('$PROGRAMFILES64');
  });

  it("publica os defaults compartilhados apenas depois de configurar permissões", () => {
    const shared = macroBody("LouvorJAProvisionSharedMedia");
    expect(shared).toContain('${If} $installMode == "all"');
    expect(shared).toContain('IfFileExists "$R2\\storage-defaults.json" louvorja_shared_done');
    expect(shared).toContain('$APPDATA\\LouvorJA Violin');
    expect(shared).toContain('$DOCUMENTS\\LouvorJA Violin');
    expect(shared).toContain('*S-1-5-32-545:(OI)(CI)M');
    expect(shared).toContain('*S-1-5-32-545:(OI)(CI)RX');
    expect(shared).not.toContain('*S-1-1-0'); // no Everyone grant
    expect(shared).not.toContain('IndexedDB');
    expect(shared).not.toContain('videosDir');
    expect(shared).not.toContain('$R3\\Videos');
    expect(shared).toContain('WideCharToMultiByte(i 65001');
    expect(shared.indexOf('storage-defaults.json.tmp" w')).toBeGreaterThan(shared.lastIndexOf('/grant:r'));
    expect(shared).toContain('"version":2,"mediaDir":"$R4"');
  });

  it("oferece escopo e diretório dos binários no instalador assistido", () => {
    const nsisConfig = builderConfig.replace(/\r\n/g, "\n").match(/^nsis:\n([\s\S]*?)(?=^# -{10,}|^mac:)/m)?.[1];

    expect(nsisConfig).toBeDefined();
    expect(nsisConfig).toMatch(/^  oneClick: false$/m);
    expect(nsisConfig).toMatch(/^  perMachine: false$/m);
    expect(nsisConfig).toMatch(/^  allowElevation: true$/m);
    expect(nsisConfig).toMatch(/^  allowToChangeInstallationDirectory: true$/m);
  });
});
