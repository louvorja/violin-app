"use strict";

/**
 * systemFonts — que fontes este computador tem, e como instalar mais uma.
 *
 * Sempre só para o usuário atual (nada de administrador):
 *   Windows → %LOCALAPPDATA%\Microsoft\Windows\Fonts + registro HKCU
 *   macOS   → ~/Library/Fonts
 *   Linux   → ~/.local/share/fonts/louvorja + fc-cache
 */
const fs = require("fs/promises");
const path = require("path");
const os = require("os");
const { execFile } = require("child_process");
const { buildInstalledIndex, norm } = require("./fontNames.js");
const { namesFromFiles, listFontFiles } = require("./fontFiles.js");
const { runWindowsTask } = require("./windowsScript.js");

function _exec(cmd, args, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 }, (err, stdout) =>
      err ? reject(err) : resolve(String(stdout))
    );
  });
}

function _macDirs() {
  return [
    "/System/Library/Fonts",
    "/System/Library/Fonts/Supplemental",
    "/Library/Fonts",
    path.join(os.homedir(), "Library", "Fonts"),
    // fontes que o Office para Mac traz dentro do próprio app
    "/Applications/Microsoft PowerPoint.app/Contents/Resources/DFonts",
  ];
}

function _linuxUserDir() {
  return path.join(os.homedir(), ".local", "share", "fonts", "louvorja");
}

class SystemFonts {
  /**
   * @param {{cacheDir: string, tempDir: string, platform?: NodeJS.Platform, log?: (...a: any[]) => void}} opts
   */
  constructor({ cacheDir, tempDir, platform = process.platform, log = console.log }) {
    this.cacheDir = cacheDir;
    this.tempDir = tempDir;
    this.platform = platform;
    this.log = log;
    /** nomes instalados nesta sessão — o sistema às vezes demora a listar */
    this.session = new Set();
  }

  /**
   * Índice (Set de nomes normalizados) das fontes instaladas.
   * @param {string[]} wanted  nomes que o arquivo pede; se algum não bater pelo
   *   nome registrado, lê o nome interno dos arquivos (mais lento, com cache).
   */
  async index(wanted = []) {
    const nameCache = path.join(this.cacheDir, "nomes-do-sistema.json");
    if (this.platform === "win32") {
      const res = await runWindowsTask("list", {}, { tempDir: this.tempDir, timeoutMs: 60000 });
      const idx = buildInstalledIndex(res, [...this.session]);
      const faltam = wanted.filter((n) => !idx.has(norm(n)));
      if (faltam.length && Array.isArray(res.entries)) {
        const files = res.entries.filter((e) => e.exists !== false && !e.cloud).map((e) => String(e.path));
        for (const n of await namesFromFiles(files, nameCache)) idx.add(n);
      }
      return idx;
    }

    const idx = buildInstalledIndex({}, [...this.session]);
    // fontconfig (Linux, e Mac com Homebrew) é rápido e já conhece os nomes internos
    try {
      const out = await _exec("fc-list", ["--format", "%{family}\n%{fullname}\n"]);
      for (const linha of out.split("\n")) {
        for (const nome of linha.split(",")) if (nome.trim()) idx.add(norm(nome));
      }
      if (this.platform !== "darwin") return idx;
    } catch {
      /* sem fontconfig */
    }
    const dirs =
      this.platform === "darwin"
        ? _macDirs()
        : ["/usr/share/fonts", "/usr/local/share/fonts", path.join(os.homedir(), ".local", "share", "fonts"), path.join(os.homedir(), ".fonts")];
    const files = [];
    for (const d of dirs) files.push(...(await listFontFiles(d)));
    for (const n of await namesFromFiles(files, nameCache)) idx.add(n);
    return idx;
  }

  /**
   * Instala arquivos de fonte para o usuário.
   * @param {{path: string, registryName: string, names: string[]}[]} fonts
   * @param {{temporary?: boolean}} [opts]  temporária = some ao reiniciar (só Windows)
   * @returns {Promise<number>} quantos instalaram
   */
  async install(fonts, { temporary = false } = {}) {
    if (!fonts.length) return 0;
    let ok = 0;
    if (this.platform === "win32") {
      const res = await runWindowsTask(
        "install",
        { fonts: fonts.map((f) => ({ path: f.path, registryName: f.registryName })), temporary },
        { tempDir: this.tempDir, timeoutMs: 60000 }
      );
      ok = (res.installed || []).filter((r) => r.ok).length;
    } else {
      const dir = this.platform === "darwin" ? path.join(os.homedir(), "Library", "Fonts") : _linuxUserDir();
      await fs.mkdir(dir, { recursive: true });
      for (const f of fonts) {
        try {
          await fs.copyFile(f.path, path.join(dir, path.basename(f.path)));
          ok++;
        } catch (e) {
          this.log("[pptx] não copiou a fonte", f.path, e.message);
        }
      }
      if (this.platform !== "darwin") {
        await _exec("fc-cache", ["-f", dir], 60000).catch((e) => this.log("[pptx] fc-cache:", e.message));
      }
    }
    if (ok) fonts.forEach((f) => f.names.forEach((n) => this.session.add(n)));
    return ok;
  }
}

module.exports = { SystemFonts };
