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

/**
 * O idioma da instalação clássica, que decide se `musicas/` responde por
 * `musics/pt` ou por `musics/es`. Marcado por um arquivo em `%APPDATA%`.
 *
 * @param {string} [home]
 * @returns {"pt"|"es"|null}
 */
function detectLanguage(home = os.homedir()) {
  const bases = [
    path.join(home, "AppData", "Roaming", "LouvorJA"),
    // Wine: o %APPDATA% do Windows emulado mora dentro do disco C do bottle.
    path.join(home, ".wine", "drive_c", "users", os.userInfo().username, "AppData", "Roaming", "LouvorJA"),
  ];
  for (const base of bases) {
    try {
      if (fs.existsSync(path.join(base, "configPT"))) return "pt";
      if (fs.existsSync(path.join(base, "configES"))) return "es";
    } catch {
      /* próxima base */
    }
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
    if (algum) return { ok: true, configDir, folders };
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
  const lang = detectLanguage();
  const achados = [];
  for (const dir of classicSearchDirs({ home: os.homedir() })) {
    const r = validate(dir);
    if (r.ok) achados.push({ dir, configDir: r.configDir, lang, folders: r.folders });
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
