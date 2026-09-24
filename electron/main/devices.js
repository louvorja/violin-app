"use strict";

/**
 * Gerenciamento de dispositivos autorizados.
 *
 * Devices são mantidos em memória (sincronizados pelo renderer via IPC)
 * e persistidos no IndexedDB do renderer.
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

const SETTINGS_KEY = "device_settings";

/** @type {Array<{id:string,token:string,name:string,platform:string,registeredAt:string,permissions:string[]}>} */
let _devices = [];

/** @type {{only_authorized_devices:boolean}|null} */
let _settings = null;

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

function _persistSettings() {
  const persistence = userStore.write(SETTINGS_KEY, _settings);
  persistence.catch((error) => {
    console.warn("[devices] Falha ao persistir configuracoes:", error?.message || error);
  });
  return persistence;
}

/** Retorna todos os dispositivos (cache em memória, sincronizado pelo renderer). */
function list() {
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

  return _devices.find((d) => d.token === token) || null;
}

/** Busca device pelo id (índice da tabela). */
function findById(id) {
  if (!id) return null;

  return _devices.find((d) => d.id === id) || null;
}

/**
 * Valida par device-id + device-token.
 * Usado pelo auth middleware quando o device envia X-Device-Id + X-Device-Token.
 */
function findByTokenAndId(token, id) {
  if (!token || !id) return null;
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
 * Salva a lista completa de dispositivos no cache em memória.
 * Chamado pelo renderer via IPC devices:save.
 * @param {Array} devices
 */
function save(devices) {
  const count = Array.isArray(devices) ? devices.length : 0;
  _devices = Array.isArray(devices) ? devices : [];
  console.log(`[devices] cache atualizado: ${count} devices`);
}

/**
 * Adiciona um device pendente (pré-registro antes de definir permissões).
 * Chamado quando o device faz POST /api/register-device.
 *
 * O `id` é o fingerprint fornecido pelo aparelho (hardware fingerprint no
 * Android, identifierForVendor no iOS). Se já existe um device com esse
 * fingerprint, sobrescreve os dados (mantendo as permissões definidas pelo
 * operador).
 *
 * @param {{token:string, name:string, model:string, platform:string, fingerprint:string}} info
 * @returns {object} device (sem permissões ainda, ou com as existentes)
 */
function addPending(info) {
  const fingerprint = info.fingerprint || "";
  if (fingerprint) {
    // Procura por fingerprint existente e sobrescreve.
    const existing = _devices.find((d) => d.id === fingerprint);
    if (existing) {
      existing.token = info.token;
      existing.name = info.name || existing.name;
      existing.model = info.model || existing.model;
      existing.platform = info.platform || existing.platform;
      existing.registeredAt = new Date().toISOString();
      return existing;
    }
  }

  const device = {
    id: info.fingerprint,
    token: info.token,
    name: info.name,
    model: info.model,
    platform: info.platform,
    registeredAt: new Date().toISOString(),
    permissions: [],
  };
  _devices.push(device);
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
