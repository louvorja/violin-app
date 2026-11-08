"use strict";

/**
 * ⌘W (Mac) / Ctrl+W (Windows e Linux) fecha a aba, como no Chrome — nunca a janela
 * de uma vez.
 *
 * O app não define menu, então vale o padrão do Electron, cujo "Fechar" usa essa
 * tecla. No Mac o menu a pega antes da página; no Windows e no Linux ele age sempre
 * que a página não cancela a tecla — e o Hotkeys não cancela com o foco num diálogo,
 * num menu aberto ou com um alerta na tela. Com o cursor no nome do item da Liturgia
 * (um diálogo), o Ctrl+W fechava o programa inteiro.
 *
 * Por isso o main cancela sempre a tecla antes do menu e a entrega ao Hotkeys pelo
 * mesmo evento sintético do /api/keyboard. Ele decide entre a aba e a janela; onde
 * ele não age, nada fecha.
 *
 * Devolve o script a executar na página, `""` para só cancelar (tecla repetida: não
 * pode ir fechando até a janela), ou `null` quando a tecla não é esta.
 */
function closeTabKeyScript(input, platform) {
  if (!input || input.type !== "keyDown") return null;
  const mac = platform === "darwin";
  const mod = mac ? input.meta && !input.control : input.control && !input.meta;
  if (!mod || input.alt || input.shift) return null;
  if (String(input.key || "").toLowerCase() !== "w") return null;
  if (input.isAutoRepeat) return "";
  const init = { key: "w", [mac ? "metaKey" : "ctrlKey"]: true, bubbles: true, cancelable: true };
  return `window.dispatchEvent(new KeyboardEvent("keydown", ${JSON.stringify(init)}))`;
}

module.exports = { closeTabKeyScript };
