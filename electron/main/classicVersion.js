"use strict";

/**
 * classicVersion.js — Detecção da versão clássica Delphi do LouvorJA.
 *
 * Verifica se existe a pasta raiz da instalação em C:/Program Files (x86)/Louvor JA
 * e detecta o idioma via %APPDATA%/LouvorJA/configPT ou configES.
 */

const path = require("path");
const fs = require("fs-extra");
const os = require("os");

const CLASSIC_INSTALL_DIR = "C:\\Program Files (x86)\\Louvor JA";
const CLASSIC_CONFIG_DIR = "config";

const CLASSIC_FOLDERS = {
  capas: "capas",
  imagens: "imagens",
  musicas: "musicas",
};

function _hasFiles(dir) {
  try {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return false;
    const entries = fs.readdirSync(dir);
    return entries.length > 0;
  } catch {
    return false;
  }
}

function _detectLanguage() {
  const appData = path.join(os.homedir(), "AppData", "Roaming", "LouvorJA");
  try {
    if (fs.existsSync(path.join(appData, "configPT"))) return "pt";
    if (fs.existsSync(path.join(appData, "configES"))) return "es";
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Detecta se a versão clássica Delphi está instalada.
 * @param {string} [installDir=CLASSIC_INSTALL_DIR] Diretório raiz da instalação.
 * @returns {{ detected: boolean, installDir: string, configDir: string,
 *             lang: "pt"|"es"|null, folders: { capas: boolean, imagens: boolean, musicas: boolean } }}
 */
function detect(installDir = CLASSIC_INSTALL_DIR) {
  const configDir = path.join(installDir, CLASSIC_CONFIG_DIR);

  let detected = false;
  try {
    detected = fs.existsSync(installDir) && fs.statSync(installDir).isDirectory();
  } catch {
    detected = false;
  }

  const lang = detected ? _detectLanguage() : null;

  const folders = {
    capas: false,
    imagens: false,
    musicas: false,
  };

  if (detected) {
    for (const [key, folder] of Object.entries(CLASSIC_FOLDERS)) {
      folders[key] = _hasFiles(path.join(configDir, folder));
    }
  }

  return {
    detected,
    installDir,
    configDir,
    lang,
    folders,
  };
}

module.exports = {
  detect,
  CLASSIC_INSTALL_DIR,
  CLASSIC_CONFIG_DIR,
};
