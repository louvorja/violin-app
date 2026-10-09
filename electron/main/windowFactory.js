"use strict";

/**
 * windowFactory.js — Factory para criar BrowserWindows em monitores específicos (D4).
 *
 * Mantém referência das janelas abertas por feature para evitar duplicatas.
 * Integra com displays.js para persistir preferências de monitor por feature.
 */

const { app, BrowserWindow, Menu } = require("electron");
const displays = require("./displays.js");
const { attachEditContextMenu } = require("./editContextMenu.js");
const powerBlocker = require("./powerBlocker.js");
const { createWindowCloseGate, DEFAULT_CLOSE_ACK_TIMEOUT_MS } = require("./windowCloseGate.js");
const { backgroundWindows, prepareWindow } = require("./e2eWindowMode.js");
const { isExternalRoute, loadTargetFor, webPreferencesFor } = require("./windowRoute.js");

/**
 * Features da tela de loading da projeção de Site.
 *
 * São janelas da SPA que cobrem a janela externa enquanto ela carrega e entra
 * em apresentação. Precisam ficar ACIMA dela — daí o nível de alwaysOnTop e o
 * empurrão de topo quando a de Site aparece.
 */
const SITE_LOADER_FEATURES = ["site_loader", "site_loader_return"];

/**
 * Traz as telas de loading de Site para o topo.
 *
 * A janela externa é mostrada DEPOIS do loader, e no Windows/Linux as duas
 * ficam em nível `screen-saver` — empate em que a recém-mostrada vence. Sem
 * este empurrão apareciam quadros do Canva entre a página e a tela de
 * loading. Síncrono de propósito: roda no mesmo turno do `showInactive`, antes
 * de o compositor apresentar o quadro.
 */
function _trazerLoadersAoTopo() {
  for (const feature of SITE_LOADER_FEATURES) {
    const win = _openWindows.get(feature);
    if (!win || win.isDestroyed()) continue;
    try {
      win.moveTop();
    } catch (_) {
      /* a janela pode ter sido destruída entre o get e o moveTop */
    }
  }
}

/** Mantém referência das janelas abertas por feature para evitar duplicatas */
const _openWindows = new Map();
/** A feature is not reusable until Electron confirms the old BrowserWindow closed. */
const _windowCloseGate = createWindowCloseGate(DEFAULT_CLOSE_ACK_TIMEOUT_MS);

/**
 * Metadata de cada janela aberta, para conseguir recolocá-la no monitor certo
 * quando os displays mudarem (ver `reconcile`).
 */
const _windowMeta = new Map();

/** Referência à janela principal — usada para devolver o foco após abrir projeções. */
let _mainWindow = null;
let _httpPort = null;
let _windowObserver = null;
let _presentationActivityObserver = null;
let _siteNavigationListener = null;
let _siteReadyListener = null;
let _operationMeasurer = (_operation, _details, run) => run();

function setOperationMeasurer(measurer) {
  _operationMeasurer = typeof measurer === "function" ? measurer : (_operation, _details, run) => run();
}

/**
 * Permite ao main observar lifecycle/crash das janelas sem acoplar a factory
 * a PostHog. O callback e best-effort e nunca participa da abertura.
 * @param {((win: Electron.BrowserWindow, context: object) => void) | null} observer
 */
function setWindowObserver(observer) {
  _windowObserver = typeof observer === "function" ? observer : null;
}

/** Informa o main quando existe uma janela de projeção, mesmo escondida por hotplug. */
function setPresentationActivityObserver(observer) {
  _presentationActivityObserver = typeof observer === "function" ? observer : null;
  _syncMainBackgroundThrottling();
}

/**
 * Notifica cada navegação do frame principal de uma janela EXTERNA.
 *
 * É o gancho de quem precisa saber "onde a projeção parou" sem a factory
 * conhecer o Canva: o main compara a URL com `ehPaginaDeLogin` e decide se é
 * uma parede de login. Só http é navegável ali, então a URL sempre chega limpa.
 * @param {((win: Electron.BrowserWindow, ctx: {feature: string, url: string}) => void) | null} fn
 */
function setSiteNavigationListener(fn) {
  _siteNavigationListener = typeof fn === "function" ? fn : null;
}

/**
 * Notifica quando uma janela EXTERNA termina de carregar a página.
 *
 * É o gancho de quem precisa agir DEPOIS do site estar pronto — o Canva usa
 * para clicar em "Apresentar em tela cheia" antes de o operador ver a
 * visualização. A factory não sabe o que é Canva: quem decide é o main.
 * @param {((win: Electron.BrowserWindow, ctx: {feature: string, url: string}) => void) | null} fn
 */
function setSiteReadyListener(fn) {
  _siteReadyListener = typeof fn === "function" ? fn : null;
}

/**
 * Registra a janela principal. As janelas auxiliares (projeção, operador,
 * retorno) nunca devem roubar o foco dela — o operador navega pela main
 * (setas na Bíblia, atalhos) enquanto a projeção apenas exibe.
 * @param {Electron.BrowserWindow|null} win
 */
function setMainWindow(win) {
  _mainWindow = win;
  _syncMainBackgroundThrottling();
}

