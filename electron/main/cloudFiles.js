"use strict";

/**
 * Arquivos de pastas sincronizadas com a nuvem (OneDrive, Google Drive,
 * iCloud, Dropbox...): quais ainda estão só na nuvem e o download deles para
 * o computador antes do culto.
 *
 * - macOS/Linux: o provedor deixa o arquivo "sem dados" no disco até alguém
 *   lê-lo — tamanho cheio, zero blocos ocupados. Vale para qualquer provedor
 *   que use o File Provider do macOS.
 * - Windows: os provedores usam a API Cloud Files, que marca o arquivo com
 *   os atributos de "recuperar ao acessar"/offline. São lidos por PowerShell,
 *   uma vez por pasta.
 *
 * Baixar é ler o arquivo inteiro: o provedor busca os dados nessa leitura.
 */

const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

/** FILE_ATTRIBUTE_OFFLINE | RECALL_ON_OPEN | RECALL_ON_DATA_ACCESS */
const WIN_CLOUD_ATTRS = 0x1000 | 0x40000 | 0x400000;
const READ_CHUNK = 1024 * 1024;
const MAX_PATHS = 2000;

const WIN_SCRIPT = [
  "$ErrorActionPreference = 'SilentlyContinue'",
  "[Console]::OutputEncoding = [Text.Encoding]::UTF8",
  "Get-ChildItem -LiteralPath $env:LJ_DIR -File -Force | ForEach-Object { \"$([int64]$_.Attributes)`t$($_.Name)\" }",
].join("; ");

function validPaths(paths) {
  return Array.isArray(paths)
    ? paths.filter((p) => typeof p === "string" && path.isAbsolute(p)).slice(0, MAX_PATHS)
    : [];
}

/** Estado de um arquivo pelo stat (macOS/Linux). */
function stateFromStat(stat) {
  if (!stat.isFile()) return "local";
  return stat.size > 0 && stat.blocks === 0 ? "cloud" : "local";
}

/** "atributos<TAB>nome" por linha → nome → estado. */
function parseWindowsListing(stdout) {
  const states = new Map();
  for (const line of String(stdout).split(/\r?\n/)) {
    const tab = line.indexOf("\t");
    if (tab <= 0) continue;
    const attrs = Number(line.slice(0, tab));
    if (!Number.isFinite(attrs)) continue;
    states.set(line.slice(tab + 1), attrs & WIN_CLOUD_ATTRS ? "cloud" : "local");
  }
  return states;
}

/**
 * @param {object} [deps]
 * @param {NodeJS.Platform} [deps.platform]
 * @param {typeof execFile} [deps.execImpl]
 */
function createCloudFiles(deps = {}) {
  const platform = deps.platform ?? process.platform;
  const execImpl = deps.execImpl ?? execFile;
  /** Downloads em curso: pedir o mesmo arquivo de novo espera o mesmo. */
  const running = new Map();

  function listWindowsDir(dir) {
    return new Promise((resolve) => {
      execImpl(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", WIN_SCRIPT],
        { env: { ...process.env, LJ_DIR: dir }, windowsHide: true, timeout: 15000, maxBuffer: 8 * 1024 * 1024 },
        (err, stdout) => resolve(err ? new Map() : parseWindowsListing(stdout))
      );
    });
  }

  /**
   * @param {unknown} paths caminhos absolutos de arquivos
   * @returns {Promise<Record<string, "local" | "cloud">>} só os que existem
   */
  async function states(paths) {
    const list = validPaths(paths);
    const out = {};
    if (platform === "win32") {
      const byDir = new Map();
      for (const p of list) {
        const dir = path.dirname(p);
        if (!byDir.has(dir)) byDir.set(dir, []);
        byDir.get(dir).push(p);
      }
      await Promise.all(
        [...byDir].map(async ([dir, files]) => {
          const listing = await listWindowsDir(dir);
          for (const f of files) {
            const state = listing.get(path.basename(f));
            if (state) out[f] = state;
          }
        })
      );
      return out;
    }
    await Promise.all(
      list.map(async (p) => {
        try {
          out[p] = stateFromStat(await fs.promises.stat(p));
        } catch {
          /* sumiu: fica de fora */
        }
      })
    );
    return out;
  }

  /**
   * Traz o arquivo para o computador lendo-o do começo ao fim.
   * @param {unknown} file
   * @param {(percent: number) => void} [onProgress]
   * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
   */
  function download(file, onProgress) {
    if (typeof file !== "string" || !path.isAbsolute(file)) return Promise.resolve({ ok: false, error: "invalid_path" });
    const pending = running.get(file);
    if (pending) return pending;
    const job = (async () => {
      let handle;
      try {
        handle = await fs.promises.open(file, "r");
        const { size } = await handle.stat();
        const buffer = Buffer.allocUnsafe(READ_CHUNK);
        let read = 0;
        let lastPercent = -1;
        while (read < size) {
          const { bytesRead } = await handle.read(buffer, 0, READ_CHUNK, read);
          if (!bytesRead) break;
          read += bytesRead;
          const percent = Math.floor((read / size) * 100);
          if (percent !== lastPercent) {
            lastPercent = percent;
            onProgress?.(percent);
          }
        }
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e?.code === "ENOENT" ? "not_found" : "read_failed" };
      } finally {
        await handle?.close().catch(() => {});
        running.delete(file);
      }
    })();
    running.set(file, job);
    return job;
  }

  return { states, download };
}

module.exports = { createCloudFiles, stateFromStat, parseWindowsListing, WIN_SCRIPT };
