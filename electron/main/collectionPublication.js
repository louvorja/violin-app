"use strict";

const fs = require("fs-extra");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { pipeline } = require("node:stream/promises");
const { setNewCollectionFileMode } = require("./sharedCollectionDirs.js");

async function assertDestination(root, local, temporary) {
  const actualRoot = await fs.realpath(root);
  const parent = await fs.realpath(path.dirname(local));
  const relative = path.relative(actualRoot, parent);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Destino fora da pasta de arquivos");
  }
  for (const target of [local, temporary]) {
    try {
      if (!(await fs.lstat(target)).isFile()) throw new Error("Arquivo de publicação inválido");
    } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
}

/** Publica somente um temporário completo pertencente ao chamador; consome esse temporário. */
async function publishCollectionFile(tmp, local, { root = path.dirname(local), shared = false,
  platform = process.platform, cancelled = () => false, assertCanPublish = () => {}, overwrite = true } = {}) {
  const assertActive = () => {
    if (cancelled()) throw new Error("cancelled");
    assertCanPublish();
  };
  const check = async (temporary) => {
    assertActive();
    await assertDestination(root, local, temporary);
    assertActive();
    if (!overwrite && await fs.pathExists(local)) throw Object.assign(new Error("destination-exists"), { code: "EEXIST" });
    assertActive();
  };
  await check(tmp);
  await setNewCollectionFileMode(tmp, { shared, platform });
  assertActive();
  if (platform !== "win32") {
    try { await fs.rename(tmp, local); return; }
    catch (error) { if (error.code !== "EXDEV") throw error; }
  }
  // Windows: rename carregaria a ACL privada. Entre volumes, rename também
  // não existe. Só a publicação cria um arquivo transitório no destino;
  // downloads, checkpoints e streaming continuam no perfil privado.
  const publishing = path.join(path.dirname(local), `.lj-download-${randomUUID()}.publishing`);
  let created = false;
  try {
    await check(publishing);
    if (platform === "win32") {
      // Copie apenas bytes para um arquivo novo, que herda a ACL do destino.
      const fd = await fs.open(publishing, "wx", 0o666);
      created = true;
      try { assertActive(); }
      catch (error) { await fs.close(fd); throw error; }
      await pipeline(fs.createReadStream(tmp), fs.createWriteStream(publishing, { fd }));
    } else {
      try { await fs.copyFile(tmp, publishing, fs.constants.COPYFILE_EXCL); created = true; }
      catch (error) {
        if (error.code !== "EEXIST") await fs.remove(publishing);
        throw error;
      }
      assertActive();
      await setNewCollectionFileMode(publishing, { shared, platform });
    }
    await check(publishing);
    await fs.rename(publishing, local);
    // A publicação já ocorreu. Uma falha na limpeza não pode esconder a autoria
    // do arquivo final do chamador, que ainda precisa tratar um cancelamento.
    await fs.remove(tmp).catch(() => {});
  } finally { if (created) await fs.remove(publishing).catch(() => {}); }
}

module.exports = { publishCollectionFile };