/** Retorna se uma janela está realmente ativa para fins de renderização. */
function _isWindowActive(win) {
  if (!win || win.isDestroyed()) return false;
  try {
    return win.isVisible() && !(win.isMinimized && win.isMinimized());
  } catch (_) {
    return false;
  }
}

/** Suspende timers/renderização de uma janela auxiliar escondida ou minimizada. */
function _syncAuxBackgroundThrottling(win) {
  if (!win || win.isDestroyed()) return;
  try {
    win.webContents.setBackgroundThrottling(!_isWindowActive(win));
  } catch (_) {
    /* Electron antigo ou renderer já destruído. */
  }
}

function _shouldSkipTaskbar(meta) {
  return (
    meta?.fullscreen === true &&
    (process.platform === "win32" || process.platform === "linux") &&
    meta?.showInTaskbar !== true
  );
}

/**
 * A janela principal só precisa continuar sem throttling quando uma janela de
 * apresentação visível depende dos timers do renderer (slides, vídeo, Bíblia).
 * Janelas auxiliares escondidas por monitor desconectado não justificam o
 * custo de CPU.
 */
function _syncMainBackgroundThrottling() {
  const presentationWindows = Array.from(_openWindows.entries()).filter(([feature, win]) => {
    const meta = _windowMeta.get(feature) || {};
    return _isProjectionPresentationWindow(meta.route, feature) && win && !win.isDestroyed();
  });
  try { _presentationActivityObserver?.(presentationWindows.length > 0); } catch (_) { /* noop */ }
  if (!_mainWindow || _mainWindow.isDestroyed()) return;
  const projectionVisible = presentationWindows.some(([, win]) => _isWindowActive(win));
  try {
    _mainWindow.webContents.setBackgroundThrottling(!projectionVisible);
  } catch (_) {
    /* Electron antigo: a opção inicial continua sendo segura. */
  }
}

/** Devolve o foco à janela principal (se viva) após abrir uma janela auxiliar. */
function _refocusMainWindow() {
  if (backgroundWindows) return;
  if (!_mainWindow || _mainWindow.isDestroyed()) return;
  // Pequeno delay para o fullscreen/always-on-top "settle" primeiro.
  setTimeout(() => {
    try {
      if (_mainWindow && !_mainWindow.isDestroyed() && !_mainWindow.isMinimized()) {
        _mainWindow.focus();
      }
    } catch (_) { /* ignore */ }
  }, 80);
}

/**
 * Em qual monitor esta feature deve aparecer, ou `null` para não aparecer.
 *
 * NÃO gravamos preferência aqui: quem persiste a escolha do usuário é a UI
 * (Screen.vue / RibbonScreenButton.vue / MonitorSelect.vue). Gravar na abertura
 * já poluiu o mapa de preferências no passado com chaves que ninguém lê.
 *
 * O `null` existe por causa do último passo: quando a preferência não resolve,
 * `getPreferredOrPrimary` entrega o monitor principal, que com o projetor
 * desconectado é a tela onde o operador trabalha. Só freamos quando o papel
 * ESTÁ configurado e o monitor dele não está aqui (`pending`). Quem nunca
 * configurou nada — um monitor só, ou a igreja que espelha a imagem do
 * operador — continua abrindo normalmente: ali a tela do operador É o projetor,
 * e é isso que se quer.
 */
function _targetDisplay(feature, monitorId) {
  if (monitorId !== undefined && monitorId !== null) {
    const pedido = displays.connected().find((d) => d.id === monitorId);
    if (pedido) return pedido;
  }

  const alvo = displays.getPreferredOrPrimary(feature);
  if (displays.resolveFeature(feature).status === "pending" && _isOperatorDisplay(alvo)) {
    console.warn(
      `[windowFactory] ${feature}: monitor do papel ausente; não abro na tela do operador.`
    );
    return null;
  }
  return alvo;
}

/** O display informado é aquele onde a janela principal está? */
function _isOperatorDisplay(display) {
  if (!display || !_mainWindow || _mainWindow.isDestroyed()) return false;
  try {
    const b = _mainWindow.getBounds();
    return (
      display.bounds.x <= b.x + b.width / 2 &&
      b.x + b.width / 2 < display.bounds.x + display.bounds.width &&
      display.bounds.y <= b.y + b.height / 2 &&
      b.y + b.height / 2 < display.bounds.y + display.bounds.height
    );
  } catch (_) {
    return false;
  }
}

function _routePath(route) {
  return String(route || "").split("?")[0].split("#")[0];
}

function _windowTitle(route) {
  if (isExternalRoute(route)) {
    let host = "Site";
    try {
      host = new URL(route).hostname;
    } catch {
      /* rota malformada: o nome segue genérico */
    }
    return `${host} — LouvorJA Violin`;
  }
  const path = _routePath(route);
  const role = path === "/operator"
    ? "Operador"
    : path === "/clock" || path.includes("return")
      ? "Retorno"
      : "Projeção";
  return `${role} — LouvorJA Violin`;
}

function _isProjectionPresentationWindow(route, feature) {
  /*
   * O site não tem rota `/projection/*`: ele é reconhecido pela feature, do
   * mesmo jeito que `musicas` e `retorno`. O valor é o literal porque este
   * arquivo é CJS do main e não importa os tipos do renderer. A janela de
   * retorno conta a mesma: é a mesma URL no monitor do palco.
   */
  if (feature === "site" || feature === "site_return") return true;
  const path = _routePath(route);
  return (
    path === "/projection" ||
    path.startsWith("/projection/") ||
    feature === "musicas" ||
    feature === "retorno"
  );
}

