"use strict";
const path = require("path");
const os = require("os");
const fs = require("fs-extra");
const paths = require("./paths.js");
const { classicSearchDirs, CLASSIC_FOLDERS } = require("./mediaRoots.js");
const { shortcutDirectories, discoverShortcuts, winePrefixes } = require("./classicDiscovery.js");

/**
 * classicLibrary — a instalação da versão clássica em Delphi como origem de
 * LEITURA do acervo.
 *
 * A origem é sempre somente leitura, inclusive na importação explícita. Os
 * arquivos existentes no Violin também não são sobrescritos pela importação.
 */

/** Subpastas do acervo clássico, dentro de `config/`. */
const SUBPASTAS = ["capas", "imagens", "musicas"];

/** O clássico guarda mídia e banco em `<pasta do exe>/config`. */
const CONFIG_DIR = "config";

function _temConteudo(dir) {
  try {
    return fs.statSync(dir).isDirectory() && fs.readdirSync(dir).length > 0;
  } catch {
    return false;
  }
}

function _detectLanguageMarkers(base) {
  if (!base) return [];
  // O Delphi renomeia `config.ja` para `configPT.ja`/`configES.ja`. As
  // versões muito antigas deixavam o sufixo sem extensão, por isso os dois
  // formatos continuam válidos.
  const encontrados = new Set();
  for (const marker of ["configPT.ja", "configPT", "configES.ja", "configES"]) {
    try {
      if (fs.lstatSync(path.join(base, marker)).isFile()) {
        encontrados.add(marker.toLowerCase().includes("configes") ? "es" : "pt");
      }
    } catch {
      /* tenta o próximo marcador */
    }
  }
  // O clássico mantém um arquivo de configuração por idioma; se a pessoa já
  // alternou entre PT e ES, ambos podem existir e nenhum deles diz qual mídia
  // está na instalação. Nesse caso é mais seguro não adivinhar.
  return [...encontrados];
}

function readTranslationLanguage(file) {
  try {
    const info = fs.lstatSync(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 1024 * 1024) return null;
    return fs.readFileSync(file, "utf8").match(/^\s*_\s*=\s*(PT|ES)\s*$/im)?.[1].toLowerCase() || null;
  } catch { return null; }
}

function _detectTranslationFile(base) {
  try {
    const langs = new Set(fs.readdirSync(base)
      .filter((name) => /\.translate$/i.test(name))
      .map((name) => readTranslationLanguage(path.join(base, name)))
      .filter(Boolean));
    return [...langs];
  } catch { return []; }
}

/** Evidence must belong to the selected installation. A global APPDATA marker
 * may describe another Classic installation, so it cannot choose this one's
 * language. An explicit choice or shortcut translation file can disambiguate. */
function detectLanguage(home = os.homedir(), configDir = null) {
  if (configDir) {
    const translated = _detectTranslationFile(path.dirname(configDir));
    if (translated.length) return translated.length === 1 ? translated[0] : null;
    const langs = new Set([configDir, path.dirname(configDir)]
      .flatMap(_detectLanguageMarkers));
    return langs.size === 1 ? [...langs][0] : null;
  }
  const bases = [
    process.env.APPDATA && path.join(process.env.APPDATA, "LouvorJA"),
    path.join(home, "AppData", "Roaming", "LouvorJA"),
  ].filter(Boolean);
  const langs = new Set(bases.flatMap(_detectLanguageMarkers));
  return langs.size === 1 ? [...langs][0] : null;
}

/**
 * Aceita tanto a raiz da instalação quanto o próprio `config/`, e devolve a
 * pasta do acervo. É o que salva o caso do Wine e do usuário que instalou fora
 * do lugar padrão: ele aponta a pasta na mão e não precisa saber a estrutura.
 *
 * @param {string} dir
 * @returns {{ ok: boolean, configDir?: string, folders?: object, error?: string }}
 */
