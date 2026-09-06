/**
 * Factory de BrowserWindows para o LouvorJA Electron.
 * Responsável por criar e configurar janelas com opções seguras e consistentes.
 * Fases posteriores (D4) vão adicionar factories para janelas de projeção/retorno.
 */

const { BrowserWindow, shell } = require("electron");
const path = require("path");

/**
 * Posição de repouso dos semáforos do macOS, alinhada ao centro da systembar.
 *
 * O `y` não é o topo do círculo: o macOS desenha o botão 1pt abaixo do valor
 * pedido, então o centro sai em `y + 7` — 18 para a barra de 35pt, meio ponto
 * abaixo do centro dela e o mais perto que se chega com `y` inteiro.
 *
 * Camadas que cobrem a systembar com uma barra mais alta pedem outra posição
 * pelo IPC "window:alignTrafficLights", e voltam a esta ao fechar.
 */
const TRAFFIC_LIGHT_POSITION = { x: 10, y: 11 };

/**
 * Cria a janela principal do LouvorJA.
 *
 * @param {string} devUrl    URL do dev server (ex: "http://localhost:5002")
 * @param {string} prodHtmlPath  Caminho absoluto para dist/index.html
 * @param {string} preloadPath   Caminho absoluto para o preload.cjs
 * @returns {BrowserWindow}
 */
function createMainWindow(devUrl, prodHtmlPath, preloadPath) {
  const isDev =
    process.env.ELECTRON_DEV === "1" ||
    !require("electron").app.isPackaged;

  // Caminho do ícone — em dev e prod, usa o PNG do logo do LouvorJA.
  const iconPath = isDev
    ? path.join(__dirname, "..", "..", "public", "ico", "favicon-180x180.png")
    : path.join(process.resourcesPath, "app.asar.unpacked", "public", "ico", "favicon-180x180.png");

  const win = new BrowserWindow({
    width: 1370,
    height: 800,
    // Não subir daqui sem antes resolver a ribbon: num monitor 1024x768 — o de
    // igreja com equipamento antigo — a área útil do Ubuntu é 958px, e um
    // mínimo maior deixaria a janela maior que a tela inteira.
    minWidth: 900,
    minHeight: 600,
    title: "LouvorJA Violin",
    icon: iconPath,
    // Quem revela a janela é revealMainWindow(), no main.cjs, ao receber o
    // "app:ready" do renderer. Não usar "ready-to-show": ele dispara no
    // primeiro frame do documento, quando o Vue ainda não montou e a tela é
    // só o fundo vazio do index.html.
    show: false,
    backgroundColor: "#1b2a41",
    // Title bar custom (replicar Delphi):
    //  - Win/Linux: frameless, SystemBar customizada com botões funcionais
    //  - macOS: titleBarStyle "hiddenInset" mantém os stoplights mas esconde a barra,
    //           permitindo que a SystemBar customizada do app sirva como drag region
    //           sem duplicar o título.
    frame: false,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    trafficLightPosition: process.platform === "darwin" ? TRAFFIC_LIGHT_POSITION : undefined,
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // Necessário para BroadcastChannel funcionar entre janelas
    },
  });

  // Handler para window.open() — necessário para janelas popup e projeção.
  // Em D4, este handler vai ser expandido para abrir BrowserWindows em monitores específicos.
  win.webContents.setWindowOpenHandler(({ url }) => {
    // URLs externas abre no browser padrão do sistema
    if (url.startsWith("http://") || url.startsWith("https://")) {
      const isLocalhost =
        url.startsWith("http://localhost") ||
        url.startsWith("http://127.0.0.1");

      if (!isLocalhost) {
        shell.openExternal(url);
        return { action: "deny" };
      }
    }

    // URLs internas (localhost ou file://) são abertas como novas BrowserWindows
    // com as mesmas webPreferences seguras.
    return {
      action: "allow",
      overrideBrowserWindowOptions: {
        webPreferences: {
          preload: preloadPath,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: false,
        },
      },
    };
  });

  if (isDev) {
    win.loadURL(devUrl);
  } else {
    // Origem fixa, e é isso que importa aqui. Antes a janela carregava do
    // servidor Express, cuja porta é sorteada quando a preferida está ocupada
    // — e como o IndexedDB é isolado por origem, cada troca de porta zerava
    // tudo que estava nele: o marcador de banco instalado e os dados que
    // alimentam a lista de coletâneas. O sintoma era o app perguntar
    // "deseja baixar o banco?" a cada abertura, mesmo depois de baixado, e a
    // tela de coletâneas aparecer sem nada para selecionar.
    //
    // O motivo de outrora para preferir HTTP — o embed do YouTube exigir
    // origem real — não se confirma: medido no Ubuntu 24.04, o mesmo embed
    // responde 200 nas duas origens, e sob `http://localhost` ainda aparecem
    // dois ERR_BLOCKED_BY_ORB que aqui não aparecem. O servidor Express segue
    // no ar para o OBS; ele é que deixa de ser a origem das janelas.
    win.loadURL("louvorja://app/index.html#/");
  }

  return win;
}

module.exports = { createMainWindow, TRAFFIC_LIGHT_POSITION };
