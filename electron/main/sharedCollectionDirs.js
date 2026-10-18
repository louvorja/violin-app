"use strict";

const fs = require("fs-extra");
const path = require("node:path");

function directoryError(dir) {
  return new Error(`Diretório de destino inválido: ${dir}`);
}

// Só muda a permissão de um objeto que o chamador acabou de criar. Abrir sem
// seguir links também impede que chmod atravesse um link trocado no caminho.
function setNewModeSync(file, mode, directory = false) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const stat = fs.fstatSync(fd);
    if (directory ? !stat.isDirectory() : (!stat.isFile() || stat.nlink !== 1)) {
      throw new Error("O item recém-criado do acervo não é regular.");
    }
    fs.fchmodSync(fd, mode);
  } finally { fs.closeSync(fd); }
}

async function setNewMode(file, mode, directory = false) {
  const fd = await fs.open(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const stat = await fs.fstat(fd);
    if (directory ? !stat.isDirectory() : (!stat.isFile() || stat.nlink !== 1)) {
      throw new Error("O item recém-criado do acervo não é regular.");
    }
    await fs.fchmod(fd, mode);
  } finally { await fs.close(fd); }
}

/** Cria somente componentes ausentes; nunca amplia permissões de pastas existentes. */
function ensureCollectionDirectorySync(dir, { shared = false, platform = process.platform } = {}) {
  try {
    if (!fs.lstatSync(dir).isDirectory()) throw directoryError(dir);
    return;
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  const parent = path.dirname(dir);
  if (parent === dir) throw directoryError(dir);
  ensureCollectionDirectorySync(parent, { shared, platform });
  try { fs.mkdirSync(dir, { mode: 0o777 }); }
  catch (error) {
    if (error.code !== "EEXIST" || !fs.lstatSync(dir).isDirectory()) throw error;
    return; // Outra instância criou: não somos donos desta criação.
  }
  // umask só afeta a criação. Não altere o umask global, que protege o perfil.
  if (shared && platform !== "win32") setNewModeSync(dir, 0o777, true);
}

async function ensureCollectionDirectory(dir, { shared = false, platform = process.platform } = {}) {
  try {
    if (!(await fs.lstat(dir)).isDirectory()) throw directoryError(dir);
    return;
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  const parent = path.dirname(dir);
  if (parent === dir) throw directoryError(dir);
  await ensureCollectionDirectory(parent, { shared, platform });
  try { await fs.mkdir(dir, { mode: 0o777 }); }
  catch (error) {
    if (error.code !== "EEXIST" || !(await fs.lstat(dir)).isDirectory()) throw error;
    return;
  }
  if (shared && platform !== "win32") await setNewMode(dir, 0o777, true);
}

/** Somente arquivos novos do acervo; jamais chamar para arquivos do perfil ou já publicados. */
function setNewCollectionFileModeSync(file, { shared = false, platform = process.platform } = {}) {
  if (shared && platform !== "win32") setNewModeSync(file, 0o644);
}
async function setNewCollectionFileMode(file, { shared = false, platform = process.platform } = {}) {
  if (shared && platform !== "win32") await setNewMode(file, 0o644);
}

/** Confere cada ancestral sob a raiz antes de criar uma subpasta do acervo. */
async function ensureCollectionSubdirectory(root, dir, options = {}) {
  const relative = path.relative(root, dir);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Destino fora da pasta de arquivos");
  }
  await ensureCollectionDirectory(root, options);
  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    await ensureCollectionDirectory(current, options);
  }
}

module.exports = { ensureCollectionDirectory, ensureCollectionDirectorySync,
  setNewCollectionFileMode, setNewCollectionFileModeSync, ensureCollectionSubdirectory };