/**
 * Reuso com OUTRA rota → recarrega a janela.
 *
 * Sem isto a janela mostrava a URL ANTIGA: `openSiteWindow` abria o design B e
 * o telão seguia no A, sem erro nenhum. A comparação é pela `route` guardada em
 * `_windowMeta` (e não pelo `getURL()`), porque em hash routing a URL do
 * documento não muda quando a rota muda.
 *
 * @returns {boolean} true quando recarregou
 */
function _garantirRota(feature, route, { devUrl, prodHtmlPath } = {}) {
  const meta = _windowMeta.get(feature);
  if (meta && meta.route === route) return false;
  const win = _openWindows.get(feature);
  if (!win || win.isDestroyed()) return false;
  const target = loadTargetFor(route, { devUrl, prodHtmlPath });
  if (target.kind === "none") return false;
  try {
    win.loadURL(target.url);
  } catch (e) {
    console.warn(`[windowFactory] recarga de ${feature} falhou:`, e?.message || e);
    return false;
  }
  if (meta) meta.route = route;
  else _windowMeta.set(feature, { route, feature });
  return true;
}

/**
 * Abrir esta feature vai CARREGAR — criar a janela ou trocar a rota.
 *
 * Enquanto devolver `true` a janela ainda NÃO está pronta: é o main quem usa
 * isso para não tratar uma recarga como "já carregada" e fechar o loader de
 * projeção de Site na hora em que ele mal apareceu.
 *
 * @param {string} feature
 * @param {string} route  rota/URL que vai ser aberta
 * @returns {boolean}
 */
function willLoad(feature, route) {
  const win = _openWindows.get(feature);
  if (!win || win.isDestroyed()) return true;
  const meta = _windowMeta.get(feature);
  return !meta || meta.route !== route;
}

/**
 * Cria uma BrowserWindow em um monitor específico, opcionalmente fullscreen.
 *
 * @param {object} options
 * @param {string} options.route           Ex: "/projection", "/operator"
 * @param {string} options.feature         Identificador único (chave em _openWindows e prefs)
 * @param {number} [options.monitorId]     ID do display Electron. Se omitido, usa preferência salva.
 * @param {boolean} [options.fullscreen=true]
 * @param {boolean} [options.frame=false]
 * @param {boolean} [options.showInTaskbar=true] Exibe a janela fullscreen na taskbar.
 * @param {number} [options.width]         Largura quando não fullscreen
 * @param {number} [options.height]        Altura quando não fullscreen
 * @param {string} options.preloadPath
 * @param {string} [options.devUrl]        Em dev: http://localhost:5002
 * @param {string} [options.prodHtmlPath]  Em prod: dist/index.html
 * @param {boolean|null} [options.devTools] Controle do DevTools automático (dev).
 *        null (default) → só com LJ_DEVTOOLS=1. true/false → override.
 * @returns {BrowserWindow|null} null quando abrir significaria ocupar a tela do
 *   operador no lugar do monitor configurado — ver o bloco de decisão abaixo.
 */
