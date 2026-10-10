"use strict";

/**
 * Menu de contexto (botão direito) para campos editáveis.
 *
 * O Electron não exibe menu nenhum em "context-menu" sem um handler: no
 * desktop o clique direito dentro de input/textarea não fazia nada, e com ele
 * desaparecia a opção de copiar/colar. Aqui o menu é o nativo da plataforma,
 * montado pelo processo principal: ele enxerga a área de transferência do
 * sistema sem pedir permissão (navigator.clipboard.readText pediria no
 * renderer) e dispara os comandos direto no webContents.
 *
 * O web/PWA já recebe o menu do navegador — nenhum código do renderer
 * cancela "contextmenu" — então este módulo cobre só o Electron. Os rótulos
 * em português seguem o precedente das strings do processo principal
 * (bandeja e dialog em main.cjs).
 */

/**
 * Descreve o template do menu sem amarrar ao Electron, para o teste poder
 * exercitar a montagem sem importar "electron".
 *
 * @param {object} params Payload de "context-menu" do Chromium.
 * @returns {Array<object>|null} Itens com label/enabled/action ou null
 *   quando não há o que oferecer (área comum sem seleção).
 */
function buildEditContextMenuTemplate(params) {
  const flags = (params && params.editFlags) || {};
  if (params && params.isEditable) {
    return [
      { label: "Recortar", enabled: !!flags.canCut, action: "cut" },
      { label: "Copiar", enabled: !!flags.canCopy, action: "copy" },
      { label: "Colar", enabled: !!flags.canPaste, action: "paste" },
      { type: "separator" },
      { label: "Selecionar tudo", enabled: !!flags.canSelectAll, action: "selectAll" },
    ];
  }
  if (params && params.selectionText) {
    return [{ label: "Copiar", enabled: true, action: "copy" }];
  }
  return null;
}

/**
 * Registra o handler de "context-menu" na janela.
 *
 * @param {Electron.BrowserWindow} win Janela alvo.
 * @param {typeof import("electron").Menu} Menu Módulo Menu do Electron
 *   (injetado para o teste não depender do runtime do Electron).
 */
function attachEditContextMenu(win, Menu) {
  if (!win || !win.webContents || typeof win.webContents.on !== "function") return;

  win.webContents.on("context-menu", (_event, params) => {
    try {
      const items = buildEditContextMenuTemplate(params);
      if (!items) return;
      const template = items.map((item) =>
        item.type === "separator"
          ? { type: "separator" }
          : {
              label: item.label,
              enabled: item.enabled,
              click: () => {
                try {
                  if (win.isDestroyed()) return;
                  win.webContents[item.action]();
                } catch (error) {
                  // Janela pode fechar com o menu aberto; o clique não pode
                  // derrubar o processo principal.
                  console.warn(`[context-menu] ${item.action} falhou:`, error?.message || error);
                }
              },
            }
      );
      Menu.buildFromTemplate(template).popup({ window: win });
    } catch (error) {
      console.warn("[context-menu] não foi possível abrir o menu:", error?.message || error);
    }
  });
}

module.exports = { attachEditContextMenu, buildEditContextMenuTemplate };
