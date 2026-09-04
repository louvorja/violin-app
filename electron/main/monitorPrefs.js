"use strict";

/**
 * monitorPrefs.js — Normalização de preferências de monitor.
 *
 * Módulo PURO: sem `require("electron")`, sem I/O. Recebe objetos planos e
 * devolve valores, para poder ser testado sem subir o Electron.
 */

/**
 * Normaliza o valor bruto de uma preferência para um id de display.
 *
 * A UI grava três formatos diferentes no mesmo mapa: id numérico
 * (Screen.vue / RibbonScreenButton.vue), os papéis "primary"/"secondary"
 * (MonitorSelect.vue) e 0/"" para "nenhum / mesma janela".
 *
 * @param {number|string|null|undefined} wanted  Valor salvo em monitor_prefs
 * @param {{primary: number|null, secondary: number|null}} roles
 *        Monitores atribuídos aos papéis (Opções → Monitores)
 * @returns {number|null}  null = sem preferência utilizável
 */
function resolveWantedId(wanted, roles) {
  const { primary = null, secondary = null } = roles || {};

  if (wanted == null) return null;
  if (typeof wanted === "number") return wanted > 0 ? wanted : null;
  if (typeof wanted !== "string") return null;

  const value = wanted.trim();
  if (value === "") return null;
  if (value === "primary") return typeof primary === "number" && primary > 0 ? primary : null;
  if (value === "secondary") return typeof secondary === "number" && secondary > 0 ? secondary : null;

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Extrai os monitores atribuídos aos papéis a partir do `user_data`.
 * @param {object|null|undefined} userData
 * @returns {{primary: number|null, secondary: number|null}}
 */
function rolesFromUserData(userData) {
  const conf = (userData && userData.options && userData.options.displays) || {};
  const pick = (v) => (typeof v === "number" && v > 0 ? v : null);
  return { primary: pick(conf.monitor_primary), secondary: pick(conf.monitor_secondary) };
}

module.exports = { resolveWantedId, rolesFromUserData };
