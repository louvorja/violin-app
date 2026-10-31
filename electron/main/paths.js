/**
 * Resolvers de caminhos para o main process do Electron.
 * Todos os caminhos dependem de módulos Electron, então este arquivo
 * deve ser importado SOMENTE no main process.
 */

const { app } = require("electron");
const path = require("path");
const fs = require("fs-extra");
const { prepareProfile } = require("./dataMigration.js");

let _dataDirResolved = null;
let _dataDirIssue = null;

/** @typedef {{ dataDir: string, profileSource?: string }} DataLocation */

/** Arquivo no endereço estável do sistema que aponta para a pasta escolhida. */
function _anchorFile() {
  return path.join(_bootstrapDir(), "data-location.json");
}

function _bootstrapDir() {
  const isolated = process.env.LJ_E2E_USER_DATA?.trim();
  return isolated ? path.resolve(isolated) : path.join(app.getPath("appData"), "LouvorJA Violin");
}

function _readAnchor() {
  try {
    const raw = fs.readJsonSync(_anchorFile());
    return raw && typeof raw.dataDir === "string" && path.isAbsolute(raw.dataDir) ? raw : null;
  } catch (_) {
    return null;
  }
}

/** A troca atômica evita perder o endereço da pasta se a gravação falhar. */
function _writeAnchor(value) {
  fs.ensureDirSync(_bootstrapDir());
  const file = _anchorFile();
  const temp = `${file}.tmp`;
  try {
    fs.writeJsonSync(temp, value, { spaces: 2 });
    fs.renameSync(temp, file);
  } finally {
    fs.removeSync(temp);
  }
}

function _defaultDataDir() {
  try {
    return path.join(app.getPath("documents"), "LouvorJA Violin");
  } catch (_) {
    return path.join(_bootstrapDir(), "data");
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
  /** Perfil interno do Electron, em `<dados>/.electron`. */
  userData() {
    return app.getPath("userData");
  },

  /** Local estável da âncora e do lock; também é a origem das versões antigas. */
  bootstrapDir() {
    return _bootstrapDir();
  },

  profileDir() {
    return path.join(this.dataDir(), ".electron");
  },

  /** Configura o perfil antes de ready, preservando IndexedDB e preferências web. */
  configureProfile() {
    const anchor = _readAnchor();
    const source = anchor?.profileSource;
    const sameRoot = !anchor || path.resolve(anchor.dataDir) === path.resolve(this.dataDir());
    const sourceDir = sameRoot && typeof source === "string" && path.isAbsolute(source)
      && path.basename(source) === ".electron" ? source : null;
    const dir = prepareProfile({ legacyDir: _bootstrapDir(), sourceDir, targetDir: this.profileDir() });
    app.setPath("userData", dir);
    app.setPath("sessionData", dir);
    fs.ensureDirSync(path.join(dir, "logs"));
    fs.ensureDirSync(path.join(dir, "Crashpad"));
    app.setPath("logs", path.join(dir, "logs"));
    app.setPath("crashDumps", path.join(dir, "Crashpad"));
    // Um disco temporariamente indisponível não deve apagar a pasta escolhida,
    // e um perfil que não mudou de lugar mantém `profileSource` para o próximo boot.
    if (sameRoot && dir === this.profileDir()) _writeAnchor({ dataDir: this.dataDir() });
    return dir;
  },

  profileRestartRequired() {
    return path.resolve(app.getPath("userData")) !== path.resolve(this.profileDir());
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
   * de mídia, `storage/` com as preferências e `.electron/` com o perfil.
   * Uma pasta só para o operador
   * levar embora, copiar para outra máquina ou apontar um backup.
   *
   * Resolução: pasta escolhida pelo usuário (âncora) → `Documents/LouvorJA
   * Violin` → endereço estável do sistema como último recurso. A âncora mora ali
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

    const anchored = _readAnchor()?.dataDir;
    const candidates = anchored ? [anchored, _defaultDataDir()] : [_defaultDataDir()];

    for (const dir of candidates) {
      if (_isWritable(dir)) {
        _dataDirResolved = dir;
        _dataDirIssue = dir === candidates[0] ? null : { wanted: candidates[0], reason: "not-writable" };
        return dir;
      }
    }

    _dataDirIssue = { wanted: candidates[0], reason: "not-writable" };
    _dataDirResolved = _bootstrapDir();
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
  setDataDir(dir, { moveExisting = false } = {}) {
    const abs = path.resolve(dir);
    if (!_isWritable(abs)) {
      throw new Error(`[paths] Sem permissão de escrita em ${abs}`);
    }
    const currentProfile = app.getPath("userData");
    const profileSource = moveExisting && path.basename(currentProfile) === ".electron"
      && path.resolve(currentProfile) !== path.join(abs, ".electron") ? currentProfile : undefined;
    _writeAnchor({ dataDir: abs, profileSource });
    _dataDirResolved = abs;
    _dataDirIssue = null;
    return abs;
  },

  /** Diretório de mídia (mp3, imagens, capas). */
  filesDir() {
    return path.join(this.dataDir(), "files");
  },

  /** Vídeos online baixados, junto do restante dos dados do usuário. */
  videosDir() {
    return path.join(this.dataDir(), "Videos");
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
    const dirs = [path.join(_bootstrapDir(), "files")];
    if (docs) {
      dirs.unshift(path.join(docs, "LouvorJA"));
      dirs.unshift(path.join(docs, "LouvorJA Violin"));
    }
    return dirs;
  },

  /** Cache JSON do banco, dentro da pasta de dados escolhida. */
  jsonCacheDir() {
    return path.join(this.dataDir(), "json_db");
  },
};
