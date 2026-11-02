"use strict";

const path = require("path");
const fs = require("fs");

function _normalizeWinPath(value) {
  const normalized = path.win32.normalize(String(value || "").trim());
  return normalized.replace(/[\\/]+$/, "").toLowerCase();
}

function _isInside(root, target) {
  if (!root || !target) return false;
  return target === root || target.startsWith(`${root}\\`);
}

/**
 * Detecta se o executável está numa pasta protegida que exige elevação para
 * substituir arquivos (normalmente Program Files). `path.win32` é intencional:
 * os testes rodam em macOS/Linux, mas a entrada representa sempre o caminho do
 * Windows.
 *
 * @param {{ platform?: string, execPath?: string, env?: Record<string,string|undefined>, readFile?: typeof fs.readFileSync }} [options]
 */
function installRequiresWindowsElevation({
  platform = process.platform,
  execPath = process.execPath,
  env = process.env,
  readFile = fs.readFileSync,
} = {}) {
  if (platform !== "win32") return false;
  try {
    const marker = JSON.parse(readFile(path.win32.join(path.win32.dirname(execPath), "resources", "install-scope.json"), "utf8"));
    if (marker?.version === 1 && marker.scope === "machine") return true;
  } catch { /* Older installers have no marker; retain the Program Files check. */ }
  const target = _normalizeWinPath(execPath);
  if (!target) return false;

  const variables = env || {};
  const roots = [variables.ProgramW6432, variables.ProgramFiles, variables["ProgramFiles(x86)"]]
    .map(_normalizeWinPath)
    .filter(Boolean);
  return roots.some((root) => _isInside(root, target));
}

module.exports = { installRequiresWindowsElevation };