function validate(dir) {
  if (typeof dir !== "string" || !dir || dir.includes("\0") || !path.isAbsolute(dir)) {
    return { ok: false, error: "invalid-dir" };
  }
  try {
    if (fs.lstatSync(dir).isSymbolicLink()) return { ok: false, error: "symbolic-link" };
  } catch { return { ok: false, error: "not-found" }; }

  const candidatos = [path.join(dir, CONFIG_DIR), dir];
  for (const candidate of candidatos) {
    let configDir;
    try {
      const info = fs.lstatSync(candidate);
      if (info.isSymbolicLink()) return { ok: false, error: "symbolic-link" };
      if (!info.isDirectory()) continue;
      configDir = fs.realpathSync(candidate);
    } catch { continue; }
    const folders = {};
    let algum = false;
    for (const sub of SUBPASTAS) {
      try {
        if (fs.lstatSync(path.join(configDir, sub)).isSymbolicLink()) return { ok: false, error: "symbolic-link" };
      } catch { /* optional media folder */ }
      folders[sub] = _temConteudo(path.join(configDir, sub));
      if (folders[sub]) algum = true;
    }
    // Uma instalação recém-instalada pode ter só o banco baixado; rejeitá-la
    // aqui fazia a detecção dizer "não encontrado" até o primeiro download de
    // mídia, embora fosse justamente um legado válido para sincronizar.
    folders.database = (() => {
      try {
        const stat = fs.lstatSync(path.join(configDir, "database.db"));
        return stat.isFile() && stat.size > 0;
      } catch {
        return false;
      }
    })();
    if (algum || folders.database) return { ok: true, configDir, folders, lang: detectLanguage(os.homedir(), configDir) };
  }

  return { ok: false, error: "no-content" };
}

/**
 * Palpites de onde a instalação clássica pode estar. Serve para OFERECER ao
 * usuário — quem decide é ele, porque fora do Windows a pasta vive dentro do
 * disco emulado do Wine, em caminho que só o dono conhece.
 *
 * @returns {Array<{ dir: string, configDir: string, lang: string|null, folders: object }>}
 */
function detect({ platform = process.platform, home = os.homedir(), env = process.env, readShortcutLink, desktop } = {}) {
  const candidates = classicSearchDirs({ platform, home, env, winePrefixes: winePrefixes({ home, env }) })
    .map((dir) => ({ dir }));
  if (platform === "win32") {
    if (!readShortcutLink) {
      try {
        const electron = require("electron");
        readShortcutLink = electron.shell?.readShortcutLink;
        desktop = desktop || electron.app?.getPath("desktop");
      } catch { /* manual selection remains available */ }
    }
    candidates.unshift(...discoverShortcuts({
      directories: shortcutDirectories({ home, env, desktop }), readShortcutLink,
    }));
  }
  const found = new Map();
  for (const candidate of candidates) {
    const r = validate(candidate.configDir || candidate.dir);
    if (!r.ok) continue;
    const lang = candidate.translationFile ? readTranslationLanguage(candidate.translationFile) : r.lang;
    const key = platform === "win32" ? r.configDir.toLowerCase() : r.configDir;
    const previous = found.get(key);
    if (previous) {
      if (lang && previous.lang && lang !== previous.lang) { previous.lang = null; previous.ambiguous = true; }
      else if (lang && !previous.lang && !previous.ambiguous) previous.lang = lang;
    } else found.set(key, {
      dir: candidate.dir, configDir: r.configDir, lang, folders: r.folders,
      ambiguous: !!candidate.translationFile && !lang,
    });
  }
  return [...found.values()].map(({ ambiguous: _ambiguous, ...candidate }) => candidate);
}

function _dentroDe(alvo, base) {
  const rel = path.relative(base, alvo);
  return !rel || (!rel.startsWith(`..${path.sep}`) && rel !== ".." && !path.isAbsolute(rel));
}

// Resolve existing ancestors too, so aliases/junctions cannot hide an overlap
// when the final destination directory has not been created yet.
function canonical(dir) {
  let current = path.resolve(dir);
  const tail = [];
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    tail.unshift(path.basename(current));
    current = parent;
  }
  return path.join(fs.realpathSync(current), ...tail);
}

