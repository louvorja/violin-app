/**
 * Resolvers de caminhos para o main process do Electron.
 * Todos os caminhos dependem de módulos Electron, então este arquivo
 * deve ser importado SOMENTE no main process.
 */

const { app } = require("electron");
const path = require("path");
const fs = require("fs-extra");

let _dataDirResolved = null;
let _dataDirIssue = null;

/** Arquivo, no userData, que aponta para a pasta de dados escolhida. */
function _anchorFile() {
  return path.join(app.getPath("userData"), "data-location.json");
}

function _readAnchor() {
  try {
    const raw = fs.readJsonSync(_anchorFile());
    return raw && typeof raw.dataDir === "string" ? raw.dataDir : null;
  } catch (_) {
    return null;
  }
}

function _defaultDataDir() {
  try {
    return path.join(app.getPath("documents"), "LouvorJA Violin");
  } catch (_) {
    return path.join(app.getPath("userData"), "data");
  }
}

/** Cria a pasta e confirma a escrita de fato — permissão só se sabe tentando. */
function _isWritable(dir) {
  try {
    fs.ensureDirSync(dir);
    const probe = path.join(dir, ".write-probe");
    fs.writeFileSync(probe, "");
    fs.removeSync(probe);
    return true;
  } catch (_) {
    return false;
  }
}

module.exports = {
  /** Diretório de dados do usuário (%APPDATA%/LouvorJA Violin no Windows) */
  userData() {
    return app.getPath("userData");
  },

  /** Diretório temporário do sistema operacional */
  tempDir() {
    return app.getPath("temp");
  },

  /** Raiz da aplicação (onde está o package.json / asar) */
  appRoot() {
    return app.getAppPath();
  },

  /** Caminho para o build web (dist/) */
  webBuild() {
    return path.join(app.getAppPath(), "dist");
  },

  /**
   * Pasta de dados: a raiz de tudo que é do usuário — `files/` com o acervo
   * de mídia e `storage/` com as preferências. Uma pasta só para o operador
   * levar embora, copiar para outra máquina ou apontar um backup.
   *
   * Resolução: pasta escolhida pelo usuário (âncora) → `Documents/LouvorJA
   * Violin` → `<userData>` como último recurso. A âncora mora no userData
   * justamente porque alguém precisa saber onde a pasta está antes de abri-la.
   *
   * Documents pode não aceitar escrita — Controlled Folder Access do Windows
   * Defender bloqueia sem aviso, e um OneDrive sem espaço falha igual. Nesse
   * caso caímos para o userData e registramos o motivo em `dataDirIssue()`,
   * para a tela de Armazenamento dizer ao operador o que aconteceu em vez de
   * o app parecer que perdeu tudo.
   */
  dataDir() {
    if (_dataDirResolved) return _dataDirResolved;

    const anchored = _readAnchor();
    const candidates = anchored ? [anchored, _defaultDataDir()] : [_defaultDataDir()];

    for (const dir of candidates) {
      if (_isWritable(dir)) {
        _dataDirResolved = dir;
        _dataDirIssue = null;
        return dir;
      }
    }

    _dataDirIssue = { wanted: candidates[0], reason: "not-writable" };
    _dataDirResolved = app.getPath("userData");
    console.warn(`[paths] Pasta de dados sem escrita (${candidates[0]}); usando ${_dataDirResolved}`);
    return _dataDirResolved;
  },

  /** Motivo do fallback da pasta de dados, ou null quando ela resolveu. */
  dataDirIssue() {
    this.dataDir();
    return _dataDirIssue;
  },

  /**
   * Aponta a pasta de dados para outro lugar e grava a âncora. Não move
   * conteúdo — quem chama decide o que fazer com o que ficou para trás.
   */
  setDataDir(dir) {
    const abs = path.resolve(dir);
    if (!_isWritable(abs)) {
      throw new Error(`[paths] Sem permissão de escrita em ${abs}`);
    }
    fs.writeJsonSync(_anchorFile(), { dataDir: abs }, { spaces: 2 });
    _dataDirResolved = abs;
    _dataDirIssue = null;
    return abs;
  },

  /** Diretório de mídia (mp3, imagens, capas). */
  filesDir() {
    return path.join(this.dataDir(), "files");
  },

  /**
   * Pastas onde versões anteriores guardaram o acervo, na ordem em que a
   * migração deve procurar. `Documents/LouvorJA Violin` aparece como raiz
   * porque até aqui a mídia ficava solta nela, sem o `files/` no meio.
   */
  legacyMediaDirs() {
    const docs = (() => {
      try {
        return app.getPath("documents");
      } catch (_) {
        return null;
      }
    })();
    const dirs = [path.join(app.getPath("userData"), "files")];
    if (docs) {
      dirs.unshift(path.join(docs, "LouvorJA"));
      dirs.unshift(path.join(docs, "LouvorJA Violin"));
    }
    return dirs;
  },

  /** Cache JSON do banco (userData/json_db). */
  jsonCacheDir() {
    return path.join(app.getPath("userData"), "json_db");
  },
};
