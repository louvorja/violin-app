"use strict";

/**
 * Entrega IPC best-effort para uma BrowserWindow ou WebContents.
 *
 * Callbacks assíncronos podem sobreviver ao fechamento de uma janela. Em vez de
 * deixá-los lançar "Object has been destroyed", o emissor descarta a atualização
 * que já não possui destinatário. O retorno permite diagnóstico local sem
 * expor payloads pelo log.
 *
 * @param {import("electron").BrowserWindow | import("electron").WebContents | null | undefined} target
 * @param {string} channel
 * @param {unknown} payload
 * @returns {boolean}
 */
function safeSend(target, channel, payload) {
  try {
    // O getter nativo de BrowserWindow também lança após a destruição; a
    // proteção precisa começar antes de resolver o destinatário.
    const webContents = target?.webContents ?? target;
    if (!webContents || typeof webContents.isDestroyed !== "function" || webContents.isDestroyed()) {
      return false;
    }
    webContents.send(channel, payload);
    return true;
  } catch (error) {
    console.warn("[ipc] envio descartado", {
      channel,
      reason: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

module.exports = { safeSend };