function _openOnMonitor({ route, feature, monitorId, fullscreen = true, frame = false, preloadPath, devUrl, prodHtmlPath, width, height, alwaysOnTop = false, showInTaskbar = true, devTools = null }) {
  // Se já existe janela para essa feature, mostra-a sem roubar o foco da main.
  //
  // Quando ela está escondida é porque o monitor dela sumiu e o `reconcile` a
  // recolheu. Aí não basta mostrar: sem decidir o destino de novo, a janela
  // reaparece onde o gerenciador a largou — a tela do operador. Era a sequência
  // real do culto: cabo cai, projeção some, o operador clica para projetar o
  // próximo e a letra abre em cima do trabalho dele.
  const existing = _openWindows.get(feature);
  if (existing && !existing.isDestroyed()) {
    /*
     * Navega ANTES de mostrar: se a URL mudou, mostrar a antiga e trocar
     * depois daria um quadro de conteúdo velho (aí coberto pelo loader, mas
     * ainda assim). Ver `_garantirRota`.
     */
    _garantirRota(feature, route, { devUrl, prodHtmlPath });
    if (existing.isVisible()) {
      existing.showInactive();
    } else {
      const alvo = _targetDisplay(feature, monitorId);
      if (!alvo) return null; // segue escondida
      _placeOnDisplay(existing, alvo, _windowMeta.get(feature) || {});
    }
    _syncAuxBackgroundThrottling(existing);
    _syncMainBackgroundThrottling();
    _syncPowerBlocker();
    _refocusMainWindow();
    return existing;
  }

  const target = _targetDisplay(feature, monitorId);
  if (!target) return null;

  const bounds = target.bounds;
  const isMac = process.platform === "darwin";
  const isWin = process.platform === "win32";
  const isLin = process.platform === "linux";
  /*
   * URL externa (item Site da liturgia): a janela vira uma janela de navegação,
   * e não uma janela do app.
   */
  const isExternal = isExternalRoute(route);
  const useMacPrimaryKiosk = fullscreen && isMac && !!target.primary && !backgroundWindows;
  const useMacPresentationLevel = fullscreen && isMac && _isProjectionPresentationWindow(route, feature) && !backgroundWindows;
  // O conteúdo precisa coincidir com o display: ampliar a janela para fora
  // da tela também corta a barra de progresso e outros elementos nas bordas.
  // roundedCorners:false remove a máscara sem alterar a área do renderer.

  // No Windows/Linux NÃO passar `fullscreen: true` no construtor com bounds
  // de monitor secundário: o Chromium frequentemente posiciona primeiro no
  // monitor primário e DEPOIS migra, deixando a janela "presa" no display
  // errado em alguns drivers de projetor. Estratégia mais determinística:
  // criar como borderless cobrindo os bounds exatos do display alvo, e em
  // ready-to-show aplicar setFullScreen(true). No macOS usamos `kiosk`
  // somente quando a projeção está no monitor principal, pois ali precisa
  // cobrir Dock/menu bar. Em monitores secundários, kiosk é agressivo demais
  // e pode deixar o app preso no modo apresentação.
  const useDeferredFullscreen = fullscreen && (isWin || isLin) && !backgroundWindows;
  const winOpts = {
    x: bounds.x,
    y: bounds.y,
    width: fullscreen ? bounds.width : (width || 800),
    height: fullscreen ? bounds.height : (height || 600),
    fullscreen: false,
    kiosk: useMacPrimaryKiosk,
    frame,
    alwaysOnTop: !backgroundWindows && alwaysOnTop && !(fullscreen && isMac),
    title: _windowTitle(route),
    show: false,
    autoHideMenuBar: true,
    roundedCorners: false, // macOS e Windows: cobre os cantos sem cortar o conteúdo.
    // Preto evita o flash branco entre criar a janela e o renderer pintar o primeiro frame.
    backgroundColor: "#000000",
    transparent: false,
    hasShadow: false,
    // Fullscreen continua acima de tudo, mas pode permanecer visível na barra
    // de tarefas para o operador localizar/fechar a janela pelo Windows.
    skipTaskbar: _shouldSkipTaskbar({ fullscreen, showInTaskbar }),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      /*
       * A rota decide o que é seguro: a janela externa NÃO recebe o preload do
       * app — ele expõe `louvorjaApi` sem gate de origem (userStore, windows,
       * httpServer), e qualquer site abriria com acesso a tudo — e sai da
       * sessão do app, porque o CSP que `main.cjs` injeta via webRequest na
       * defaultSession também caía nas respostas do site e bloqueava o script
       * e o stylesheet dele.
       */
      ...webPreferencesFor(route, { preloadPath }),
      // A janela é criada oculta; os listeners de show/hide/minimize/restore
      // alternam isso para true enquanto ela não estiver sendo apresentada.
      backgroundThrottling: false,
      // Garante que o renderer pinte antes da gente chamar show()
      paintWhenInitiallyHidden: true,
    },
  };

  const win = _operationMeasurer("window.construct", { feature }, () => new BrowserWindow(winOpts));
  if (isWin) {
    // O título do HTML é igual em todas as rotas. Preserve no preview da
    // taskbar o papel de cada janela, mesmo após o renderer atualizar <title>.
    win.on("page-title-updated", (event) => event.preventDefault());
  }
  prepareWindow(win);
  attachEditContextMenu(win, Menu);
  // O espelho nasce mudo: as duas janelas carregam a MESMA URL e o som tem que
  // sair do telão, onde a congregação está — duas saídas do mesmo site dariam
  // eco. `setAudioMuted` é chamada do webContents: não depende de preload nem
  // de o renderer carregar.
  if (feature === "site_return") win.webContents.setAudioMuted(true);
  /*
   * A tela de loading nasce ACIMA da janela externa que ela cobre. As duas
   * ocupam o mesmo monitor em tela cheia, e a de Site é mostrada depois (no
   * `did-finish-load`), o que já a colocaria por cima do loader — que ficaria
   * invisível justamente enquanto precisa esconder a página chegando.
   *
   * Nível "screen-saver" porque é o mais alto que o Electron tem: no Windows
   * ele é o mesmo que o `showOnce` aplica a qualquer janela fullscreen, então
   * só um nível acima vence o empate.
   */
  if (SITE_LOADER_FEATURES.includes(feature)) {
    try {
      win.setAlwaysOnTop(true, "screen-saver");
    } catch (_) {
      /* ignore */
    }
  }
  const windowMeta = {
    route,
    feature,
    fullscreen,
    alwaysOnTop,
    showInTaskbar,
    useDeferredFullscreen,
    useMacPresentationLevel,
  };
  _windowMeta.set(feature, windowMeta);
  try {
    _windowObserver?.(win, {
      window_role: "auxiliary",
      feature,
      route: _routePath(route),
    });
  } catch (error) {
    console.warn(`[windowFactory] observador de ${feature} falhou:`, error?.message || error);
  }

  const syncWindowActivity = () => {
    _syncAuxBackgroundThrottling(win);
    _syncMainBackgroundThrottling();
    _syncPowerBlocker();
  };
  win.on("show", syncWindowActivity);
  win.on("hide", syncWindowActivity);
  win.on("minimize", syncWindowActivity);
  win.on("restore", syncWindowActivity);
  _syncAuxBackgroundThrottling(win);

  // Em modo dev, abre DevTools automaticamente em janelas de projeção/operador.
  // Em janelas fullscreen o atalho Ctrl+Shift+I pode não chegar até a página,
  // então a forma mais confiável de inspecionar é abrir aqui — mas sob pedido,
  // não por padrão: em dev cada projeção aberta trazia um console junto.
  // Liga-se pela tela "Opções do Desenvolvedor" (options.dev.devtools_projections,
  // que o main.cjs passa em `devTools`), por LJ_DEVTOOLS=1 ou pelo atalho abaixo.
  const _openDevTools = devTools != null ? !!devTools : process.env.LJ_DEVTOOLS === "1";
  if (_openDevTools) {
    win.webContents.once("did-finish-load", () => {
      try { win.webContents.openDevTools({ mode: "detach" }); } catch (_) { /* ignore */ }
    });
  }

  // Atalho de emergência: Cmd/Ctrl+Shift+D abre/fecha DevTools antes de chegar
  // na página, via webContents.before-input-event.
  win.webContents.on("before-input-event", (_e, input) => {
    if (input.type !== "keyDown") return;
    const isToggleDevTools =
      (input.control || input.meta) && input.shift && input.key.toLowerCase() === "d";
    if (isToggleDevTools) {
      try {
        if (win.webContents.isDevToolsOpened()) win.webContents.closeDevTools();
        else win.webContents.openDevTools({ mode: "detach" });
      } catch (_) { /* ignore */ }
    }
  });

  // Bloqueia zoom acidental (Ctrl+Wheel/Ctrl+= ) em janelas de projeção —
  // num projetor mal manuseado um Ctrl+roda pode mexer no fontSize.
  try {
    win.webContents.setVisualZoomLevelLimits(1, 1);
  } catch (_) { /* electron <17 */ }
  win.webContents.on("did-finish-load", () => {
    try { win.webContents.setZoomFactor(1); } catch (_) { /* ignore */ }
  });

  /*
   * Empurrão de ponteiro para a janela de URL externa.
   *
   * Sites como o Canva escondem os controles da apresentação por inatividade
   * de ponteiro, e o timer dessa inatividade só COMEÇA quando o site vê um
   * evento de ponteiro. Nenhuma janela nossa entrega um: o app não injeta
   * mouse em lugar nenhum (o único input injetado é teclado, e só quando o
   * operador aperta — `windows:sendKey`), e no macOS o cursor do kiosk está
   * escondido (`kiosk: useMacPrimaryKiosk`). O sintoma era reproduzível: os
   * controles ficavam visíveis para sempre até alguém mover o mouse dentro da
   * janela e retirar — só aí o ciclo rodava e eles sumiam sozinhos.
   *
   * `sendInputEvent` e não `executeJavaScript` com `new MouseEvent`: o
   * sintético nasce com `isTrusted: false` e o Chromium não executa
   * comportamento padrão com ele. É a mesma razão pela qual as teclas desta
   * janela passaram a usar `sendInputEvent` — medido nesta mesma janela. Aqui
   * ele entra na fila de entrada real, como se alguém tivesse movido o mouse.
   *
   * Centro, e não canto ou borda: os controles do Canva ficam nas bordas, e
   * passar o ponteiro por eles abriria menu ou tooltip. O centro é o ponto
   * neutro de uma apresentação.
   *
   * `did-finish-load` + folga: antes disso a página pode ainda estar montando
   * a própria sequência inicial, e o empurrão passaria por cima dela.
   *
   * `getContentBounds`: as coordenadas do `sendInputEvent` são do conteúdo
   * (webContents), não da janela.
   *
   * Um empurrão, não um controle: se o site tiver autoplay ou timer, ele
   * continua dono do próprio ciclo. É `once` — se o site reexibir controles
   * depois de navegar internamente, não há novo empurrão.
   */
  if (isExternal) {
    const SITE_POINTER_NUDGE_MS = 1200;
    /*
     * `on`, não `once`: a janela externa agora PODE recarregar (reuso com
     * outra URL), e cada carga completa é uma página nova que nunca viu um
     * ponteiro. `did-finish-load` não dispara em navegação in-page, então o
     * empurrão continua acontecendo uma vez por carga e não por troca de rota.
     */
    win.webContents.on("did-finish-load", () => {
      setTimeout(() => {
        if (win.isDestroyed()) return;
        try {
          const { width, height } = win.getContentBounds();
          win.webContents.sendInputEvent({
            type: "mouseMove",
            x: Math.round(width / 2),
            y: Math.round(height / 2),
          });
        } catch (_) {
          /* a página navegou e não existe mais neste webContents */
        }
      }, SITE_POINTER_NUDGE_MS);
    });
  }

  // setVisibleOnAllWorkspaces transforma o tipo do processo (UIElement),
  // o que ESCONDE o ícone do dock. Não usar.

  // Aplica fullscreen "borderless" no Windows/Linux DEPOIS da janela já
  // estar posicionada no monitor correto. Esta sequência é defensiva
  // contra drivers de projetor que demoram a "settle".
  function _applyDeferredFullscreen() {
    if (!useDeferredFullscreen || win.isDestroyed()) return;
    try {
      // Reforça posição/tamanho ANTES do fullscreen — alguns drivers de
      // projetor mexem nos bounds entre a criação e o primeiro paint.
      _operationMeasurer("window.position", { feature }, () => win.setBounds({
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
      }));
      win.setMenuBarVisibility(false);
      // setFullScreen(true) no Windows = borderless windowed cobrindo o monitor
      // (incluindo a taskbar). Mais previsível que mudar resolução.
      if (!win.isFullScreen()) _operationMeasurer("window.fullscreen", { feature }, () => win.setFullScreen(true));
    } catch (e) {
      console.warn(`[windowFactory] applyDeferredFullscreen ${feature}:`, e?.message || e);
    }
  }

  // Esperamos o primeiro paint do renderer antes de mostrar a janela —
  // assim ela nunca aparece "branca". `did-finish-load` é mais confiável
  // que `ready-to-show` para evitar flash em rotas com fonts/images grandes.
  let _shown = false;
  const showOnce = () => {
    if (_shown || win.isDestroyed()) return;
    _shown = true;
    _operationMeasurer("window.show", { feature }, () => win.showInactive());
    /*
     * No MESMO turno do `showInactive`: esperar o evento `show` dava quadros
     * do Canva por cima antes do empurrão chegar.
     */
    if (isExternal) _trazerLoadersAoTopo();
    _syncAuxBackgroundThrottling(win);
    _syncMainBackgroundThrottling();
    _applyDeferredFullscreen();
    if (SITE_LOADER_FEATURES.includes(feature)) {
      /* Nunca rebaixa: ver o comentário do mesmo nível junto à criação. */
      try { win.setAlwaysOnTop(true, "screen-saver"); } catch (_) { /* ignore */ }
    } else if (!backgroundWindows && fullscreen && (isWin || isLin)) {
      // No Windows o "always on top: screen-saver" é o único nível que
      // garante cobertura da taskbar quando o usuário marcou "Manter
      // barra de tarefas sempre visível". Em fullscreen real isso já é
      // o caso, mas alguns drivers de projetor perdem esse z-order ao
      // ressincronizar — força aqui.
      try { win.setAlwaysOnTop(true, "screen-saver"); } catch (_) { /* ignore */ }
    } else if (!backgroundWindows && useMacPresentationLevel) {
      // macOS desenha a menu bar acima de janelas normais, mesmo borderless.
      // Para janelas de projeção precisamos cobrir essa área no monitor projetado.
      try { win.setAlwaysOnTop(true, "screen-saver"); } catch (_) { /* ignore */ }
    } else if (!backgroundWindows && alwaysOnTop && !(fullscreen && isMac)) {
      win.setAlwaysOnTop(true, "pop-up-menu");
    }
    // Não roubar foco do main window — `showInactive` já fez isso.
    // O operador navega pela janela principal (setas da Bíblia, atalhos);
    // a projeção apenas exibe e recebe estado via BroadcastChannel.
    _refocusMainWindow();
  };
  win.webContents.once("did-finish-load", showOnce);
  win.once("ready-to-show", showOnce);

  // Native/user close (including Escape and macOS kiosk exit) must reserve
  // this feature too. A new open cannot reuse a BrowserWindow mid-close.
  win.on("close", () => { void _windowCloseGate.observeClose(feature, win); });

  // Esc fecha a janela fullscreen no macOS como saída de emergência.
  if (fullscreen && isMac) {
    win.webContents.on("before-input-event", (_e, input) => {
      if (input.type === "keyDown" && input.key === "Escape") {
        win.close();
      }
    });
  }

  // Defesa para macOS: quando a projeção do monitor principal usa kiosk, sai
  // desse modo antes de destruir a janela. Fechar a NSWindow ainda em kiosk
  // pode deixar Dock/menu bar escondidos enquanto o LouvorJA estiver em foco.
  if (fullscreen && isMac) {
    let closingAfterKioskExit = false;
    win.on("close", (event) => {
      if (useMacPrimaryKiosk && !closingAfterKioskExit && win.isKiosk && win.isKiosk()) {
        event.preventDefault();
        closingAfterKioskExit = true;
        try { win.setAlwaysOnTop(false); } catch (_) { /* ignore */ }
        try { win.setKiosk(false); } catch (_) { /* ignore */ }
        setTimeout(() => {
          if (!win.isDestroyed()) win.close();
        }, 120);
        return;
      }
      try { win.setAlwaysOnTop(false); } catch (_) { /* ignore */ }
      try { if (win.isKiosk && win.isKiosk()) win.setKiosk(false); } catch (_) { /* ignore */ }
      try { if (win.isFullScreen && win.isFullScreen()) win.setFullScreen(false); } catch (_) { /* ignore */ }
    });
  }

  win.on("closed", () => {
    _openWindows.delete(feature);
    _windowMeta.delete(feature);
    _syncMainBackgroundThrottling();
    _syncPowerBlocker();
    if (useMacPrimaryKiosk && app.dock && typeof app.dock.show === "function") {
      setTimeout(() => {
        try { app.dock.show(); } catch (_) { /* ignore */ }
      }, 200);
    }
  });

  /*
   * Carregar URL com route — a rota interna ou a URL externa do item Site.
   * `target` já nomeia o display; o alvo do load é outro nome.
   */
  const loadTarget = loadTargetFor(route, { devUrl, prodHtmlPath });
  if (isExternal) {
    /*
     * Uma janela de projeção que sai do site do operador para onde o site
     * quiser não é uma projeção: só http segue navegando, popup novo não nasce
     * (muitos sites abrem banner) e `file:`/`javascript:` não passam.
     */
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", (event, url) => {
      if (!/^https?:\/\//i.test(url)) event.preventDefault();
    });
    /*
     * Cadeia de redirecionamento do frame principal, para quem quiser saber
     * onde a projeção parou (a tela de login do Canva, por exemplo). In-Page
     * também: SPA troca a rota sem recarregar.
     */
    if (_siteNavigationListener) {
      const avisar = (url) => {
        try {
          _siteNavigationListener(win, { feature, url: String(url || "") });
        } catch (err) {
          console.warn("[windowFactory] siteNavigationListener:", err?.message || err);
        }
      };
      win.webContents.on("did-navigate", (_event, url) => avisar(url));
      win.webContents.on("did-navigate-in-page", (_event, url) => avisar(url));
    }
    if (_siteReadyListener) {
      win.webContents.on("did-finish-load", () => {
        try {
          _siteReadyListener(win, { feature, url: String(win.webContents.getURL() || route || "") });
        } catch (err) {
          console.warn("[windowFactory] siteReadyListener:", err?.message || err);
        }
      });
    }
    /*
     * Restauração posterior (reconcile de monitores, reabertura): de novo o
     * loader é quem tem que ficar por cima.
     */
    win.on("show", () => _trazerLoadersAoTopo());
  }
  /*
   * A tela de loading nasce VISÍVEL, antes de qualquer carga.
   *
   * A ordem de CRIAÇÃO já estava certa (o loader é aberto antes da janela de
   * Site), mas a de APARECER dependia de cada janela pintar — e a SPA do app
   * pode pintar DEPOIS da página externa, que aí aparecia sozinha por alguns
   * milissegundos. Mostrar aqui dentro da criação vira garantia por
   * construção: quando `windows:open` devolve ao renderer, o loader já está
   * na tela e só então a janela externa é criada.
   *
   * Sem flash branco: a janela nasce com `backgroundColor #000` e o
   * `index.html` linka primeiro o `boot.css`, que faz `body { background:#000 }`.
   */
  if (SITE_LOADER_FEATURES.includes(feature)) showOnce();

  if (loadTarget.kind !== "none") {
    win.loadURL(loadTarget.url);
  }

  _openWindows.set(feature, win);
  _syncAuxBackgroundThrottling(win);
  _syncMainBackgroundThrottling();
  _syncPowerBlocker();
  return win;
}

