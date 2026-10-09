"use strict";

/**
 * crypto.js — Cofre do Canva (AES-256-GCM).
 *
 * Client Secret e token NUNCA ficam em texto claro no disco e NUNCA voltam ao
 * renderer: o main cifra na gravação e só descriptografa em memória para montar
 * o `Authorization: Basic` e o corpo do refresh.
 *
 * A chave é aleatória (32 bytes), gerada na primeira gravação e guardada num
 * arquivo próprio ao lado dos dados — permissão 0600 no POSIX. Isso protege
 * contra leitura casual (backup compartilhado, cópia de `user_data`, log mal
 * feito), não contra quem já tem escrita na pasta inteira; o cofre do SO
 * (`safeStorage`) daria essa proteção extra, mas foi descartado de propósito
 * para não depender de keychain/DPAPI.
 *
 * O GCM autentica: um payload alterado (ou chave trocada) falha na tag e vira
 * `null` em vez de texto corrompido — nunca é repassado ao Canva.
 */

const crypto = require("crypto");
const fs = require("fs-extra");
const path = require("path");
const paths = require("../paths.js");

/** Formato do payload: `v1:<iv base64>:<tag base64>:<dados base64>`. */
const VERSION = 1;
const KEY_BYTES = 32;

let _key = null;

function keyFile() {
  return path.join(paths.dataDir(), "storage", "canva.key");
}

/** Chave de 32 bytes hex — lê a existente, senão cria com permissão 0600. */
function _loadKey() {
  if (_key) return _key;
  const file = keyFile();
  fs.ensureDirSync(path.dirname(file));

  if (fs.existsSync(file)) {
    const hex = fs.readFileSync(file, "utf8").trim();
    if (/^[0-9a-f]{64}$/i.test(hex)) {
      _key = Buffer.from(hex, "hex");
      return _key;
    }
    /*
     * Conteúdo ilegível (gravação truncada, arquivo trocado): o ciphertext
     * já não decifra de qualquer forma, então regenerar não perde nada. Sem
     * isto o usuário entrava num beco sem saída — o app pedia para regravar as
     * credenciais e a gravação falhava para sempre na mesma chave ruim.
     */
    console.warn("[canva] Chave do cofre ilegível; regenerando e pedindo reconexão.");
  }

  _key = crypto.randomBytes(KEY_BYTES);
  fs.writeFileSync(file, _key.toString("hex"), { mode: 0o600 });
  return _key;
}

/**
 * Cifra um objeto. O retorno é uma string única, sem caractere fora do
 * alfabeto base64 e de `:`, para caber num arquivo JSON sem escape.
 * @param {unknown} value
 * @returns {string}
 */
function encrypt(value) {
  const key = _loadKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const json = Buffer.from(JSON.stringify(value ?? null), "utf8");
  const data = Buffer.concat([cipher.update(json), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    `v${VERSION}`,
    iv.toString("base64"),
    tag.toString("base64"),
    data.toString("base64"),
  ].join(":");
}

/**
 * Decifra um payload de `encrypt`.
 *
 * Qualquer coisa fora do formato — chave perdida, texto alterado, versão
 * antiga — devolve `null`: quem chama trata como "sem cofre" e pede para
 * reconectar, em vez de mandar lixo ao Canva.
 * @param {unknown} payload
 * @returns {Record<string, unknown> | null}
 */
function decrypt(payload) {
  if (typeof payload !== "string") return null;
  const parts = payload.split(":");
  if (parts.length !== 4 || parts[0] !== `v${VERSION}`) return null;

  try {
    const key = _loadKey();
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(parts[1], "base64")
    );
    decipher.setAuthTag(Buffer.from(parts[2], "base64"));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(parts[3], "base64")),
      decipher.final(),
    ]);
    const parsed = JSON.parse(plain.toString("utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch (_) {
    return null;
  }
}

/** Só para diagnóstico — nunca o conteúdo. */
function status() {
  return { keyFile: keyFile(), keyPresent: fs.existsSync(keyFile()) };
}

/** Testes: descarta a chave em memória para o próximo caso recriar a própria. */
function _reset() {
  _key = null;
}

module.exports = { encrypt, decrypt, keyFile, status, _reset, VERSION };
