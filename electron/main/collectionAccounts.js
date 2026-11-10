"use strict";

/**
 * Quem usa o acervo. Cada conta do computador assina a pasta ao abrir o app, e
 * antes de apagar músicas o app sabe se outra conta também as perderia.
 *
 * "Compartilhado" só diz onde a pasta fica: toda instalação nova nasce numa pasta
 * comum, mesmo no PC da igreja com uma conta só. Lá, sem outra assinatura, o
 * acervo se comporta como privado.
 *
 * A pasta é gravável por todas as contas: o conteúdo de uma assinatura é dado de
 * outra conta, lido com limite de tamanho e nunca interpretado como caminho.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { ensureCollectionDirectorySync, setNewCollectionFileModeSync } = require("./sharedCollectionDirs.js");

const DIR = ".louvorja-contas";
const DAY_MS = 86_400_000;
/** Conta que não abre o app há mais tempo que isso não segura o aviso. */
const RECENT_DAYS = 90;
/**
 * Contas que ainda não abriram uma versão que assina não aparecem. Durante este
 * prazo, contado da primeira assinatura na pasta, a pasta compartilhada só com a
 * nossa assinatura ainda leva o aviso genérico.
 */
const SETTLE_DAYS = 30;
const MAX_SIGNATURE_BYTES = 4096;
const FILE_RE = /^[0-9a-f]{16}\.json$/;

function accountId(user = os.userInfo(), home = os.homedir()) {
  return crypto.createHash("sha256").update(`${user.username}\0${home}`).digest("hex").slice(0, 16);
}

function readSignature(file) {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.size > MAX_SIGNATURE_BYTES) return null;
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!value || value.version !== 1) return null;
    const firstSeen = Date.parse(value.firstSeen);
    const lastSeen = Date.parse(value.lastSeen);
    if (!Number.isFinite(firstSeen) || !Number.isFinite(lastSeen)) return null;
    const name = String(value.name ?? "").replace(/\p{Cc}/gu, "").trim().slice(0, 64);
    return { name, firstSeen, lastSeen };
  } catch {
    return null;
  }
}

/**
 * Registra esta conta na pasta. Falhar aqui nunca impede a abertura. Não cria o
 * acervo: antes do primeiro uso o operador ainda pode escolher outra pasta.
 */
function sign(root, { shared = false, now = Date.now(), user = os.userInfo(), home = os.homedir() } = {}) {
  if (!fs.statSync(root).isDirectory()) throw new Error("O acervo não é uma pasta.");
  const dir = path.join(root, DIR);
  ensureCollectionDirectorySync(dir, { shared });
  const file = path.join(dir, `${accountId(user, home)}.json`);
  const previous = readSignature(file);
  const value = {
    version: 1,
    name: user.username,
    firstSeen: new Date(previous?.firstSeen ?? now).toISOString(),
    lastSeen: new Date(now).toISOString(),
  };
  const temporary = path.join(dir, `.${crypto.randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, JSON.stringify(value), { flag: "wx", mode: 0o644 });
    setNewCollectionFileModeSync(temporary, { shared });
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

/**
 * Outras contas que usaram a pasta nos últimos 90 dias. `known` é falso quando
 * esta conta não conseguiu assinar ou ler; `settled`, quando a assinatura já tem
 * idade para confiar que uma pasta sem outras contas é mesmo só desta.
 */
function usage(root, { now = Date.now(), user = os.userInfo(), home = os.homedir() } = {}) {
  const own = `${accountId(user, home)}.json`;
  let names;
  try {
    names = fs.readdirSync(path.join(root, DIR)).filter((name) => FILE_RE.test(name));
  } catch {
    return { known: false, settled: false, others: [] };
  }
  let signed = false;
  let oldest = Infinity;
  const others = [];
  for (const name of names) {
    const signature = readSignature(path.join(root, DIR, name));
    if (!signature) continue;
    oldest = Math.min(oldest, signature.firstSeen);
    if (name === own) {
      signed = true;
      continue;
    }
    if (now - signature.lastSeen <= RECENT_DAYS * DAY_MS) {
      others.push({ name: signature.name, lastSeen: new Date(signature.lastSeen).toISOString() });
    }
  }
  others.sort((a, b) => Date.parse(b.lastSeen) - Date.parse(a.lastSeen));
  return { known: signed, settled: signed && now - oldest >= SETTLE_DAYS * DAY_MS, others };
}

module.exports = { sign, usage, accountId, DIR, RECENT_DAYS, SETTLE_DAYS };