/** A new owner must not reuse a feature while its previous window is closing. */
function openOnMonitor(options) {
  return _windowCloseGate.beforeOpen(options.feature).then((closed) => {
    // A timeout is not permission to reuse a window that may still be closing.
    // Fail this attempt; once `closed` arrives a later owner can open cleanly.
    return closed ? _operationMeasurer("window.open", { feature: options.feature }, () => _openOnMonitor(options)) : { refused: "window-close-pending" };
  });
}

/**
 * Impede a tela de apagar enquanto existir apresentação visível em tela cheia.
 *
 * Um culto passa longos trechos sem ninguém tocar em teclado ou mouse — um
 * slide fica no ar o hino inteiro. O descanso de tela do sistema conta esse
 * tempo como ociosidade e apaga o projetor no meio da projeção; o GNOME ainda
 * bloqueia a sessão em seguida. O Chromium só inibe isso por conta própria
 * enquanto há vídeo tocando, o que não cobre slide nem versículo.
 */
function _syncPowerBlocker() {
  const anyPresentationVisible = Array.from(_openWindows.entries()).some(([feature, win]) => {
    const meta = _windowMeta.get(feature) || {};
    return meta.fullscreen === true && _isWindowActive(win);
  });
  try {
    if (anyPresentationVisible) powerBlocker.start();
    else powerBlocker.stop();
  } catch (e) {
    console.warn("[windowFactory] powerBlocker:", e?.message || e);
  }
}

