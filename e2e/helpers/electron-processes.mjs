import { execFile as execFileCallback } from "node:child_process";
import nodeProcess from "node:process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFileCallback);

const POWERSHELL_PROCESS_QUERY = [
  "-NoLogo",
  "-NoProfile",
  "-NonInteractive",
  "-Command",
  "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; " +
    "Get-CimInstance Win32_Process | " +
    "Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress",
];

function stdoutOf(result) {
  if (typeof result === "string") return result;
  return result?.stdout == null ? "" : String(result.stdout);
}

export function parsePosixProcesses(output) {
  const processes = [];
  for (const line of String(output || "").split(/\r?\n/)) {
    const match = /^\s*(\d+)\s+(.*\S)\s*$/.exec(line);
    if (!match) continue;
    processes.push({ pid: Number(match[1]), command: match[2] });
  }
  return processes;
}

export function parseWindowsProcesses(output) {
  const text = String(output || "")
    .trim()
    .replace(/^\uFEFF/, "");
  if (!text) return [];

  const decoded = JSON.parse(text);
  const entries = Array.isArray(decoded) ? decoded : [decoded];
  const processes = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const pid = Number(entry.ProcessId);
    if (!Number.isInteger(pid) || pid <= 0) continue;
    processes.push({
      pid,
      command: typeof entry.CommandLine === "string" ? entry.CommandLine : "",
    });
  }
  return processes;
}

/**
 * Enumera processos sem shell e sem interpolar dados do teste no comando.
 * Falhas são fatais: tratá-las como uma lista vazia esconderia subprocessos
 * órfãos justamente nos testes que verificam cancelamento.
 */
export async function listProcesses({
  platform = nodeProcess.platform,
  execFileImpl = execFileAsync,
} = {}) {
  try {
    if (platform === "win32") {
      const result = await execFileImpl("powershell.exe", POWERSHELL_PROCESS_QUERY, {
        encoding: "utf8",
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024,
      });
      return parseWindowsProcesses(stdoutOf(result));
    }

    const result = await execFileImpl("ps", ["-axo", "pid=,command="], {
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    });
    return parsePosixProcesses(stdoutOf(result));
  } catch (error) {
    throw new Error(`Não foi possível enumerar processos em ${platform}`, { cause: error });
  }
}

export async function processesMentioning(
  needle,
  {
    currentPid = nodeProcess.pid,
    excludePids = [currentPid],
    ignoreCommandPatterns = [/playwright/i],
    ...listOptions
  } = {}
) {
  if (typeof needle !== "string" || needle.length === 0) {
    throw new TypeError("O texto usado para procurar processos não pode ser vazio");
  }

  const excluded = new Set(excludePids);
  return (await listProcesses(listOptions)).filter(
    ({ pid, command }) =>
      !excluded.has(pid) &&
      command.includes(needle) &&
      !ignoreCommandPatterns.some((pattern) => pattern.test(command))
  );
}

function validatedPid(pid, currentPid) {
  const value = Number(pid);
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`PID inválido para encerramento: ${pid}`);
  }
  if (value === currentPid) {
    throw new Error("Recusando encerrar o próprio processo do runner");
  }
  return value;
}

export async function forceTerminateProcessTree(
  pid,
  {
    platform = nodeProcess.platform,
    currentPid = nodeProcess.pid,
    execFileImpl = execFileAsync,
    killImpl = nodeProcess.kill.bind(nodeProcess),
  } = {}
) {
  const safePid = validatedPid(pid, currentPid);
  if (platform === "win32") {
    await execFileImpl("taskkill.exe", ["/PID", String(safePid), "/T", "/F"], {
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    });
    return;
  }

  try {
    killImpl(safePid, "SIGKILL");
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}

function withTimeout(promise, timeoutMs) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`Electron não encerrou em ${timeoutMs} ms`);
      error.code = "ETIMEDOUT";
      reject(error);
    }, timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Prefere o encerramento coordenado do Playwright. Se ele travar, encerra a
 * árvore no Windows (onde o Electron pode manter filhos) e apenas o PID raiz
 * nos sistemas POSIX, sem sinais para grupos de processo não verificados.
 */
export async function closeElectronApp(
  electronApp,
  {
    timeoutMs = 15_000,
    platform = nodeProcess.platform,
    currentPid = nodeProcess.pid,
    execFileImpl = execFileAsync,
    killImpl = nodeProcess.kill.bind(nodeProcess),
  } = {}
) {
  if (!electronApp) return { forced: false, alreadyClosed: true };

  const child = electronApp.process?.();
  const pid = child?.pid;
  try {
    await withTimeout(
      Promise.resolve().then(() => electronApp.close()),
      timeoutMs
    );
    return { forced: false, alreadyClosed: false };
  } catch (closeError) {
    if (
      child &&
      ((child.exitCode !== null && child.exitCode !== undefined) ||
        (child.signalCode !== null && child.signalCode !== undefined))
    ) {
      return { forced: false, alreadyClosed: true, closeError };
    }

    try {
      await forceTerminateProcessTree(pid, {
        platform,
        currentPid,
        execFileImpl,
        killImpl,
      });
    } catch (forceError) {
      throw new AggregateError(
        [closeError, forceError],
        `Falha ao encerrar o Electron${pid ? ` (PID ${pid})` : ""}`
      );
    }
    return { forced: true, alreadyClosed: false, closeError };
  }
}
