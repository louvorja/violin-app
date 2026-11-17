"use strict";

/**
 * libraryFiles — arquivos das bibliotecas do app gravados no acervo.
 *
 * Biblioteca de Mídia, Projeção de Fundo, Som de Fundo e os arquivos que vêm
 * dentro de um pacote de liturgia deixam de morar no IndexedDB (ou de apontar
 * para a pasta de onde o operador escolheu o arquivo) e passam a ter uma cópia
 * no acervo, em pastas próprias:
 *
 *   <acervo>/media-library/<id>/<nome>
 *   <acervo>/background-projection/<id>/<nome>
 *   <acervo>/background-sound/<id>/<nome>
 *   <acervo>/liturgy-files/<id>/<nome>
 *
 * O banco guarda só metadados e o caminho **relativo** (`media-library/...`).
 * Caminho relativo sobrevive à mudança de pasta do acervo; caminho absoluto
 * não. Cada registro tem a própria subpasta, então apagar o registro apaga
 * exatamente um arquivo.
 *
 * Regras de fronteira, porque o renderer é quem manda o caminho e os bytes:
 *   - `kind` só pode ser um dos quatro acima;
 *   - `recordId` é um identificador curto, sem barra e sem `..`;
 *   - o nome é saneado e a extensão precisa ser aceita pela pasta;
 *   - a origem de `storePath` tem de ser arquivo regular, não link;
 *   - a escrita é atômica: `<destino>.part-<uuid>` e depois `rename`;
 *   - `remove` só apaga caminho relativo dentro das quatro pastas.
 *
 * Também hospeda o sink de exportação do pacote `.llja`: o renderer monta o ZIP
 * em streaming e manda os pedaços; o main grava no destino escolhido no
 * `showSaveDialog` e só publica o arquivo no `end`.
 */

const fs = require("fs-extra");
const path = require("node:path");
const crypto = require("node:crypto");
const { Transform } = require("node:stream");
const { pipeline, finished } = require("node:stream/promises");
const paths = require("./paths.js");
const storageAccess = require("./storageAccess.js");
const { ensureCollectionSubdirectory, setNewCollectionFileMode } = require("./sharedCollectionDirs.js");

const IMAGE_EXT = ["jpg", "jpeg", "png", "webp", "gif", "bmp", "svg", "heic", "heif"];
const AUDIO_EXT = ["mp3", "wav", "ogg", "flac", "aac", "m4a", "wma", "opus"];
const VIDEO_EXT = ["mp4", "webm", "mkv", "mov", "avi", "m4v"];
const DOC_EXT = ["pdf", "slja"];

/** Teto de um arquivo no disco. O pacote inteiro também é limitado a 5 GB. */
const MAX_BYTES = 5 * 1024 ** 3;
/** Pedaço máximo aceito por IPC. Acima disso é bug (ou tentativa de abuso). */
const MAX_CHUNK_BYTES = 8 * 1024 ** 2;
const MAX_NAME = 180;
/** Orçamento de caminho no Windows (260 - margem para o perfil e o `.part`). */
const MAX_PATH_BUDGET = 220;
const RECORD_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const STAGE_TOKEN_RE = /^[A-Za-z0-9-]{8,64}$/;

const KINDS = {
  media: {
    dir: "media-library",
    exts: new Set([...IMAGE_EXT, ...AUDIO_EXT, ...VIDEO_EXT, ...DOC_EXT]),
  },
  "background-projection": {
    dir: "background-projection",
    exts: new Set([...IMAGE_EXT, ...VIDEO_EXT]),
  },
  "background-sound": {
    dir: "background-sound",
    exts: new Set(AUDIO_EXT),
  },
  "liturgy-files": {
    dir: "liturgy-files",
    exts: new Set([...IMAGE_EXT, ...AUDIO_EXT, ...VIDEO_EXT, ...DOC_EXT]),
  },
};

const MANAGED_DIRS = new Set(Object.values(KINDS).map((kind) => kind.dir));

/** Pastas gerenciadas, para o renderer decidir o que pode apagar. */
function managedRoots() {
  return [...MANAGED_DIRS];
}

