"use strict";

/**
 * PowerPoint → PDF, pelo PowerPoint instalado no computador, para o modo
 * apresentação passar os slides como passa um PDF (com o passador).
 *
 * - Windows: automação do Office (COM) por PowerShell.
 * - macOS: AppleScript. O PowerPoint do Mac roda isolado (sandbox) e só grava
 *   sem pedir licença dentro da própria pasta; o PDF sai lá e é movido para o
 *   cache. Na primeira vez numa pasta, ele pode pedir "Conceder acesso" ao
 *   arquivo de origem — o operador concede uma vez.
 *
 * Animações, transições e vídeos embutidos não sobrevivem: o PDF tem só os
 * slides estáticos. O resultado fica em cache, refeito só se o arquivo mudar.
 * Os caminhos vão por variável de ambiente / argumento, nunca dentro do script.
 */

const fs = require("fs-extra");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { execFile } = require("child_process");

const PPT_EXT = new Set(["ppt", "pptx", "pps", "ppsx", "pptm", "ppsm"]);
const TIMEOUT_MS = 3 * 60 * 1000;

const WINDOWS_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "$pp = New-Object -ComObject PowerPoint.Application",
  // Open(arquivo, somente leitura, sem título, sem janela)
  "$p = $pp.Presentations.Open($env:LJ_SRC, $true, $false, $false)",
  // 32 = ppSaveAsPDF
  "$p.SaveAs($env:LJ_OUT, 32)",
  "$p.Close()",
  "if ($pp.Presentations.Count -eq 0) { $pp.Quit() }",
].join("; ");

const MAC_SCRIPT = `on run argv
  set srcPath to item 1 of argv
  set outPath to item 2 of argv
  tell application "Microsoft PowerPoint"
    open (POSIX file srcPath)
    set pres to active presentation
    save pres in (POSIX file outPath) as save as PDF
    close pres saving no
  end tell
end run`;

function isPowerPoint(file) {
  return typeof file === "string" && PPT_EXT.has(path.extname(file).slice(1).toLowerCase());
}

/** Chave do cache: o arquivo e a versão dele (tamanho + data). */
function cacheKey(file, stat) {
  return crypto.createHash("sha1").update(`${path.resolve(file)}|${stat.size}|${stat.mtimeMs}`).digest("hex");
}

function run(cmd, args, opts, execImpl) {
  return new Promise((resolve, reject) => {
    execImpl(cmd, args, { timeout: TIMEOUT_MS, windowsHide: true, ...opts }, (err, _stdout, stderr) =>
      err ? reject(Object.assign(err, { stderr: String(stderr || "") })) : resolve()
    );
  });
}

/**
 * @param {object} deps
 * @param {string} deps.cacheDir
 * @param {NodeJS.Platform} [deps.platform]
 * @param {typeof execFile} [deps.execImpl]
 * @param {string} [deps.macContainer]  pasta onde o PowerPoint do Mac pode gravar
 */
function createPresentationConverter(deps) {
  const platform = deps.platform ?? process.platform;
  const execImpl = deps.execImpl ?? execFile;
  const macContainer =
    deps.macContainer ?? path.join(os.homedir(), "Library", "Containers", "com.microsoft.Powerpoint", "Data", "tmp");
  /** Conversões em curso: pedir de novo o mesmo arquivo espera a mesma. */
  const running = new Map();

  async function convert(file, out) {
    if (platform === "win32") {
      await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", WINDOWS_SCRIPT], {
        env: { ...process.env, LJ_SRC: file, LJ_OUT: out },
      }, execImpl);
      return;
    }
    if (platform === "darwin") {
      await fs.ensureDir(macContainer);
      const staged = path.join(macContainer, `louvorja-${path.basename(out)}`);
      await run("osascript", ["-e", MAC_SCRIPT, file, staged], {}, execImpl);
      await fs.move(staged, out, { overwrite: true });
      return;
    }
    throw Object.assign(new Error("unsupported"), { kind: "unsupported" });
  }

  /**
   * @param {unknown} file caminho absoluto de um .ppt/.pptx
   * @returns {Promise<{ ok: true, pdf: string, cached: boolean } | { ok: false, error: string }>}
   */
  async function toPdf(file) {
    if (!isPowerPoint(file) || !path.isAbsolute(file)) return { ok: false, error: "invalid_path" };
    let stat;
    try {
      stat = await fs.stat(file);
    } catch {
      return { ok: false, error: "not_found" };
    }
    const out = path.join(deps.cacheDir, `${cacheKey(file, stat)}.pdf`);
    if (await fs.pathExists(out)) return { ok: true, pdf: out, cached: true };
    const pending = running.get(out);
    if (pending) return pending;
    const job = (async () => {
      try {
        await fs.ensureDir(deps.cacheDir);
        await convert(file, out);
        if (!(await fs.pathExists(out))) return { ok: false, error: "no_output" };
        return { ok: true, pdf: out, cached: false };
      } catch (e) {
        console.warn("[presentationConvert] falhou:", e?.message, e?.stderr?.slice?.(0, 300));
        return { ok: false, error: e?.kind === "unsupported" ? "unsupported" : "conversion_failed" };
      } finally {
        running.delete(out);
      }
    })();
    running.set(out, job);
    return job;
  }

  return { toPdf };
}

module.exports = { createPresentationConverter, isPowerPoint, cacheKey, WINDOWS_SCRIPT, MAC_SCRIPT };