function overlaps(first, second) {
  const a = canonical(first), b = canonical(second);
  return _dentroDe(a, b) || _dentroDe(b, a);
}

function normalizeSource(opts) {
  if (!opts || typeof opts !== "object" || Array.isArray(opts)) return { ok: false, error: "invalid-options" };
  const { dir, lang, enabled } = opts;
  if (enabled !== undefined && typeof enabled !== "boolean") return { ok: false, error: "invalid-enabled" };
  if (lang !== undefined && lang !== null && lang !== "pt" && lang !== "es") return { ok: false, error: "invalid-language" };
  if (dir === null) return { ok: true, dir: null, lang: null, enabled: false };
  if (enabled === false && typeof dir === "string" && path.isAbsolute(dir) && !dir.includes("\0")) {
    return { ok: true, dir: path.resolve(dir), lang: lang || null, enabled: false };
  }
  const r = validate(dir);
  if (!r.ok) return r;
  try {
    for (const root of [paths.filesDir(), paths.dataDir(), paths.videosDir()]) {
      if (overlaps(r.configDir, root)) return { ok: false, error: "overlapping" };
    }
  } catch { return { ok: false, error: "invalid-dir" }; }
  const resolvedLang = lang || r.lang;
  if (enabled !== false && r.folders.musicas && !resolvedLang) return { ok: false, error: "language-required" };
  return { ok: true, dir: r.configDir, lang: resolvedLang || null, enabled: enabled !== false };
}

/** Explicit copy only; neither source removal nor destination overwrite is
 * supported. Preflight the complete tree before writing any media. */
async function importFrom(configDir, opts = {}) {
  if (!opts || typeof opts !== "object" || Array.isArray(opts)) return { ok: false, error: "invalid-options" };
  if (opts.move !== undefined && opts.move !== false) return { ok: false, error: "move-not-supported" };
  const source = normalizeSource({ dir: configDir, lang: opts.lang, enabled: true });
  if (!source.ok) return source;
  if (!source.dir) return { ok: false, error: "invalid-dir" };
  const destination = canonical(paths.filesDir());
  const mapping = CLASSIC_FOLDERS.map(([modern, classic]) => [classic.replace(/\/$/, ""), modern.replace(/\/$/, "")]);
  if (source.lang) mapping.push(["musicas", path.join("musics", source.lang)]);
  const files = [], folders = [];
  async function collect(from, to) {
    const stat = await fs.lstat(from);
    if (stat.isSymbolicLink()) throw new Error("symbolic-link");
    if (await fs.pathExists(to)) {
      const target = await fs.lstat(to);
      if (target.isSymbolicLink()) throw new Error("symbolic-link");
      if (!stat.isDirectory() || !target.isDirectory()) throw new Error("destination-exists");
    }
    if (stat.isDirectory()) {
      folders.push(to);
      for (const name of await fs.readdir(from)) await collect(path.join(from, name), path.join(to, name));
    } else if (stat.isFile()) files.push([from, to]);
    else throw new Error("unsupported-entry");
  }
  const copied = [];
  try {
    for (const [classic, modern] of mapping) {
      const from = path.join(source.dir, classic);
      if (!(await fs.pathExists(from))) continue;
      const to = path.join(destination, modern);
      // Existing destination ancestors may themselves be links.
      if (!_dentroDe(canonical(to), destination)) throw new Error("symbolic-link");
      await collect(from, to);
      copied.push(classic);
    }
    require("./storageAccess.js").assertWritable("media");
    for (const directory of folders) await fs.ensureDir(directory);
    for (const [from, to] of files) await fs.copyFile(from, to, fs.constants.COPYFILE_EXCL);
    return { ok: true, copiadas: copied };
  } catch (err) {
    return { ok: false, error: err.code === "EEXIST" ? "destination-exists" : err.message };
  }
}

module.exports = { detect, validate, detectLanguage, normalizeSource, importFrom, SUBPASTAS, CONFIG_DIR };