/** Nome aceito em Windows, macOS e Linux, sem perder acentos. */
function sanitizeName(name, fallback = "arquivo") {
  const cleaned = String(name || "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "")
    .slice(0, MAX_NAME);
  return cleaned || fallback;
}

/** Caminho relativo dentro das pastas gerenciadas (`<pasta>/<id>/<nome>`). */
function isManagedRel(value) {
  if (typeof value !== "string" || !value || value.includes("\0")) return false;
  const normalized = value.replace(/\\/g, "/");
  if (normalized.startsWith("/") || normalized.includes(":")) return false;
  const parts = normalized.split("/");
  if (parts.length !== 3) return false;
  if (!MANAGED_DIRS.has(parts[0])) return false;
  if (!RECORD_ID_RE.test(parts[1])) return false;
  if (!parts[2] || parts[2] === "." || parts[2] === "..") return false;
  return true;
}

function _inside(abs, dir) {
  const root = path.resolve(dir);
  const target = path.resolve(abs);
  return target === root || target.startsWith(root + path.sep);
}

function _kindOf(kind) {
  const entry = KINDS[kind];
  if (!entry) throw new Error("Tipo de arquivo inválido");
  return entry;
}

function _kindRoot(kind) {
  return path.join(paths.filesDir(), _kindOf(kind).dir);
}

function _extOf(name) {
  return path.extname(String(name || "")).replace(/^\./, "").toLowerCase();
}

function _assertExt(kind, name) {
  const entry = _kindOf(kind);
  const ext = _extOf(name);
  if (!ext || !entry.exts.has(ext)) throw new Error("Extensão não aceita nesta biblioteca");
}

function _assertRecordId(recordId) {
  if (typeof recordId !== "string" || !RECORD_ID_RE.test(recordId)) {
    throw new Error("Identificador de registro inválido");
  }
}

function _assertSize(size) {
  if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_BYTES) {
    throw new Error("Tamanho de arquivo inválido");
  }
}

/**
 * Nome final dentro da pasta do registro, cabendo no orçamento de caminho.
 * O sufixo curto evita colisão quando o nome é truncado.
 */
function _fittedName(kind, recordId, name) {
  const safe = sanitizeName(name);
  const baseDir = path.join(paths.filesDir(), _kindOf(kind).dir, recordId);
  const budget = MAX_PATH_BUDGET - baseDir.length - 1;
  if (budget <= 8) throw new Error("Caminho do acervo longo demais");
  if (safe.length <= budget) return safe;
  const ext = path.extname(safe);
  const suffix = `-${crypto.createHash("sha1").update(safe).digest("hex").slice(0, 6)}`;
  const keep = Math.max(1, budget - ext.length - suffix.length);
  return `${safe.slice(0, keep)}${suffix}${ext}`;
}

function _relFor(kind, recordId, name) {
  _assertRecordId(recordId);
  _assertExt(kind, name);
  return `${_kindOf(kind).dir}/${recordId}/${_fittedName(kind, recordId, name)}`;
}

function _absForRel(rel) {
  if (!isManagedRel(rel)) throw new Error("Caminho fora das pastas gerenciadas");
  const normalized = rel.replace(/\\/g, "/");
  const abs = path.resolve(paths.filesDir(), normalized);
  if (!_inside(abs, paths.filesDir())) throw new Error("Caminho fora do acervo");
  return abs;
}

function _isSharedCollection() {
  return storageAccess.status?.().media?.shared === true;
}

async function _ensureTargetDir(absDir, shared = _isSharedCollection()) {
  if (shared) {
    await ensureCollectionSubdirectory(paths.filesDir(), absDir, { shared: true });
    return;
  }
  await fs.ensureDir(absDir);
}

async function _preparePublishedFile(file, shared = _isSharedCollection()) {
  if (shared) {
    await setNewCollectionFileMode(file, { shared: true });
  }
}

function _stagingDir(restoreToken) {
  if (typeof restoreToken !== "string" || !STAGE_TOKEN_RE.test(restoreToken)) {
    throw new Error("Token de restauração inválido");
  }
  const dir = path.resolve(paths.filesDir(), ".staging", restoreToken);
  if (!_inside(dir, path.join(paths.filesDir(), ".staging"))) {
    throw new Error("Pasta de staging inválida");
  }
  return dir;
}

function _absForStaging(restoreToken, phase, rel) {
  if (phase !== "restore" && phase !== "rollback") throw new Error("Fase de staging inválida");
  if (!isManagedRel(rel)) throw new Error("Caminho fora das pastas gerenciadas");
  const root = _stagingDir(restoreToken);
  const abs = path.resolve(root, phase, rel.replace(/\\/g, "/"));
  if (!_inside(abs, root)) throw new Error("Caminho de staging fora do acervo");
  return abs;
}

