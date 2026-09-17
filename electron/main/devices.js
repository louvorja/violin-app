"use strict";

/**
 * Gerenciamento de dispositivos autorizados.
 *
 * Devices são persistidos em `userStore` (arquivo devices.json) e
 * mantidos em memória para acesso síncrono pelo auth middleware.
 *
 * Cada device tem dois identificadores:
 *  - `id`: UUID criado pelo desktop (índice da tabela)
 *  - `token`: UUID gerado para o QR code (credencial de acesso)
 *
 * A flag `only_authorized_devices` controla se dispositivos não
 * cadastrados podem acessar a API. Quando ativa, apenas devices
 * com permissões são aceitos (além de localhost e token global).
 */

const crypto = require("crypto");
const userStore = require("./userStore.js");

const STORAGE_KEY = "devices";
const SETTINGS_KEY = "device_settings";

/** @type {Array<{id:string,token:string,name:string,platform:string,registeredAt:string,permissions:string[]}>} */
let _devices = [];

/** @type {{only_authorized_devices:boolean}|null} */
let _settings = null;

function _load() {
  try {
    const data = userStore.read(STORAGE_KEY);
    _devices = Array.isArray(data) ? data : [];
  } catch (_) {
    _devices = [];
  }
}

function _loadSettings() {
  try {
    const data = userStore.read(SETTINGS_KEY);
    if (data && typeof data === "object") {
      _settings = { only_authorized_devices: !!data.only_authorized_devices };
    } else {
      _settings = { only_authorized_devices: false };
    }
  } catch (_) {
    _settings = { only_authorized_devices: false };
  }
}

function _persist() {
  try {
    userStore.write(STORAGE_KEY, _devices);
  } catch (_) { /* noop */ }
}

function _persistSettings() {
  try {
    userStore.write(SETTINGS_KEY, _settings);
  } catch (_) { /* noop */ }
}

/** Retorna todos os dispositivos. */
function list() {
  if (!_devices.length) _load();
  return [..._devices];
}

/** Retorna as configurações de dispositivos. */
function getSettings() {
  if (!_settings) _loadSettings();
  return { ..._settings };
}

/** Atualiza as configurações de dispositivos. */
function updateSettings(partial) {
  if (!_settings) _loadSettings();
  _settings = { ..._settings, ...partial };
  _persistSettings();
  return { ..._settings };
}

/** Busca device pelo token de acesso (campo `token`). */
function findByToken(token) {
  if (!token) return null;
  if (!_devices.length) _load();
  return _devices.find((d) => d.token === token) || null;
}

/** Busca device pelo id (índice da tabela). */
function findById(id) {
  if (!id) return null;
  if (!_devices.length) _load();
  return _devices.find((d) => d.id === id) || null;
}

/**
 * Valida par device-id + device-token.
 * Usado pelo auth middleware quando o device envia X-Device-Id + X-Device-Token.
 */
function findByTokenAndId(token, id) {
  if (!token || !id) return null;
  if (!_devices.length) _load();
  return _devices.find((d) => d.token === token && d.id === id) || null;
}

/**
 * Verifica se o flag only_authorized_devices está ativo.
 * Carrega settings do disco na primeira chamada.
 */
function isOnlyAuthorized() {
  if (!_settings) _loadSettings();
  return _settings.only_authorized_devices === true;
}

/**
 * Salva a lista completa de dispositivos.
 * Chamado pelo renderer via IPC devices:save.
 * @param {Array} devices
 */
function save(devices) {
  _devices = Array.isArray(devices) ? devices : [];
  _persist();
}

/**
 * Adiciona um device pendente (pré-registro antes de definir permissões).
 * Chamado quando o device faz POST /api/register-device.
 *
 * Gera um UUID para `id` (índice da tabela) e armazena o `token` separado.
 * Deduplica por token — se o mesmo QR code for escaneado duas vezes,
 * retorna o device existente.
 *
 * @param {{token:string, name:string, model:string, platform:string}} info
 * @returns {object} device criado (sem permissões ainda)
 */
function addPending(info) {
  if (!_devices.length) _load();
  // Deduplica: se o token já foi registrado, retorna o existente.
  const existing = _devices.find((d) => d.token === info.token);
  if (existing) return existing;

  const device = {
    id: crypto.randomUUID(),
    token: info.token,
    name: info.name || "Dispositivo",
    model: info.model || "",
    platform: info.platform || "web",
    registeredAt: new Date().toISOString(),
    permissions: [],
  };
  _devices.push(device);
  _persist();
  return device;
}

module.exports = {
  list,
  findByToken,
  findById,
  findByTokenAndId,
  save,
  addPending,
  getSettings,
  updateSettings,
  isOnlyAuthorized,
};
