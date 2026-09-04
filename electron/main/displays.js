"use strict";

/**
 * displays.js — Gerenciamento de monitores para o LouvorJA Electron (D4).
 *
 * Lista os displays conectados e persiste preferências de monitor por feature.
 */

const { screen } = require("electron");
const userStore = require("./userStore.js");
const { resolveWantedId, rolesFromUserData } = require("./monitorPrefs.js");
const monitorConfig = require("./monitorConfig.js");
const monitorIdentity = require("./monitorIdentityBridge.cjs");

const PREF_KEY = "monitor_prefs";
const USER_DATA_KEY = "user_data";

/**
 * Lista todos os displays conectados, com info útil para UI.
 * @returns {Array}
 */
function list() {
  const primary = screen.getPrimaryDisplay();

  // Ordem geométrica (esquerda → direita, topo → base) em vez da ordem de
  // enumeração do sistema, que muda quando o usuário rearranja os monitores.
  // Assim o "Monitor 2" de hoje é o mesmo de ontem, e o número bate com a
  // posição física que o operador enxerga.
  return orderDisplays(screen.getAllDisplays()).map((d, i) => {
    const name = typeof d.label === "string" ? d.label.trim() : "";
    return {
      id: d.id,
      number: i + 1,
      // Nome real do aparelho ("BenQ MX532"), quando o sistema informa. Vem
      // vazio no Linux/X11.
      name,
      label: name ? `Monitor ${i + 1} — ${name}` : `Monitor ${i + 1}`,
      bounds: d.bounds,
      workArea: d.workArea,
      scaleFactor: d.scaleFactor,
      rotation: d.rotation,
      internal: d.internal,
      primary: d.id === primary.id,
      index: i,
    };
  });
}

/** Ordena displays pela posição na área de trabalho virtual. */
function orderDisplays(all) {
  return [...(all || [])].sort(
    (a, b) => (a.bounds.x - b.bounds.x) || (a.bounds.y - b.bounds.y)
  );
}

/**
 * Ponte com o `user_data` vivo do main process.
 *
 * O main mantém uma cópia em memória (`_userDataMain`) e a regrava inteira ao
 * sair; se gravássemos direto no userStore daqui, essa regravação apagaria a
 * mudança. Então lemos e persistimos sempre através dele.
 */
let _bridge = null;

/** @param {{getUserData: () => object, saveUserData: () => void}} bridge */
function configure(bridge) {
  _bridge = bridge;
}

function _readUserData() {
  if (_bridge) return _bridge.getUserData() || {};
  return userStore.read(USER_DATA_KEY) || {};
}

function _saveUserData() {
  if (_bridge) _bridge.saveUserData();
}

/**
 * Resolve o monitor de uma feature, com o status da decisão.
 *
 * Usa os papéis (v2) quando disponíveis; cai no mapa por feature enquanto a
 * migração não rodou, ou quando o kill switch está ligado.
 *
 * @param {string} featureId
 * @returns {{status: string, display: object|null, reason: string|null, role: string|null}}
 */
function resolveFeature(featureId) {
  const userData = _readUserData();
  const connected = screen.getAllDisplays();

  const v2 = monitorConfig.getConfig(userData);
  if (v2 && !v2.use_legacy_resolver) {
    return monitorConfig.resolveFeature({ userData, feature: featureId, connected });
  }

  const prefs = userStore.read(PREF_KEY) || {};
  const wantedId = resolveWantedId(prefs[featureId], rolesFromUserData(userData));
  if (wantedId == null) {
    return { status: monitorConfig.STATUS.NONE, display: null, reason: null, role: null };
  }
  const display = connected.find((d) => d.id === wantedId) || null;
  return {
    status: display ? monitorConfig.STATUS.RESOLVED : monitorConfig.STATUS.PENDING,
    display,
    reason: display ? null : "monitor-absent",
    role: null,
  };
}

/**
 * Retorna o display preferido de uma feature, ou null quando não há
 * preferência utilizável (nunca configurada, "mesma janela", ou monitor
 * desconectado).
 *
 * Não cai em `getPrimaryDisplay()`: quem precisa desse fallback deve pedi-lo
 * explicitamente via `getPreferredOrPrimary()`. Devolver o monitor principal
 * quando a preferência não resolve é o que faz a projeção aparecer na tela do
 * operador durante o culto.
 *
 * @param {string} featureId
 * @returns {Electron.Display|null}
 */
function getPreferred(featureId) {
  return resolveFeature(featureId).display;
}

/**
 * Como `getPreferred`, mas cai no monitor principal quando não resolve.
 * Use apenas onde uma janela precisa abrir de qualquer jeito.
 *
 * @param {string} featureId
 * @returns {Electron.Display}
 */
function getPreferredOrPrimary(featureId) {
  return getPreferred(featureId) || screen.getPrimaryDisplay();
}

/**
 * Estado de cada papel (monitor atribuído e se ele está presente).
 * @returns {{role: string, status: string, reason: string|null, displayId: number|null}[]}
 */
function getRoles() {
  return monitorConfig.rolesSummary({
    userData: _readUserData(),
    connected: screen.getAllDisplays(),
  });
}

/**
 * Atribui um monitor a um papel.
 * @param {string} role
 * @param {number|null} displayId  null = nenhum monitor
 * @returns {boolean}
 */
function setRole(role, displayId) {
  const userData = _readUserData();
  const connected = screen.getAllDisplays();
  const display = displayId == null ? null : connected.find((d) => d.id === displayId) || null;
  if (displayId != null && !display) return false;

  const ok = monitorConfig.setRoleDisplay({ userData, role, display, connected });
  if (ok) _saveUserData();
  return ok;
}

/**
 * Define qual papel uma feature usa (ou "mesma janela", com role null).
 * @returns {boolean}
 */
function setFeatureRole(feature, role) {
  const userData = _readUserData();
  const ok = monitorConfig.setFeatureRole({ userData, feature, role });
  if (ok) _saveUserData();
  return ok;
}

/** Papel efetivo de uma feature (escolha do usuário ou padrão do módulo). */
function getFeatureRole(feature) {
  return monitorConfig.featureRole(_readUserData(), feature);
}

/**
 * Salva preferência de display para uma feature.
 * @param {string} featureId
 * @param {number} displayId
 */
function setPreferred(featureId, displayId) {
  // Dual-write enquanto a UI ainda configura por feature: o formato antigo
  // segue intacto (rollback continua possível) e o papel correspondente é
  // atualizado para o novo resolvedor enxergar a escolha.
  const prefs = userStore.read(PREF_KEY) || {};
  prefs[featureId] = displayId;
  userStore.write(PREF_KEY, prefs);

  const userData = _readUserData();
  if (!monitorConfig.getConfig(userData)) return;

  const role = monitorIdentity.roles().roleOfFeature(featureId);
  if (!role) return;

  const connected = screen.getAllDisplays();
  const wantedId = resolveWantedId(displayId, rolesFromUserData(userData));
  const display = wantedId == null ? null : connected.find((d) => d.id === wantedId) || null;
  if (wantedId != null && !display) return; // monitor desconhecido — não mexe no papel

  monitorConfig.setRoleDisplay({ userData, role, display, connected });
  _saveUserData();
}

/**
 * Retorna todas as preferências salvas.
 * @returns {object}
 */
function getPrefs() {
  return userStore.read(PREF_KEY) || {};
}

module.exports = {
  list,
  orderDisplays,
  configure,
  resolveFeature,
  getPreferred,
  getPreferredOrPrimary,
  setPreferred,
  getPrefs,
  getRoles,
  setRole,
  getFeatureRole,
  setFeatureRole,
};
