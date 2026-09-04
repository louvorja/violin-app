"use strict";

/**
 * displayManager.js — Dono único das mudanças de monitor.
 *
 * Antes, cada janela de projeção registrava os próprios listeners de `screen`,
 * só no Windows/Linux e sem debounce. Um hot-plug HDMI emite uma rajada de
 * eventos, o que causava reposicionamentos em sequência (piscar, tela preta), e
 * no macOS nada reagia.
 *
 * Aqui há UM listener, com debounce, valendo em todos os sistemas. A cada
 * mudança: promove preferências pendentes, recoloca as janelas e avisa os
 * renderers.
 */

const { BrowserWindow, screen } = require("electron");
const displays = require("./displays.js");
const monitorConfig = require("./monitorConfig.js");
const windowFactory = require("./windowFactory.js");

/**
 * Drivers de projetor emitem vários eventos ao reconectar (added seguido de
 * metrics-changed em sequência). Esperar o conjunto assentar evita reposicionar
 * a janela várias vezes seguidas.
 */
const DEBOUNCE_MS = 500;

const EVENTS = ["display-added", "display-removed", "display-metrics-changed"];

let _bridge = null;
let _timer = null;
let _attached = false;

/** Envia um evento para todas as janelas vivas. */
function _broadcast(channel, payload) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win || win.isDestroyed()) continue;
    try {
      win.webContents.send(channel, payload);
    } catch (_) {
      /* janela indo embora */
    }
  }
}

/** Resolve o monitor de uma feature, ignorando falhas. */
function _resolveDisplay(feature) {
  const result = displays.resolveFeature(feature);
  return result ? result.display : null;
}

/** Aplica a mudança de monitores: papéis, janelas e renderers. */
function apply() {
  const connected = screen.getAllDisplays();

  let promoted = [];
  try {
    const userData = _bridge ? _bridge.getUserData() : null;
    if (userData) {
      const result = monitorConfig.reconcile({ userData, connected });
      promoted = result.promoted;
      if (result.changed && _bridge) _bridge.saveUserData();
    }
  } catch (e) {
    console.warn("[displays] Falha ao reconciliar preferências:", e?.message || e);
  }

  let windows = { shown: [], hidden: [] };
  try {
    windows = windowFactory.reconcile(_resolveDisplay);
  } catch (e) {
    console.warn("[displays] Falha ao reposicionar janelas:", e?.message || e);
  }

  const parts = [`${connected.length} monitor(es)`];
  if (promoted.length) parts.push(`papéis promovidos: ${promoted.join(", ")}`);
  if (windows.shown.length) parts.push(`janelas restauradas: ${windows.shown.join(", ")}`);
  if (windows.hidden.length) parts.push(`janelas escondidas: ${windows.hidden.join(", ")}`);
  console.log(`[displays] Mudança detectada — ${parts.join("; ")}`);

  _broadcast("displays:changed", {
    displays: displays.list(),
    promoted,
    hidden: windows.hidden,
    shown: windows.shown,
  });
}

function _schedule() {
  if (_timer) clearTimeout(_timer);
  _timer = setTimeout(() => {
    _timer = null;
    apply();
  }, DEBOUNCE_MS);
}

/**
 * Começa a observar os monitores.
 * @param {{getUserData: () => object, saveUserData: () => void}} bridge
 */
function init(bridge) {
  _bridge = bridge;
  if (_attached) return;
  for (const event of EVENTS) screen.on(event, _schedule);
  _attached = true;
}

/** Para de observar. Usado no shutdown e nos testes. */
function dispose() {
  if (_timer) {
    clearTimeout(_timer);
    _timer = null;
  }
  if (!_attached) return;
  for (const event of EVENTS) screen.removeListener(event, _schedule);
  _attached = false;
}

module.exports = { DEBOUNCE_MS, init, dispose, apply };
