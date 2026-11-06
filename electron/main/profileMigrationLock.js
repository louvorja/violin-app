"use strict";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { randomUUID } = require("node:crypto");

// A cópia usa chamadas síncronas no worker: um heartbeat por timer não serviria
// para distinguir uma migração lenta de um processo morto. Só um PID local
// comprovadamente encerrado permite recuperar um lock deixado por uma queda.
function acquireProfileMigrationLock(bootstrap) {
  const dir = path.join(bootstrap, ".profile-migration.lock");
  const file = path.join(dir, "owner.json");
  const busy = () => new Error("Outra migração de perfil ainda está em andamento. Aguarde seu encerramento e tente novamente.");
  fs.mkdirSync(bootstrap, { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < 2; attempt++) {
    try { fs.mkdirSync(dir, { mode: 0o700 }); }
    catch (error) {
      if (error.code !== "EEXIST") throw error;
      const stat = fs.lstatSync(dir);
      if (!stat.isDirectory()) throw busy();
      let raw, owner;
      try {
        if (!fs.lstatSync(file).isFile()) throw busy();
        raw = fs.readFileSync(file, "utf8"); owner = JSON.parse(raw);
      } catch { throw busy(); }
      if (owner.hostname !== os.hostname() || !Number.isInteger(owner.pid) || owner.pid < 1 || owner.pid > 2147483647) throw busy();
      try { process.kill(owner.pid, 0); throw busy(); }
      catch (error) { if (error.code !== "ESRCH") throw busy(); }
      // Não recupere um diretório que foi substituído durante a inspeção.
      const now = fs.lstatSync(dir);
      if (now.dev !== stat.dev || now.ino !== stat.ino
        || fs.readFileSync(file, "utf8") !== raw) throw busy();
      fs.unlinkSync(file);
      fs.rmdirSync(dir);
      continue;
    }
    const raw = JSON.stringify({ pid: process.pid, hostname: os.hostname(), nonce: randomUUID() });
    try { fs.writeFileSync(file, raw, { flag: "wx", mode: 0o600 }); }
    catch (error) { try { fs.rmdirSync(dir); } catch { /* Não remover conteúdo desconhecido. */ } throw error; }
    const identity = fs.lstatSync(dir);
    return () => {
      try {
        const now = fs.lstatSync(dir);
        if (!now.isDirectory() || now.dev !== identity.dev || now.ino !== identity.ino
          || !fs.lstatSync(file).isFile() || fs.readFileSync(file, "utf8") !== raw) return;
        fs.unlinkSync(file);
        fs.rmdirSync(dir);
      } catch { /* O lock preservado será reavaliado pelo próximo processo. */ }
    };
  }
  throw busy();
}

module.exports = { acquireProfileMigrationLock };