/**
 * Coloca uma janela num display, usando os bounds ATUAIS dele.
 *
 * Reler os bounds importa: um projetor que renegocia 1080p→720p muda de
 * tamanho, e reposicionar pelo valor capturado na abertura deixaria a janela
 * maior que a tela.
 */
function _placeOnDisplay(win, display, meta) {
  const isLin = process.platform === "linux";

  const apply = () => {
    if (!win || win.isDestroyed()) return;
    const bounds = display.bounds;

    try {
      if (win.isFullScreen && win.isFullScreen()) win.setFullScreen(false);

      if (meta.fullscreen) {
        win.setBounds({
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
        });
      } else {
        // Janela comum (operador): só muda de monitor, mantendo o tamanho que o
        // usuário deixou. Esticá-la para cobrir a tela seria uma regressão.
        const current = win.getBounds();
        const width = Math.min(current.width, bounds.width);
        const height = Math.min(current.height, bounds.height);
        win.setBounds({
          x: bounds.x + Math.round((bounds.width - width) / 2),
          y: bounds.y + Math.round((bounds.height - height) / 2),
          width,
          height,
        });
      }
      if (!win.isVisible()) win.showInactive();

      const goFullscreen = () => {
        if (!win || win.isDestroyed()) return;
        try {
          win.setMenuBarVisibility(false);
          if (!win.isFullScreen()) win.setFullScreen(true);
          win.setAlwaysOnTop(true, "screen-saver");
        } catch (e) {
          console.warn("[windowFactory] Falha ao aplicar fullscreen:", e?.message || e);
        }
      };

      if (meta.useDeferredFullscreen) {
        // No X11 a geometria também chega ao WM de forma assíncrona: pedir
        // fullscreen no mesmo tick do setBounds faz o WM usar a posição antiga
        // e cobrir o monitor errado.
        if (isLin) setTimeout(goFullscreen, 80);
        else goFullscreen();
      } else if (meta.useMacPresentationLevel) {
        win.setAlwaysOnTop(true, "screen-saver");
      }
      _refocusMainWindow();
    } catch (e) {
      console.warn("[windowFactory] Falha ao reposicionar janela:", e?.message || e);
    }
  };

  // Sair do fullscreen no X11 é assíncrono: o WM só solta a janela alguns
  // frames depois. Um setBounds enviado no mesmo tick é descartado e a
  // projeção volta para o monitor de onde saiu — foi assim que trocar o
  // monitor da projeção não surtia efeito no Linux.
  if (isLin && win && !win.isDestroyed() && win.isFullScreen && win.isFullScreen()) {
    let done = false;
    const proceed = () => {
      if (done) return;
      done = true;
      setTimeout(apply, 60);
    };
    win.once("leave-full-screen", proceed);
    // Rede de segurança: se o WM não emitir o evento, seguimos assim mesmo.
    setTimeout(proceed, 400);
    try {
      win.setFullScreen(false);
    } catch (_) {
      proceed();
    }
    return;
  }

  apply();
}

