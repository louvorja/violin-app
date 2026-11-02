"use strict";

const path = require("node:path");
const fs = require("node:fs");
const { installRequiresWindowsElevation } = require("./windowsInstallScope.js");

const REGISTRY = "installations.json";
const same = (file) => path.win32.normalize(file).toLowerCase();

function readVersion(exe, readFile) {
  // O fs do Electron lê dentro do app.asar da outra cópia.
  const pkg = JSON.parse(readFile(path.win32.join(path.win32.dirname(exe), "resources", "app.asar", "package.json"), "utf8"));
  return typeof pkg?.version === "string" ? pkg.version : null;
}

/**
 * Uma conta pode acabar com a cópia "só para mim" e a "para todos": o
 * instalador de outro administrador não enxerga a cópia desta conta. As duas
 * abrem o mesmo perfil, e a da máquina só se atualiza com UAC — abrir a mais
 * antiga faria uma versão velha ler o que a nova gravou. Devolve o executável
 * da cópia mais nova quando não é esta; no empate fica a que se atualiza sem UAC.
 *
 * @param {{ execPath: string, version: string, bootstrap: string,
 *   compareVersions: (a: string, b: string) => number, platform?: string,
 *   env?: Record<string, string|undefined>, fsImpl?: typeof fs }} options
 * @returns {string|null}
 */
function newerCopy({ execPath, version, bootstrap, compareVersions, platform = process.platform, env = process.env, fsImpl = fs }) {
  if (platform !== "win32") return null;
  const scope = (exe) => installRequiresWindowsElevation({ platform, execPath: exe, env, readFile: fsImpl.readFileSync });
  const self = { exe: execPath, version, machine: scope(execPath) };
  const file = path.win32.join(bootstrap, REGISTRY);
  let known = [];
  try {
    const data = JSON.parse(fsImpl.readFileSync(file, "utf8"));
    if (Array.isArray(data?.copies)) known = data.copies.filter((exe) => typeof exe === "string");
  } catch { /* primeira abertura ou registro ilegível */ }

  // Cópias que ainda não abriram com este código só aparecem no lugar padrão.
  const dir = path.win32.basename(path.win32.dirname(execPath));
  const exeName = path.win32.basename(execPath);
  const defaults = [env.LOCALAPPDATA && path.win32.join(env.LOCALAPPDATA, "Programs"), env.ProgramW6432, env.ProgramFiles, env["ProgramFiles(x86)"]]
    .filter(Boolean).map((root) => path.win32.join(root, dir, exeName));
  const seen = new Set([same(execPath)]);
  const others = [];
  for (const exe of [...known, ...defaults]) {
    if (seen.has(same(exe))) continue;
    seen.add(same(exe));
    try {
      if (!fsImpl.statSync(exe).isFile()) continue;
      const otherVersion = readVersion(exe, fsImpl.readFileSync);
      if (otherVersion) others.push({ exe, version: otherVersion, machine: scope(exe) });
    } catch { /* cópia removida ou incompleta */ }
  }

  const copies = [execPath, ...others.map((copy) => copy.exe)];
  const changed = copies.length !== known.length || copies.some((exe) => !known.some((k) => same(k) === same(exe)));
  if (changed) {
    try {
      fsImpl.mkdirSync(bootstrap, { recursive: true });
      fsImpl.writeFileSync(file, JSON.stringify({ version: 1, copies }, null, 2));
    } catch { /* sem o registro, as cópias fora do lugar padrão ficam para a próxima */ }
  }

  const winner = others.reduce((best, copy) => {
    const order = compareVersions(copy.version, best.version);
    if (order > 0 || (order === 0 && best.machine && !copy.machine)) return copy;
    return best;
  }, self);
  return winner === self ? null : winner.exe;
}

module.exports = { newerCopy };
