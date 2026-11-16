"use strict";

/**
 * Rotas de teclado do controle remoto.
 *
 * POST /api/keyboard — injeta uma tecla no renderer.
 */

/**
 * Códigos VK legados (modo clássico do app) → nomes de tecla do DOM.
 * O modo clássico remapeia as setas para números (37/38/39/40…).
 */
const LEGACY_VK_KEYS = {
  13: "Enter",
  27: "Escape",
  32: "Space",
  35: "End",
  36: "Home",
  37: "ArrowLeft",
  38: "ArrowUp",
  39: "ArrowRight",
  40: "ArrowDown",
};


/** Aliases aceitos → nome DOM usado pelo `Hotkeys` do renderer. */
const KEY_ALIASES = {
  arrowleft: "ArrowLeft",
  arrowright: "ArrowRight",
  arrowup: "ArrowUp",
  arrowdown: "ArrowDown",
  esc: "Escape",
  " ": "Space",
  space: "Space",
  return: "Enter",
};


/**
 * Normaliza o nome da tecla recebido do client para o nome DOM.
 *
 * O app manda `ArrowRight`/`Space`/`Home`… (e o modo clássico, códigos VK).
 * O `Hotkeys` do renderer compara por `KeyboardEvent.key`, então a chave
 * precisa chegar no formato DOM.
 */
function normalizeKeyName(rawKey) {
  const str = String(rawKey ?? "");
  // Espaço literal (" ") é uma tecla, não whitespace a aparar.
  if (str === " ") return "Space";
  const trimmed = str.trim();
  if (!trimmed) return null;
  if (LEGACY_VK_KEYS[trimmed]) return LEGACY_VK_KEYS[trimmed];
  const alias = KEY_ALIASES[trimmed.toLowerCase()];
  if (alias) return alias;
  return trimmed;
}


/**
 * Registra as rotas de teclado.
 *
 * @param {import("express").Application} app
 * @param {object} ctx deps do setupRoutes (ver routes.js)
 */
function register(app, ctx) {
  const { getValidMainWindow, hasDevicePermission } = ctx;

  // ---------------------------------------------------------------
  // POST /api/keyboard — simular tecla
  // Body: { key: string, modifiers?: string[] }
  //
  // Injeta um KeyboardEvent sintético no renderer em vez de usar
  // `webContents.sendInputEvent`. Dois motivos:
  //  1. `sendInputEvent` exige a BrowserWindow EM FOCO (ver docs do Electron),
  //     e o controle remoto é usado justamente com o desktop em segundo plano;
  //  2. `sendInputEvent.keyCode` só aceita códigos de Accelerator ("Right"),
  //     não nomes DOM ("ArrowRight") — era o que o app enviava.
  // O evento sintético cai no `Hotkeys` do renderer, reaproveitando todo o
  // roteamento já existente (Media × Bíblia).
  //
  // Permission: `keyboard` (ou `root`) — as teclas de atalho do app passam
  // por aqui, e um device sem a role toma 403 (o app mostra o aviso).
  // ---------------------------------------------------------------
  app.post("/api/keyboard", (req, res) => {
    if (!hasDevicePermission(req, "keyboard")) {
      console.log("[httpServer] keyboard → 403 (device sem a permission keyboard)");
      return res.status(403).json({ error: "Device sem permissão de teclas de atalho" });
    }
    const mainWindow = getValidMainWindow();
    const rawKey = req.body && req.body.key;
    const modifiers = (req.body && req.body.modifiers) || [];
    if (!rawKey || !mainWindow) {
      return res.status(400).json({ error: "key faltando ou janela indisponível" });
    }

    const key = normalizeKeyName(rawKey);
    if (!key) {
      return res.status(400).json({ error: `key inválida: ${rawKey}` });
    }

    const mods = new Set(
      (Array.isArray(modifiers) ? modifiers : []).map((m) => String(m).toLowerCase())
    );
    const event = {
      key,
      bubbles: true,
      cancelable: true,
      ctrlKey: mods.has("control") || mods.has("ctrl"),
      metaKey: mods.has("meta") || mods.has("cmd") || mods.has("command"),
      altKey: mods.has("alt"),
      shiftKey: mods.has("shift"),
    };

    try {
      // `executeJavaScript` roda independente de foco/minimização.
      mainWindow.webContents
        .executeJavaScript(
          `window.dispatchEvent(new KeyboardEvent("keydown", ${JSON.stringify(event)}))`
        )
        .catch(() => { /* janela ainda carregando ou destruída */ });
      res.json({ status: "ok", key, modifiers });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
}


module.exports = { register, normalizeKeyName };