/**
 * Reconcilia as janelas abertas com os monitores atuais.
 *
 * Janela cujo monitor sumiu é ESCONDIDA, não fechada nem movida: fechar perde o
 * slide/versículo/cronômetro em andamento, e mover jogaria a projeção na tela
 * do operador no meio do culto. Quando o monitor volta, ela reaparece sozinha.
 *
 * @param {(feature: string) => object|null} resolveDisplay
 * @returns {{shown: string[], hidden: string[]}}
 */
function reconcile(resolveDisplay) {
  const shown = [];
  const hidden = [];

  for (const [feature, win] of Array.from(_openWindows.entries())) {
    if (!win || win.isDestroyed()) {
      _openWindows.delete(feature);
      _windowMeta.delete(feature);
      continue;
    }
    const meta = _windowMeta.get(feature) || {};
    let display = null;
    try {
      display = resolveDisplay(feature);
    } catch (e) {
      console.warn(`[windowFactory] resolveDisplay(${feature}) falhou:`, e?.message || e);
    }

    if (!display) {
      if (win.isVisible()) {
        try { win.hide(); } catch (_) { /* ignore */ }
        hidden.push(feature);
      }
      _syncAuxBackgroundThrottling(win);
      continue;
    }

    const wasHidden = !win.isVisible();
    _placeOnDisplay(win, display, meta);
    _syncAuxBackgroundThrottling(win);
    if (wasHidden) shown.push(feature);
  }

  _syncMainBackgroundThrottling();
  _syncPowerBlocker();

  return { shown, hidden };
}