function _stagingJournalPath(restoreToken) {
  return path.join(_stagingDir(restoreToken), "journal.json");
}

async function _writeJournalAtomic(restoreToken, payload) {
  const dir = _stagingDir(restoreToken);
  await fs.ensureDir(dir);
  const journalPath = _stagingJournalPath(restoreToken);
  const tmp = `${journalPath}.tmp-${crypto.randomUUID()}`;
  try {
    await fs.writeJson(tmp, payload, { spaces: 0, mode: 0o600 });
    await fs.move(tmp, journalPath, { overwrite: true });
  } catch (error) {
    await _removeTemp(tmp);
    throw error;
  }
}

async function _readJournal(restoreToken) {
  try {
    const data = await fs.readJson(_stagingJournalPath(restoreToken));
    if (
      !data ||
      data.token !== restoreToken ||
      !["committing-files", "committing-db", "committed"].includes(data.status) ||
      !Array.isArray(data.files)
    ) {
      return null;
    }
    const files = data.files.filter(
      (item) => item && typeof item.rel === "string" && isManagedRel(item.rel) && typeof item.existed === "boolean"
    );
    return { token: data.token, status: data.status, files };
  } catch {
    return null;
  }
}

async function _rollbackCommitted(restoreToken, committed) {
  const shared = _isSharedCollection();
  for (let i = committed.length - 1; i >= 0; i--) {
    const item = committed[i];
    if (!item || !isManagedRel(item.rel)) continue;
    const target = _absForRel(item.rel);
    if (item.existed) {
      const rollbackAbs = _absForStaging(restoreToken, "rollback", item.rel);
      if (await fs.pathExists(rollbackAbs)) {
        await _ensureTargetDir(path.dirname(target), shared);
        await _preparePublishedFile(rollbackAbs, shared);
        await fs.move(rollbackAbs, target, { overwrite: true });
      }
    } else {
      await fs.unlink(target).catch(() => {});
      const parent = path.dirname(target);
      const kindRoot = path.join(paths.filesDir(), item.rel.replace(/\\/g, "/").split("/")[0]);
      if (path.dirname(parent) === kindRoot) {
        await fs.rmdir(parent).catch(() => {});
      }
    }
  }
}

function _toBuffer(chunk) {
  if (Buffer.isBuffer(chunk)) return chunk;
  if (chunk instanceof ArrayBuffer) return Buffer.from(chunk);
  if (ArrayBuffer.isView(chunk)) {
    return Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  }
  return null;
}

function _sha256() {
  return crypto.createHash("sha256");
}

/** Escreve aguardando o flush (backpressure real, sem laço de `drain`). */
function _write(stream, buffer) {
  return new Promise((resolve, reject) => {
    stream.write(buffer, (error) => (error ? reject(error) : resolve()));
  });
}

async function _removeTemp(file) {
  await fs.remove(file).catch(() => {});
}

function _registerSenderCleanup(event, abort) {
  const sender = event.sender;
  if (!sender || sender.__libraryFilesCleanup) return;
  sender.__libraryFilesCleanup = true;
  sender.once("destroyed", () => abort());
}

