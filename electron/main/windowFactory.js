"use strict";

/**
 * windowFactory.js — Factory para criar BrowserWindows em monitores específicos (D4).
 *
 * Mantém referência das janelas abertas por feature para evitar duplicatas.
 * Integra com displays.js para persistir preferências de monitor por feature.
 */

const { app, BrowserWindow } = require("electron");
const displays = require("./displays.js");
const powerBlocker = require("./powerBlocker.js");

/** Mantém referência das janelas abertas por feature para evitar duplicatas */
const _openWindows = new Map();

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

function _isProjectionPresentationWindow(route, feature) {
  const path = _routePath(route);
  return (
    path === "/projection" ||
    path.startsWith("/projection/") ||
    feature === "musicas" ||
    feature === "retorno"
  );
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
function openOnMonitor({ route, feature, monitorId, fullscreen = true, frame = false, preloadPath, devUrl, prodHtmlPath, width, height, alwaysOnTop = false, showInTaskbar = true, devTools = null }) {
  // Se já existe janela para essa feature, mostra-a sem roubar o foco da main.
  //
  // Quando ela está escondida é porque o monitor dela sumiu e o `reconcile` a
  // recolheu. Aí não basta mostrar: sem decidir o destino de novo, a janela
  // reaparece onde o gerenciador a largou — a tela do operador. Era a sequência
  // real do culto: cabo cai, projeção some, o operador clica para projetar o
  // próximo e a letra abre em cima do trabalho dele.
  const existing = _openWindows.get(feature);
  if (existing && !existing.isDestroyed()) {
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
  const useMacPrimaryKiosk = fullscreen && isMac && !!target.primary;
  const useMacPresentationLevel = fullscreen && isMac && _isProjectionPresentationWindow(route, feature);
  // Em macOS Liquid Retina, o sistema pode aplicar máscara de cantos
  // arredondados na NSWindow, revelando o wallpaper nas bordas. Aumentamos a
  // janela alguns px para fora do display útil; os cantos arredondados ficam
  // fora da área visível e o conteúdo cobre 100% do que aparece.
  const overscan = fullscreen && isMac ? 24 : 0;

  // No Windows/Linux NÃO passar `fullscreen: true` no construtor com bounds
  // de monitor secundário: o Chromium frequentemente posiciona primeiro no
  // monitor primário e DEPOIS migra, deixando a janela "presa" no display
  // errado em alguns drivers de projetor. Estratégia mais determinística:
  // criar como borderless cobrindo os bounds exatos do display alvo, e em
  // ready-to-show aplicar setFullScreen(true). No macOS usamos `kiosk`
  // somente quando a projeção está no monitor principal, pois ali precisa
  // cobrir Dock/menu bar. Em monitores secundários, kiosk é agressivo demais
  // e pode deixar o app preso no modo apresentação.
  const useDeferredFullscreen = fullscreen && (isWin || isLin);
  const winOpts = {
    x: bounds.x - overscan,
    y: bounds.y - overscan,
    width: fullscreen ? bounds.width + overscan * 2 : (width || 800),
    height: fullscreen ? bounds.height + overscan * 2 : (height || 600),
    fullscreen: false,
    kiosk: useMacPrimaryKiosk,
    enableLargerThanScreen: fullscreen && isMac,
    frame,
    alwaysOnTop: alwaysOnTop && !(fullscreen && isMac),
    title: feature,
    show: false,
    autoHideMenuBar: true,
    roundedCorners: false, // Windows-only mas inofensivo nos demais
    // Preto evita o flash branco entre criar a janela e o renderer pintar o primeiro frame.
    backgroundColor: "#000000",
    transparent: false,
    hasShadow: false,
    // Fullscreen continua acima de tudo, mas pode permanecer visível na barra
    // de tarefas para o operador localizar/fechar a janela pelo Windows.
    skipTaskbar: _shouldSkipTaskbar({ fullscreen, showInTaskbar }),
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // A janela é criada oculta; os listeners de show/hide/minimize/restore
      // alternam isso para true enquanto ela não estiver sendo apresentada.
      backgroundThrottling: false,
      // Garante que o renderer pinte antes da gente chamar show()
      paintWhenInitiallyHidden: true,
    },
  };

  const win = new BrowserWindow(winOpts);
  const windowMeta = {
    route,
    feature,
    fullscreen,
    alwaysOnTop,
    showInTaskbar,
    useDeferredFullscreen,
    useMacPresentationLevel,
    isMac,
    overscan,
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

  if (fullscreen && isMac && overscan > 0) {
    // Reforça bounds expandidos depois do construtor.
    win.setBounds({
      x: bounds.x - overscan,
      y: bounds.y - overscan,
      width: bounds.width + overscan * 2,
      height: bounds.height + overscan * 2,
    });
  }

  // Bloqueia zoom acidental (Ctrl+Wheel/Ctrl+= ) em janelas de projeção —
  // num projetor mal manuseado um Ctrl+roda pode mexer no fontSize.
  try {
    win.webContents.setVisualZoomLevelLimits(1, 1);
  } catch (_) { /* electron <17 */ }
  win.webContents.on("did-finish-load", () => {
    try { win.webContents.setZoomFactor(1); } catch (_) { /* ignore */ }
  });

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
      win.setBounds({
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
      });
      win.setMenuBarVisibility(false);
      // setFullScreen(true) no Windows = borderless windowed cobrindo o monitor
      // (incluindo a taskbar). Mais previsível que mudar resolução.
      if (!win.isFullScreen()) win.setFullScreen(true);
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
    win.showInactive();
    _syncAuxBackgroundThrottling(win);
    _syncMainBackgroundThrottling();
    _applyDeferredFullscreen();
    if (fullscreen && (isWin || isLin)) {
      // No Windows o "always on top: screen-saver" é o único nível que
      // garante cobertura da taskbar quando o usuário marcou "Manter
      // barra de tarefas sempre visível". Em fullscreen real isso já é
      // o caso, mas alguns drivers de projetor perdem esse z-order ao
      // ressincronizar — força aqui.
      try { win.setAlwaysOnTop(true, "screen-saver"); } catch (_) { /* ignore */ }
    } else if (useMacPresentationLevel) {
      // macOS desenha a menu bar acima de janelas normais, mesmo borderless.
      // Para janelas de projeção precisamos cobrir essa área no monitor projetado.
      try { win.setAlwaysOnTop(true, "screen-saver"); } catch (_) { /* ignore */ }
    } else if (alwaysOnTop && !(fullscreen && isMac)) {
      win.setAlwaysOnTop(true, "pop-up-menu");
    }
    // Não roubar foco do main window — `showInactive` já fez isso.
    // O operador navega pela janela principal (setas da Bíblia, atalhos);
    // a projeção apenas exibe e recebe estado via BroadcastChannel.
    _refocusMainWindow();
  };
  win.webContents.once("did-finish-load", showOnce);
  win.once("ready-to-show", showOnce);

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

  // Carregar URL com route
  if (devUrl) {
    win.loadURL(`${devUrl}${route}`);
  } else if (prodHtmlPath) {
    // Em produção carrega via custom protocol louvorja://app — origem
    // real (não null), habilita BroadcastChannel inter-window, fetch
    // relativo e secure context. router em hash mode preserva a rota.
    const cleanRoute = route.startsWith("/") ? route : `/${route}`;
    win.loadURL(`louvorja://app/index.html#${cleanRoute}`);
  }

  _openWindows.set(feature, win);
  _syncAuxBackgroundThrottling(win);
  _syncMainBackgroundThrottling();
  _syncPowerBlocker();
  return win;
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
    const overscan = meta.fullscreen && meta.isMac ? meta.overscan || 0 : 0;

    try {
      if (win.isFullScreen && win.isFullScreen()) win.setFullScreen(false);

      if (meta.fullscreen) {
        win.setBounds({
          x: bounds.x - overscan,
          y: bounds.y - overscan,
          width: bounds.width + overscan * 2,
          height: bounds.height + overscan * 2,
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
  if (win && !win.isDestroyed()) {
    win.close();
  }
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
  setPresentationActivityObserver,
  setHttpPort,
  setTaskbarVisibility,
  reconcile,
};