/**
 * Fecha a janela de uma feature, se existir.
 * @param {string} feature
 */
function close(feature) {
  const win = _openWindows.get(feature);
  return _windowCloseGate.close(feature, win, () => win.close());
}

/** Fecha todas as janelas auxiliares antes de um encerramento explícito. */
function closeAll() {
  for (const feature of listOpen()) close(feature);
}

/**
 * Lista features com janelas abertas.
 * @returns {string[]}
 */
function listOpen() {
  return Array.from(_openWindows.keys()).filter((k) => {
    const w = _openWindows.get(k);
    return w && !w.isDestroyed();
  });
}

/**
 * Retorna a BrowserWindow associada a uma feature (ou undefined).
 * @param {string} feature
 */
function getWindow(feature) {
  const w = _openWindows.get(feature);
  return w && !w.isDestroyed() ? w : null;
}

/** Aplica a preferência de visibilidade na barra às janelas já abertas. */
function setTaskbarVisibility(show) {
  const showInTaskbar = show === true;
  let updated = 0;
  for (const [feature, win] of _openWindows.entries()) {
    if (!win || win.isDestroyed()) continue;
    const meta = _windowMeta.get(feature) || {};
    meta.showInTaskbar = showInTaskbar;
    _windowMeta.set(feature, meta);
    try {
      win.setSkipTaskbar(_shouldSkipTaskbar(meta));
      updated += 1;
    } catch (error) {
      console.warn(`[windowFactory] Falha ao atualizar taskbar de ${feature}:`, error?.message || error);
    }
  }
  return { ok: true, updated };
}

function setHttpPort(port) {
  _httpPort = port;
}

module.exports = {
  openOnMonitor,
  close,
  closeAll,
  listOpen,
  getWindow,
  setMainWindow,
  setWindowObserver,
  setOperationMeasurer,
  setSiteNavigationListener,
  setSiteReadyListener,
  willLoad,
  setPresentationActivityObserver,
  setHttpPort,
  setTaskbarVisibility,
  reconcile,
};