function registerIpc(ipcMain, deps = {}) {
  const dialog = deps.dialog || require("electron").dialog;
  const BrowserWindow = deps.BrowserWindow || require("electron").BrowserWindow;

  /** @type {Map<string, object>} */
  const writeTokens = new Map();
  /** @type {Map<string, object>} */
  const exportTokens = new Map();
  /** @type {Map<string, object>} */
  const readTokens = new Map();

  function abortAll(tokens, senderId) {
    for (const [token, state] of tokens) {
      if (senderId !== undefined && state.senderId !== senderId) continue;
      tokens.delete(token);
      if (state.stream && !state.stream.destroyed) state.stream.destroy();
      if (state.tmp) void _removeTemp(state.tmp);
    }
  }

  function closeAllReads(senderId) {
    for (const [token, state] of readTokens) {
      if (senderId !== undefined && state.senderId !== senderId) continue;
      readTokens.delete(token);
      void state.handle.close().catch(() => {});
    }
  }

  function cleanupSender(event) {
    const senderId = event.sender?.id ?? null;
    _registerSenderCleanup(event, () => {
      abortAll(writeTokens, senderId);
      abortAll(exportTokens, senderId);
      closeAllReads(senderId);
    });
  }

  ipcMain.handle("libraryFiles:storePath", async (_event, input) => {
    const { kind, recordId, sourcePath } = input || {};
    if (typeof sourcePath !== "string" || !path.isAbsolute(sourcePath)) {
      throw new Error("Caminho de origem inválido");
    }
    storageAccess.assertWritable("media");
    const source = await fs.lstat(sourcePath);
    if (source.isSymbolicLink() || !source.isFile()) throw new Error("Origem inválida");
    _assertSize(source.size);

    const rel = _relFor(kind, recordId, path.basename(sourcePath));
    const abs = _absForRel(rel);
    const shared = _isSharedCollection();
    await _ensureTargetDir(path.dirname(abs), shared);
    const tmp = `${abs}.part-${crypto.randomUUID()}`;
    const hash = _sha256();
    let copied = 0;
    const hasher = new Transform({
      transform(chunk, _encoding, callback) {
        hash.update(chunk);
        copied += chunk.length;
        callback(null, chunk);
      },
    });
    try {
      await pipeline(
        fs.createReadStream(sourcePath),
        hasher,
        fs.createWriteStream(tmp, { flags: "wx", mode: 0o600, fsync: true })
      );
      await _preparePublishedFile(tmp, shared);
      await fs.move(tmp, abs, { overwrite: true });
    } catch (error) {
      await _removeTemp(tmp);
      throw error;
    }
    return { path: rel, name: path.basename(rel), size: copied, sha256: hash.digest("hex") };
  });

  async function openWriteSession(event, { kind = null, rel, abs, size }) {
    if (kind) {
      await _ensureTargetDir(path.dirname(abs));
    } else {
      await fs.ensureDir(path.dirname(abs));
    }
    const token = crypto.randomUUID();
    const tmp = `${abs}.part-${token}`;
    const stream = fs.createWriteStream(tmp, { flags: "wx", mode: 0o600, fsync: true });
    try {
      await new Promise((resolve, reject) => {
        stream.once("open", resolve);
        stream.once("error", reject);
      });
    } catch (error) {
      stream.destroy();
      await _removeTemp(tmp);
      throw error;
    }
    writeTokens.set(token, {
      senderId: event.sender?.id ?? null,
      kind,
      rel,
      abs,
      tmp,
      stream,
      hash: _sha256(),
      written: 0,
      size,
    });
    cleanupSender(event);
    return { token };
  }

  ipcMain.handle("libraryFiles:begin", async (event, input) => {
    const { kind, recordId, name, size } = input || {};
    storageAccess.assertWritable("media");
    _assertSize(size);
    const rel = _relFor(kind, recordId, name);
    const abs = _absForRel(rel);
    return openWriteSession(event, { kind, rel, abs, size });
  });

  ipcMain.handle("libraryFiles:stageBegin", async (event, input) => {
    const { restoreToken, rel, size } = input || {};
    storageAccess.assertWritable("media");
    if (!Number.isSafeInteger(size) || size < 0 || size > MAX_BYTES) {
      throw new Error("Tamanho de arquivo inválido");
    }
    _absForRel(rel);
    const normalizedRel = rel.replace(/\\/g, "/");
    const abs = _absForStaging(restoreToken, "restore", normalizedRel);
    return openWriteSession(event, { rel: normalizedRel, abs, size });
  });

  ipcMain.handle("libraryFiles:write", async (event, token, chunk) => {
    const state = writeTokens.get(token);
    if (!state || state.senderId !== (event.sender?.id ?? null)) {
      throw new Error("Sessão de escrita inválida");
    }
    const buffer = _toBuffer(chunk);
    if (!buffer) throw new Error("Pedaço inválido");
    if (buffer.length > MAX_CHUNK_BYTES) throw new Error("Pedaço grande demais");
    if (state.written + buffer.length > state.size) {
      writeTokens.delete(token);
      if (!state.stream.destroyed) state.stream.destroy();
      await _removeTemp(state.tmp);
      throw new Error("Arquivo maior que o declarado");
    }
    await _write(state.stream, buffer);
    state.hash.update(buffer);
    state.written += buffer.length;
    return { written: state.written };
  });

  ipcMain.handle("libraryFiles:end", async (event, token) => {
    const state = writeTokens.get(token);
    if (!state || state.senderId !== (event.sender?.id ?? null)) {
      throw new Error("Sessão de escrita inválida");
    }
    writeTokens.delete(token);
    if (state.written !== state.size) {
      if (!state.stream.destroyed) state.stream.destroy();
      await _removeTemp(state.tmp);
      throw new Error("Arquivo incompleto");
    }
    try {
      state.stream.end();
      await finished(state.stream);
      if (state.kind) {
        await _preparePublishedFile(state.tmp);
      }
      await fs.move(state.tmp, state.abs, { overwrite: true });
    } catch (error) {
      await _removeTemp(state.tmp);
      throw error;
    }
    return {
      path: state.rel,
      name: path.basename(state.rel),
      size: state.written,
      sha256: state.hash.digest("hex"),
    };
  });

  ipcMain.handle("libraryFiles:abort", async (event, token) => {
    const state = writeTokens.get(token);
    if (!state || state.senderId !== (event.sender?.id ?? null)) return { ok: true };
    writeTokens.delete(token);
    if (!state.stream.destroyed) state.stream.destroy();
    await _removeTemp(state.tmp);
    return { ok: true };
  });

  ipcMain.handle("libraryFiles:remove", async (_event, rel) => {
    storageAccess.assertWritable("media");
    const abs = _absForRel(rel);
    let stat;
    try {
      stat = await fs.lstat(abs);
    } catch (error) {
      if (error.code === "ENOENT") return { removed: false };
      throw error;
    }
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("Caminho inválido");
    await fs.unlink(abs);
    // A pasta do registro só sai se ficou vazia — e só ela, nunca o acervo.
    const parent = path.dirname(abs);
    const kindRoot = path.join(paths.filesDir(), rel.replace(/\\/g, "/").split("/")[0]);
    if (path.dirname(parent) === kindRoot) {
      await fs.rmdir(parent).catch(() => {});
    }
    return { removed: true };
  });

  ipcMain.handle("libraryFiles:info", async (_event, rel) => {
    const abs = _absForRel(rel);
    try {
      const stat = await fs.lstat(abs);
      if (stat.isSymbolicLink() || !stat.isFile()) return { exists: false, size: 0 };
      return { exists: true, size: stat.size, mtimeMs: stat.mtimeMs };
    } catch (error) {
      if (error.code === "ENOENT") return { exists: false, size: 0 };
      throw error;
    }
  });

  ipcMain.handle("libraryFiles:freeSpace", async () => {
    try {
      const stat = await fs.statfs(paths.filesDir());
      return { bytes: Number(stat.bsize) * Number(stat.bavail) };
    } catch {
      return { bytes: null };
    }
  });

  /**
   * Remove arquivos que não têm mais registro. Só toca no que está dentro das
   * pastas gerenciadas, tem mais de `minAgeMs` e não aparece em `knownPaths`.
   */
  ipcMain.handle("libraryFiles:prune", async (_event, knownPaths, options) => {
    storageAccess.assertWritable("media");
    const known = new Set(
      (Array.isArray(knownPaths) ? knownPaths : []).filter((value) => isManagedRel(value))
    );
    const minAgeMs = Number(options?.minAgeMs) || 24 * 60 * 60 * 1000;
    const now = Date.now();
    let removed = 0;
    for (const kind of Object.keys(KINDS)) {
      const root = _kindRoot(kind);
      let entries;
      try {
        entries = await fs.readdir(root, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.isDirectory() || !RECORD_ID_RE.test(entry.name)) continue;
        const dir = path.join(root, entry.name);
        let files;
        try {
          files = await fs.readdir(dir, { withFileTypes: true });
        } catch {
          continue;
        }
        for (const file of files) {
          const rel = `${kind}/${entry.name}/${file.name}`;
          if (known.has(rel)) continue;
          const abs = path.join(dir, file.name);
          let stat;
          try {
            stat = await fs.lstat(abs);
          } catch {
            continue;
          }
          if (stat.isSymbolicLink() || !stat.isFile()) continue;
          if (now - stat.mtimeMs < minAgeMs) continue;
          await fs.unlink(abs).catch(() => {});
          removed += 1;
        }
        await fs.rmdir(dir).catch(() => {});
      }
    }
    return { removed };
  });

  ipcMain.handle("libraryExport:choose", async (event, input) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const backup = input?.kind === "backup";
    const suggested = sanitizeName(
      input?.suggestedName || (backup ? "louvorja-backup.zip" : "liturgia.llja"),
      backup ? "louvorja-backup.zip" : "liturgia.llja"
    );
    const result = await dialog.showSaveDialog(win, {
      title: backup ? "Salvar backup do banco" : "Exportar liturgia",
      defaultPath: path.join(require("electron").app.getPath("downloads"), suggested),
      filters: backup
        ? [
            { name: "Backup do LouvorJA", extensions: ["zip"] },
            { name: "Todos os arquivos", extensions: ["*"] },
          ]
        : [
            { name: "Pacote da liturgia", extensions: ["llja"] },
            { name: "Todos os arquivos", extensions: ["*"] },
          ],
    });
    if (result.canceled || !result.filePath) return null;
    const token = crypto.randomUUID();
    const filePath = result.filePath;
    const tmp = `${filePath}.part-${token}`;
    await fs.ensureDir(path.dirname(filePath));
    const stream = fs.createWriteStream(tmp, { flags: "wx", mode: 0o600, fsync: true });
    try {
      await new Promise((resolve, reject) => {
        stream.once("open", resolve);
        stream.once("error", reject);
      });
    } catch (error) {
      stream.destroy();
      await _removeTemp(tmp);
      throw error;
    }
    exportTokens.set(token, {
      senderId: event.sender?.id ?? null,
      filePath,
      tmp,
      stream,
      written: 0,
    });
    cleanupSender(event);
    return { token };
  });

  ipcMain.handle("libraryFiles:openRead", async (event, rel) => {
    const abs = _absForRel(rel);
    let stat;
    try {
      stat = await fs.lstat(abs);
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("Caminho inválido");
    const handle = await fs.promises.open(abs, "r");
    const token = crypto.randomUUID();
    readTokens.set(token, {
      senderId: event.sender?.id ?? null,
      handle,
      size: stat.size,
      offset: 0,
    });
    cleanupSender(event);
    return { token, size: stat.size, mtimeMs: stat.mtimeMs };
  });

  ipcMain.handle("libraryFiles:readChunk", async (event, token, length) => {
    const state = readTokens.get(token);
    if (!state || state.senderId !== (event.sender?.id ?? null)) {
      throw new Error("Sessão de leitura inválida");
    }
    const requested = Math.trunc(Number(length) || 2 * 1024 * 1024);
    const size = Math.min(MAX_CHUNK_BYTES, Math.max(1, requested));
    const buf = Buffer.allocUnsafe(size);
    try {
      const { bytesRead } = await state.handle.read(buf, 0, size, state.offset);
      state.offset += bytesRead;
      if (bytesRead === 0) {
        readTokens.delete(token);
        await state.handle.close().catch(() => {});
        return null;
      }
      return new Uint8Array(buf.buffer, buf.byteOffset, bytesRead);
    } catch (error) {
      readTokens.delete(token);
      await state.handle.close().catch(() => {});
      throw error;
    }
  });

  ipcMain.handle("libraryFiles:closeRead", async (event, token) => {
    const state = readTokens.get(token);
    if (!state || state.senderId !== (event.sender?.id ?? null)) return { ok: true };
    readTokens.delete(token);
    await state.handle.close().catch(() => {});
    return { ok: true };
  });

  ipcMain.handle("libraryFiles:commitRestore", async (_event, restoreToken, rels) => {
    storageAccess.assertWritable("media");
    _stagingDir(restoreToken);
    const list = Array.isArray(rels) ? rels : [];
    const planned = [];
    for (const rel of list) {
      if (!isManagedRel(rel)) throw new Error("Caminho inválido na restauração");
      const normalizedRel = rel.replace(/\\/g, "/");
      const stagedAbs = _absForStaging(restoreToken, "restore", normalizedRel);
      let stagedStat;
      try {
        stagedStat = await fs.lstat(stagedAbs);
      } catch (error) {
        if (error.code === "ENOENT") continue;
        throw error;
      }
      if (stagedStat.isSymbolicLink() || !stagedStat.isFile()) {
        throw new Error("Arquivo de staging inválido");
      }
      const targetAbs = _absForRel(normalizedRel);
      let existed = false;
      try {
        const targetStat = await fs.lstat(targetAbs);
        if (targetStat.isSymbolicLink() || !targetStat.isFile()) {
          throw new Error("Destino inválido na restauração");
        }
        existed = true;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      planned.push({ rel: normalizedRel, existed, stagedAbs, targetAbs });
    }

    const journalFiles = planned.map(({ rel, existed }) => ({ rel, existed }));
    if (planned.length) {
      await _writeJournalAtomic(restoreToken, {
        token: restoreToken,
        status: "committing-files",
        files: journalFiles,
      });
    }

    const committed = [];
    try {
      const shared = _isSharedCollection();
      for (const item of planned) {
        if (item.existed) {
          const rollbackAbs = _absForStaging(restoreToken, "rollback", item.rel);
          await fs.ensureDir(path.dirname(rollbackAbs));
          await fs.move(item.targetAbs, rollbackAbs, { overwrite: true });
        }
        committed.push({ rel: item.rel, existed: item.existed });
        await _ensureTargetDir(path.dirname(item.targetAbs), shared);
        await _preparePublishedFile(item.stagedAbs, shared);
        await fs.move(item.stagedAbs, item.targetAbs, { overwrite: true });
      }
      if (planned.length) {
        await _writeJournalAtomic(restoreToken, {
          token: restoreToken,
          status: "committing-db",
          files: journalFiles,
        });
      }
    } catch (error) {
      await _rollbackCommitted(restoreToken, committed).catch(() => {});
      await fs.remove(_stagingDir(restoreToken)).catch(() => {});
      throw error;
    }
    return { committed };
  });

  ipcMain.handle("libraryFiles:rollbackRestore", async (_event, restoreToken, committed) => {
    storageAccess.assertWritable("media");
    const explicitList = Array.isArray(committed) && committed.length > 0 ? committed : null;
    const journal = explicitList ? null : await _readJournal(restoreToken);
    const list = explicitList || journal?.files || [];
    await _rollbackCommitted(restoreToken, list);
    await fs.remove(_stagingDir(restoreToken)).catch(() => {});
    return { ok: true };
  });

  ipcMain.handle("libraryFiles:markRestoreCommitted", async (_event, restoreToken) => {
    storageAccess.assertWritable("media");
    const journal = await _readJournal(restoreToken);
    if (!journal) return { ok: false };
    await _writeJournalAtomic(restoreToken, { ...journal, status: "committed" });
    return { ok: true };
  });

  ipcMain.handle("libraryFiles:listPendingRestores", async () => {
    try {
      storageAccess.assertWritable("media");
    } catch {
      return [];
    }
    const stagingRoot = path.join(paths.filesDir(), ".staging");
    let entries;
    try {
      entries = await fs.readdir(stagingRoot, { withFileTypes: true });
    } catch {
      return [];
    }
    const out = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !STAGE_TOKEN_RE.test(entry.name)) continue;
      const journal = await _readJournal(entry.name);
      out.push({ token: entry.name, journal });
    }
    return out;
  });

  ipcMain.handle("libraryFiles:cleanupRestore", async (_event, restoreToken) => {
    await fs.remove(_stagingDir(restoreToken)).catch(() => {});
    return { ok: true };
  });

  ipcMain.handle("libraryExport:write", async (event, token, chunk) => {
    const state = exportTokens.get(token);
    if (!state || state.senderId !== (event.sender?.id ?? null)) {
      throw new Error("Sessão de exportação inválida");
    }
    const buffer = _toBuffer(chunk);
    if (!buffer) throw new Error("Pedaço inválido");
    if (buffer.length > MAX_CHUNK_BYTES) throw new Error("Pedaço grande demais");
    await _write(state.stream, buffer);
    state.written += buffer.length;
    return { written: state.written };
  });

  ipcMain.handle("libraryExport:end", async (event, token) => {
    const state = exportTokens.get(token);
    if (!state || state.senderId !== (event.sender?.id ?? null)) {
      throw new Error("Sessão de exportação inválida");
    }
    exportTokens.delete(token);
    try {
      state.stream.end();
      await finished(state.stream);
      await fs.move(state.tmp, state.filePath, { overwrite: true });
    } catch (error) {
      await _removeTemp(state.tmp);
      throw error;
    }
    return { path: state.filePath, size: state.written };
  });

  ipcMain.handle("libraryExport:abort", async (event, token) => {
    const state = exportTokens.get(token);
    if (!state || state.senderId !== (event.sender?.id ?? null)) return { ok: true };
    exportTokens.delete(token);
    if (!state.stream.destroyed) state.stream.destroy();
    await _removeTemp(state.tmp);
    return { ok: true };
  });
}

module.exports = {
  registerIpc,
  sanitizeName,
  isManagedRel,
  managedRoots,
  KINDS,
  MAX_BYTES,
  MAX_CHUNK_BYTES,
};
