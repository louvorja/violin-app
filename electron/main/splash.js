"use strict";

/**
 * Splash window — janela frameless 508×117 que cobre a inicialização inteira.
 * Replica fmIniciando.dfm (Delphi): fundo #2D2D28, fade-in via AlphaBlend e a
 * mensagem "Inicializando programa...".
 *
 * Abre no primeiro instante do `whenReady` e sai quando a janela principal
 * aparece pintada — quem fecha é `revealMainWindow()`, no main.cjs. O que ela
 * mostra é fixo, e por isso a janela não tem preload: não há nada a dizer ao
 * documento durante a espera.
 */

const { BrowserWindow, screen } = require("electron");
const path = require("path");

let splashWindow = null;

function show() {
  if (splashWindow && !splashWindow.isDestroyed()) return splashWindow;

  // Centralizar na tela primária
  const primary = screen.getPrimaryDisplay();
  const w = 508;
  const h = 117;
  // workArea (e não bounds + workAreaSize): no Ubuntu o dock fica na lateral
  // esquerda e o painel no topo, então a origem da área útil não coincide com
  // a origem do monitor — misturar as duas jogava o splash fora do centro.
  const area = primary.workArea;
  const x = Math.round(area.x + (area.width - w) / 2);
  const y = Math.round(area.y + (area.height - h) / 2);

  splashWindow = new BrowserWindow({
    width: w,
    height: h,
    // Sem isto, w/h são a medida externa da janela no Windows, e o conteúdo
    // recebe menos do que os 117px que o layout do splash.html espera.
    useContentSize: true,
    x,
    y,
    frame: false,
    transparent: false,
    resizable: false,
    movable: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    backgroundColor: "#2D2D28",
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  splashWindow.loadFile(path.join(__dirname, "..", "splash.html"));

  splashWindow.once("ready-to-show", () => {
    if (splashWindow && !splashWindow.isDestroyed()) splashWindow.show();
  });

  splashWindow.on("closed", () => {
    splashWindow = null;
  });

  return splashWindow;
}

function close() {
  if (splashWindow && !splashWindow.isDestroyed()) {
    // Fade-out suave: dá um pequeno delay para a animação CSS terminar
    try {
      splashWindow.webContents.executeJavaScript(
        "document.getElementById('splash-root')?.classList.add('splash--leaving');",
      ).catch(() => { /* ignore */ });
    } catch (_) { /* ignore */ }

    setTimeout(() => {
      if (splashWindow && !splashWindow.isDestroyed()) {
        splashWindow.close();
      }
      splashWindow = null;
    }, 280);
  }
}

function isOpen() {
  return !!(splashWindow && !splashWindow.isDestroyed());
}

module.exports = { show, close, isOpen };
