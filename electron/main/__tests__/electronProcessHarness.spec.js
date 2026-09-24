// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  closeElectronApp,
  forceTerminateProcessTree,
  listProcesses,
  parsePosixProcesses,
  parseWindowsProcesses,
  processesMentioning,
} from "../../../e2e/helpers/electron-processes.mjs";

describe("harness de processos do Electron", () => {
  it("interpreta a saída POSIX sem depender do cabeçalho do ps", () => {
    expect(parsePosixProcesses("    9 /usr/bin/thing --id abc\n  12 node runner.js\n")).toEqual([
      { pid: 9, command: "/usr/bin/thing --id abc" },
      { pid: 12, command: "node runner.js" },
    ]);
  });

  it("interpreta tanto objeto único quanto lista do PowerShell", () => {
    expect(
      parseWindowsProcesses('{"ProcessId":41,"CommandLine":"yt-dlp.exe abc"}')
    ).toEqual([{ pid: 41, command: "yt-dlp.exe abc" }]);
    expect(
      parseWindowsProcesses(
        '[{"ProcessId":42,"CommandLine":null},{"ProcessId":43,"CommandLine":"ffmpeg.exe"}]'
      )
    ).toEqual([
      { pid: 42, command: "" },
      { pid: 43, command: "ffmpeg.exe" },
    ]);
  });

  it("enumera no Windows por PowerShell sem interpolar o texto procurado", async () => {
    const execFileImpl = vi.fn().mockResolvedValue({
      stdout: '{"ProcessId":52,"CommandLine":"yt-dlp.exe video-id"}',
    });

    await expect(
      processesMentioning("video-id", {
        platform: "win32",
        currentPid: 999,
        execFileImpl,
      })
    ).resolves.toEqual([{ pid: 52, command: "yt-dlp.exe video-id" }]);

    expect(execFileImpl).toHaveBeenCalledOnce();
    const [executable, args] = execFileImpl.mock.calls[0];
    expect(executable).toBe("powershell.exe");
    expect(args.join(" ")).not.toContain("video-id");
  });

  it("propaga falha de enumeração em vez de fingir que não há processos", async () => {
    const cause = new Error("PowerShell indisponível");
    await expect(
      listProcesses({
        platform: "win32",
        execFileImpl: vi.fn().mockRejectedValue(cause),
      })
    ).rejects.toMatchObject({
      message: "Não foi possível enumerar processos em win32",
      cause,
    });
  });

  it("encerra a árvore Windows com PID validado e sem shell", async () => {
    const execFileImpl = vi.fn().mockResolvedValue({ stdout: "SUCCESS" });
    await forceTerminateProcessTree(321, {
      platform: "win32",
      currentPid: 999,
      execFileImpl,
    });

    expect(execFileImpl).toHaveBeenCalledWith(
      "taskkill.exe",
      ["/PID", "321", "/T", "/F"],
      expect.objectContaining({ windowsHide: true })
    );
  });

  it("encerra somente o PID raiz em POSIX, nunca um grupo não verificado", async () => {
    const killImpl = vi.fn();
    await forceTerminateProcessTree(322, {
      platform: "darwin",
      currentPid: 999,
      killImpl,
    });

    expect(killImpl).toHaveBeenCalledWith(322, "SIGKILL");
  });

  it("recusa PID inválido e o PID do próprio runner", async () => {
    await expect(
      forceTerminateProcessTree("1 & calc.exe", { platform: "win32", currentPid: 999 })
    ).rejects.toThrow(/PID inválido/);
    await expect(
      forceTerminateProcessTree(999, { platform: "win32", currentPid: 999 })
    ).rejects.toThrow(/próprio processo/);
  });

  it("prefere close gracioso e não força quando ele conclui", async () => {
    const execFileImpl = vi.fn();
    const electronApp = {
      process: () => ({ pid: 444, exitCode: null, signalCode: null }),
      close: vi.fn().mockResolvedValue(undefined),
    };

    await expect(
      closeElectronApp(electronApp, {
        platform: "win32",
        currentPid: 999,
        execFileImpl,
      })
    ).resolves.toEqual({ forced: false, alreadyClosed: false });
    expect(execFileImpl).not.toHaveBeenCalled();
  });

  it("usa taskkill como fallback se o close trava no Windows", async () => {
    const execFileImpl = vi.fn().mockResolvedValue({ stdout: "SUCCESS" });
    const electronApp = {
      process: () => ({ pid: 445, exitCode: null, signalCode: null }),
      close: vi.fn(() => new Promise(() => {})),
    };

    const result = await closeElectronApp(electronApp, {
      timeoutMs: 5,
      platform: "win32",
      currentPid: 999,
      execFileImpl,
    });

    expect(result.forced).toBe(true);
    expect(result.closeError).toMatchObject({ code: "ETIMEDOUT" });
    expect(execFileImpl).toHaveBeenCalledWith(
      "taskkill.exe",
      ["/PID", "445", "/T", "/F"],
      expect.any(Object)
    );
  });
});
