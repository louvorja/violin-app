"use strict";
const path = require("path");
const os = require("os");
const fs = require("fs-extra");
const paths = require("./paths.js");
const { classicSearchDirs, CLASSIC_FOLDERS } = require("./mediaRoots.js");

/**
 * classicLibrary — a instalação da versão clássica em Delphi como origem de
 * LEITURA do acervo.
 *
 * Nada aqui grava, move ou apaga do lado do clássico, com uma única exceção
 * pedida explicitamente pelo usuário (`importFrom` com `move`). A razão é que
 * muita gente roda os dois programas em paralelo enquanto ganha confiança no
 * novo: mexer no acervo deles quebraria o que ainda está em uso.
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

function _detectLanguageMarker(base) {
  if (!base) return null;
  // O Delphi renomeia `config.ja` para `configPT.ja`/`configES.ja`. As
  // versões muito antigas deixavam o sufixo sem extensão, por isso os dois
  // formatos continuam válidos.
  const encontrados = new Set();
  for (const marker of ["configPT.ja", "configPT", "configES.ja", "configES"]) {
    try {
      if (fs.existsSync(path.join(base, marker))) {
        encontrados.add(marker.toLowerCase().includes("configes") ? "es" : "pt");
      }
    } catch {
      /* tenta o próximo marcador */
    }
  }
  // O clássico mantém um arquivo de configuração por idioma; se a pessoa já
  // alternou entre PT e ES, ambos podem existir e nenhum deles diz qual mídia
  // está na instalação. Nesse caso é mais seguro não adivinhar.
  return encontrados.size === 1 ? [...encontrados][0] : null;
}

function _detectTranslationFile(base) {
  if (!base) return null;
  try {
    for (const name of fs.readdirSync(base)) {
      if (!/\.translate$/i.test(name)) continue;
      const text = fs.readFileSync(path.join(base, name), "utf8");
      const lang = text.match(/^\s*_\s*=\s*(PT|ES)\s*$/im)?.[1];
      if (lang) return lang.toLowerCase();
    }
  } catch {
    /* instalação pode estar parcialmente acessível */
  }
  return null;
}

/**
 * O idioma da instalação clássica, que decide se `musicas/` responde por
 * `musics/pt` ou por `musics/es`. O marcador do legado vive em `%APPDATA%`,
 * mas aceitamos também o diretório selecionado para diagnosticar instalações
 * copiadas/portáteis.
 *
 * @param {string} [home]
 * @param {string|null} [configDir]
 * @returns {"pt"|"es"|null}
 */
function detectLanguage(home = os.homedir(), configDir = null) {
  const bases = [];
  if (configDir) {
    bases.push(configDir, path.dirname(configDir));
    const translated = _detectTranslationFile(path.dirname(configDir));
    if (translated) return translated;
  }

  const appData = process.env.APPDATA;
  if (appData) bases.push(path.join(appData, "LouvorJA"));
  bases.push(path.join(home, "AppData", "Roaming", "LouvorJA"));
  // Wine: o %APPDATA% do Windows emulado mora dentro do disco C do bottle.
  try {
    bases.push(
      path.join(
        home,
        ".wine",
        "drive_c",
        "users",
        os.userInfo().username,
        "AppData",
        "Roaming",
        "LouvorJA"
      )
    );
  } catch {
    /* ambiente sem userInfo — as bases anteriores ainda são suficientes */
  }

  const vistos = new Set();
  for (const base of bases) {
    if (!base) continue;
    const normalizado = path.resolve(base);
    if (vistos.has(normalizado)) continue;
    vistos.add(normalizado);
    const lang = _detectLanguageMarker(normalizado);
    if (lang) return lang;
  }
  return null;
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
  if (!dir) return { ok: false, error: "no-dir" };

  const candidatos = [path.join(dir, CONFIG_DIR), dir];
  for (const configDir of candidatos) {
    const folders = {};
    let algum = false;
    for (const sub of SUBPASTAS) {
      folders[sub] = _temConteudo(path.join(configDir, sub));
      if (folders[sub]) algum = true;
    }
    // Uma instalação recém-instalada pode ter só o banco baixado; rejeitá-la
    // aqui fazia a detecção dizer "não encontrado" até o primeiro download de
    // mídia, embora fosse justamente um legado válido para sincronizar.
    folders.database = (() => {
      try {
        const stat = fs.statSync(path.join(configDir, "database.db"));
        return stat.isFile() && stat.size > 0;
      } catch {
        return false;
      }
    })();
    if (algum || folders.database) return { ok: true, configDir, folders };
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
function detect() {
  const achados = [];
  for (const dir of classicSearchDirs({ home: os.homedir() })) {
    const r = validate(dir);
    if (r.ok) {
      const configDir = path.resolve(r.configDir);
      if (achados.some((item) => path.resolve(item.configDir) === configDir)) continue;
      achados.push({
        dir,
        configDir: r.configDir,
        lang: detectLanguage(os.homedir(), r.configDir),
        folders: r.folders,
      });
    }
  }
  return achados;
}

function _dentroDe(alvo, base) {
  const a = path.resolve(alvo);
  const b = path.resolve(base);
  return a === b || a.startsWith(b + path.sep);
}

/**
 * Copia (ou move) o acervo clássico para a pasta de dados do app, traduzindo os
 * nomes de pasta. Ação separada e explícita: ler no lugar não gasta disco nem
 * mexe no que é do outro programa, então isto só acontece a pedido.
 *
 * @param {string} configDir  pasta `config` da instalação clássica
 * @param {{ lang?: string, move?: boolean }} opts
 * @returns {Promise<{ ok: boolean, copiadas?: string[], error?: string }>}
 */
async function importFrom(configDir, { lang = "pt", move = false } = {}) {
  if (!configDir) return { ok: false, error: "no-dir" };
  if (!(await fs.pathExists(configDir))) return { ok: false, error: "not-found" };

  const destinoBase = paths.filesDir();
  // Origem e destino aninhados viram cópia recursiva sobre si mesma.
  if (_dentroDe(configDir, destinoBase) || _dentroDe(destinoBase, configDir)) {
    return { ok: false, error: "overlapping" };
  }

  const mapa = CLASSIC_FOLDERS.map(([novo, antigo]) => ({
    origem: path.join(configDir, antigo.replace(/\/$/, "")),
    destino: path.join(destinoBase, novo.replace(/\/$/, "")),
  }));
  mapa.push({
    origem: path.join(configDir, "musicas"),
    destino: path.join(destinoBase, "musics", lang || "pt"),
  });

  const copiadas = [];
  for (const { origem, destino } of mapa) {
    if (!(await fs.pathExists(origem))) continue;
    await fs.ensureDir(destino);
    await fs.copy(origem, destino, { overwrite: true });
    copiadas.push(path.basename(origem));

    if (move) {
      // Só as subpastas conhecidas, nunca o `config` inteiro: lá dentro mora
      // também o banco do clássico, que não é nosso para apagar.
      try {
        await fs.remove(origem);
      } catch (_) {
        /* arquivo em uso pelo clássico aberto */
      }
    }
  }

  return { ok: true, copiadas };
}

module.exports = { detect, validate, detectLanguage, importFrom, SUBPASTAS, CONFIG_DIR };
