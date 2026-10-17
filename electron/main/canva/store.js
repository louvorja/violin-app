"use strict";

/**
 * store.js — Onde os segredos do Canva moram.
 *
 * Arquivo próprio do `userStore` (`storage/canva_secrets.json`), fora do
 * `user_data`: o renderer sincroniza `user_data` entre janelas e não tem por
 * que receber nem o ciphertext. O payload é o do `crypto.js`.
 *
 * Forma em disco (para quem abrir o JSON): `{ "v": 1, "enc": "aes-256-gcm",
 * "payload": "v1:...:...:..." }` — nenhuma linha em texto claro.
 */

const userStore = require("../userStore.js");
const box = require("./crypto.js");

const STORE_KEY = "canva_secrets";
const ENC = "aes-256-gcm";

/**
 * Lê e decifra o cofre inteiro.
 * @returns {{clientId?: string, clientSecret?: string,
 *            token?: {access_token?: string, refresh_token?: string,
 *                     expires_at?: number, token_type?: string, scope?: string}} | null}
 */
function readAll() {
  let file;
  try {
    file = userStore.read(STORE_KEY);
  } catch (_) {
    return null;
  }
  if (!file || file.v !== 1 || file.enc !== ENC || typeof file.payload !== "string") return null;
  try {
    return box.decrypt(file.payload);
  } catch (_) {
    return null;
  }
}

/** Grava o cofre inteiro, cifrado. Rejeita se a chave do cofre estiver inutilizável. */
function writeAll(data) {
  const payload = box.encrypt(data || {});
  return userStore.write(STORE_KEY, { v: 1, enc: ENC, payload });
}

function getCredentials() {
  const data = readAll() || {};
  if (typeof data.clientId !== "string" || typeof data.clientSecret !== "string") return null;
  if (!data.clientId || !data.clientSecret) return null;
  return { clientId: data.clientId, clientSecret: data.clientSecret };
}

/** Substitui as credenciais preservando o token já emitido. */
function setCredentials(clientId, clientSecret) {
  const data = readAll() || {};
  data.clientId = clientId;
  data.clientSecret = clientSecret;
  return writeAll(data);
}

function getToken() {
  const data = readAll() || {};
  return data.token && typeof data.token === "object" ? data.token : null;
}

function setToken(token) {
  const data = readAll() || {};
  data.token = token;
  return writeAll(data);
}

/**
 * Diagnóstico do cofre sem vazar conteúdo: existe arquivo e ele decifra?
 *
 * Distingue "nunca conectou" de "chave trocada / arquivo alterado" — a segunda
 * situação pede reconexão, não some da tela.
 */
function integrity() {
  let file;
  try {
    file = userStore.read(STORE_KEY);
  } catch (_) {
    return { present: false, readable: false };
  }
  if (!file) return { present: false, readable: true };

  let readable = false;
  try {
    readable = box.decrypt(file.payload) !== null;
  } catch (_) {
    readable = false;
  }
  return { present: true, readable };
}

/** Apaga credenciais e token — o `disconnect` que chama. */
function clear() {
  return userStore.remove(STORE_KEY);
}

module.exports = {
  STORE_KEY,
  readAll,
  writeAll,
  integrity,
  getCredentials,
  setCredentials,
  getToken,
  setToken,
  clear,
};
