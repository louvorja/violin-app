"use strict";

const path = require("path");
const fs = require("fs-extra");

// CommandLineToArgvW-compatible quoting for shortcut arguments. In particular,
// the empty first argument matters: Classic reads its options in ParamStr(2).
function splitWindowsArguments(text) {
  if (typeof text !== "string" || text.length > 32768 || text.includes("\0")) return [];
  const args = [];
  let i = 0;
  while (i < text.length) {
    while (/\s/.test(text[i] || "") && i < text.length) i++;
    if (i >= text.length) break;
    let arg = "", quoted = false;
    while (i < text.length && (quoted || !/\s/.test(text[i]))) {
      let slashes = 0;
      while (text[i] === "\\") { slashes++; i++; }
      if (text[i] === '"') {
        arg += "\\".repeat(Math.floor(slashes / 2));
        if (slashes % 2) arg += '"';
        else if (quoted && text[i + 1] === '"') { arg += '"'; i++; }
        else quoted = !quoted;
        i++;
      } else {
        arg += "\\".repeat(slashes);
        if (i < text.length) arg += text[i++];
      }
    }
    if (quoted) return []; // malformed shortcut: do not infer a different root
    args.push(arg);
  }
  return args;
}

function candidateFromShortcut(shortcut, pathApi = path.win32) {
  if (!shortcut || typeof shortcut.target !== "string" || !pathApi.isAbsolute(shortcut.target)) return null;
  if (!/^(?:louvor\s?ja|loor\s?ja)\.exe$/i.test(pathApi.basename(shortcut.target))) return null;
  const installDir = pathApi.dirname(shortcut.target);
  if (shortcut.args !== undefined && typeof shortcut.args !== "string") return null;
  const args = splitWindowsArguments(shortcut.args || "");
  if (shortcut.args?.trim() && !args.length) return null;
  const options = new Map();
  for (const item of (args[1] || "").split(";")) {
    const split = item.indexOf("=");
    if (split <= 0) continue;
    const key = item.slice(0, split).trim().toLowerCase();
    // Delphi TStringList.Values reads the first matching name.
    if (!options.has(key)) options.set(key, item.slice(split + 1).trim());
  }
  const relative = options.get("dir_config") || "config";
  // Delphi concatenates this value to the executable's directory; a drive or
  // absolute path here is not a supported alternate configuration.
  if (pathApi.isAbsolute(relative) || /[:\0]/.test(relative)) return null;
  const translation = options.get("lang");
  if (translation && !/^[\p{L}\p{N}_ -]+$/u.test(translation)) return null;
  return {
    dir: installDir,
    configDir: pathApi.resolve(installDir, relative),
    translationFile: translation ? pathApi.join(installDir, "lang", `${translation}.txt`) : null,
  };
}

function shortcutDirectories({ home = "", env = process.env, desktop = null } = {}) {
  return [...new Set([
    desktop,
    home && path.win32.join(home, "Desktop"),
    env.PUBLIC && path.win32.join(env.PUBLIC, "Desktop"),
    env.APPDATA && path.win32.join(env.APPDATA, "Microsoft", "Windows", "Start Menu", "Programs"),
    env.ProgramData && path.win32.join(env.ProgramData, "Microsoft", "Windows", "Start Menu", "Programs"),
  ].filter(Boolean))];
}

// Only inspect the user's/public desktop and Start Menu. No full-disk scan,
// execution, shortcut mutation, or following directory links.
function discoverShortcuts({ directories, readShortcutLink }) {
  if (typeof readShortcutLink !== "function") return [];
  const results = [];
  let remaining = 2000;
  const visit = (dir, depth) => {
    if (depth > 4 || remaining <= 0) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (--remaining < 0) break;
      if (entry.isSymbolicLink()) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full, depth + 1);
      else if (entry.isFile() && /\.lnk$/i.test(entry.name)) {
        try {
          const candidate = candidateFromShortcut(readShortcutLink(full));
          if (candidate) results.push(candidate);
        } catch { /* inaccessible or stale shortcut */ }
      }
    }
  };
  for (const directory of directories || []) visit(directory, 0);
  return results;
}

function winePrefixes({ home, env = process.env }) {
  const roots = [env.WINEPREFIX, home && path.join(home, ".wine")].filter(Boolean);
  if (home) {
    for (const parent of [
      path.join(home, "Library", "Application Support", "CrossOver", "Bottles"),
      path.join(home, ".local", "share", "bottles", "bottles"),
      path.join(home, ".var", "app", "com.usebottles.bottles", "data", "bottles", "bottles"),
    ]) {
      try {
        for (const entry of fs.readdirSync(parent, { withFileTypes: true }).slice(0, 100)) {
          if (entry.isDirectory() && !entry.isSymbolicLink()) roots.push(path.join(parent, entry.name));
        }
      } catch { /* Wine manager is not installed */ }
    }
  }
  return [...new Set(roots.filter((root) => typeof root === "string" && path.isAbsolute(root)))];
}

module.exports = { splitWindowsArguments, candidateFromShortcut, shortcutDirectories, discoverShortcuts, winePrefixes };
