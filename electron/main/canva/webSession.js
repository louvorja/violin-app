"use strict";

/**
 * webSession.js — A sessão do SITE do Canva dentro do app.
 *
 * O token OAuth que o app guarda autentica a API (`api.canva.com/rest`) — é
 * por isso que a listagem funciona. O design, porém, abre pelo `view_url` em
 * `www.canva.com`, que autentica por COOKIE de sessão, e o OAuth aconteceu no
 * navegador do sistema: os cookies de lá não são nossos. Não existe endpoint
 * do Canva que troque um access token por uma sessão web.
 *
 * O conserto é dar ao site a sessão dele na MESMA partição da projeção
 * (`persist:lj-site`): o login é feito uma vez numa janela normal, fora da
 * projeção, e os cookies valem para a janela de URL e para a tela de retorno —
 * as duas compartilham a partição.
 *
 * ── Por que a verificação é por redirecionamento e não por cookie ──────────
 *
 * A primeira versão contava "cookies de sessão" na partição e descartava só os
 * de analytics. A home ANÔNIMA do Canva já grava `CDI`, `CL` e `_cfuvid`: o
 * probe devolvia `true` logo na primeira visita, a janela fechou sozinha antes
 * de o operador digitar qualquer coisa e o app anunciou "sessão ativada".
 *
 * Aqui manda o Canva: carregamos `https://www.canva.com/login/` na mesma
 * partição e vemos para onde ele nos manda. Logado, ele BOTA PARA FORA do
 * `/login/`; não logado, deixa a página de login em pé. Nada de adivinhar.
 */

const { BrowserWindow, session } = require("electron");
const { SITE_PARTITION, ehPaginaDeLogin, hostCanva } = require("../windowRoute.js");

/** Com a barra final: `/login` responde `301 → /login/`. */
const LOGIN_URL = "https://www.canva.com/login/";
/** Janela oculta tem redirecionamento em cadeia; espera assentar antes de ler. */
const SETTLE_MS = 700;
const TOTAL_TIMEOUT_MS = 8000;

/** Janela de login aberta, se houver — uma por vez. */
let _janelaLogin = null;

/**
 * Preferências da janela de login — as mesmas de uma janela externa de
 * projeção (`webPreferencesFor`): mesma partição, sem preload. Um site de
 * terceiro não pode herdar `louvorjaApi`.
 */
function webPreferences() {
  return { preload: undefined, sandbox: true, partition: SITE_PARTITION };
}

/**
 * Próxima ação do fluxo de login, dado o estado e a URL navegada.
 *
 * Pura de propósito: é o coração do "quando fechar a janela" e dá para
 * exercitar sem Electron. Os quatro casos:
 *
 * - `esperar`   — ainda no login (ou num hop de um desafio);
 * - `provar`    — fomos para fora do login SEM nunca ter visto a tela de login:
 *                 ou já estávamos logados, ou o Canva tirou a gente; decide o
 *                 desafio, nunca o chute;
 * - `desafiar`  — vimos o login e saímos dele: manda de volta para `/login/`;
 * - `sucesso`   — o desafio nos tirou de lá de novo → o Canva confirmou.
 *
 * @param {{viuLogin?: boolean, desafiando?: boolean, provando?: boolean}} estado
 * @param {string} url
 * @returns {{acao: "esperar" | "provar" | "desafiar" | "sucesso",
 *            viuLogin?: boolean, desafiando?: boolean}}
 */
function decidir(estado, url) {
  const viuLogin = estado?.viuLogin === true;
  const desafiando = estado?.desafiando === true;
  const provando = estado?.provando === true;

  /*
   * Fora do Canva não é assunto nosso. Em "Continue with Google" a navegação
   * vai para accounts.google.com — mandar o desafio nesse ponto derrubaria o
   * login do operador no meio.
   */
  if (!hostCanva(url)) return { acao: "esperar" };

  if (ehPaginaDeLogin(url)) {
    return { acao: "esperar", viuLogin: true, desafiando: false };
  }
  if (!viuLogin) {
    return { acao: provando ? "esperar" : "provar" };
  }
  if (desafiando) return { acao: "sucesso" };
  return { acao: "desafiar" };
}

function _semElectron(mensagem) {
  if (typeof BrowserWindow === "function") return null;
  return new Error(mensagem);
}

/**
 * Abre uma janela NORMAL (não a de projeção) no login do Canva.
 *
 * **Fecha sozinha quando o login é confirmado** — e a confirmação não é "a URL
 * saiu de `/login`" (foi isso que fechou a janela antes de o operador digitar
 * qualquer coisa). O sinal é um desafio: ao ver uma URL fora do login, o app
 * manda o navegador DE VOLTA para `/login/` e só aceita o sucesso se o Canva
 * nos tirar de lá de novo. Ele só bota para fora quem está logado.
 *
 * Se o operador fechar a janela antes disso, cai na conferência oculta
 * (`verificar()`) — mesmo veredito, caminho diferente.
 *
 * @returns {Promise<{ok: boolean, code: "ok" | "not_session" | "network"}>}
 */
function abrirLogin() {
  const problema = _semElectron("Janela de login do Canva indisponível.");
  if (problema) return Promise.reject(problema);

  /* Uma janela por vez: a anterior, se existir, sai antes de abrir outra. */
  fecharLogin();

  return new Promise((resolve) => {
    let resolvido = false;
    /** Já passamos por uma URL de login nesta tentativa. */
    let viuLogin = false;
    /** Um desafio (volta para `/login/`) está em voo. */
    let desafiando = false;
    /** Conferência oculta em andamento — evita abrir uma por navegação. */
    let provando = false;
    let win = null;

    const concluir = (resultado) => {
      if (resolvido) return;
      resolvido = true;
      resolve(resultado);
    };

    /* Confirma e fecha a janela do operador junto — o login acabou.
       `concluir` ANTES do `close`: senão o `closed` ainda vê `resolvido`
       falso e dispara a conferência oculta à toa, abrindo uma janela
       escondida sem necessidade. */
    const sucesso = () => {
      if (resolvido) return;
      concluir({ ok: true, code: "ok" });
      try {
        if (win && !win.isDestroyed()) win.close();
      } catch (_) {
        /* já fechada */
      }
    };

    win = new BrowserWindow({
      width: 1024,
      height: 800,
      minWidth: 720,
      minHeight: 560,
      title: "Canva — faça login no Canva",
      autoHideMenuBar: true,
      webPreferences: webPreferences(),
    });
    _janelaLogin = win;

    /* O operador fechou antes de a gente confirmar: confere com o desafio. */
    win.on("closed", () => {
      if (_janelaLogin === win) _janelaLogin = null;
      if (resolvido) return;
      void verificar().then(concluir);
    });

    const aoNavegar = (url) => {
      if (resolvido) return;

      const d = decidir({ viuLogin, desafiando, provando }, url);
      if (d.viuLogin !== undefined) viuLogin = d.viuLogin;
      if (d.desafiando !== undefined) desafiando = d.desafiando;

      if (d.acao === "sucesso") {
        sucesso();
        return;
      }
      if (d.acao === "desafiar") {
        desafiando = true;
        void win.loadURL(LOGIN_URL);
        return;
      }
      if (d.acao === "provar") {
        provando = true;
        void verificar().then((r) => {
          provando = false;
          if (r.ok) sucesso();
        });
      }
      /* "esperar": ainda no login — deixa o operador digitar. */
    };

    win.webContents.on("did-navigate", (_event, url) => aoNavegar(url));
    win.webContents.on("did-navigate-in-page", (_event, url) => aoNavegar(url));

    void win.loadURL(LOGIN_URL);
    win.focus();
  });
}

/** Fecha a janela de login, se houver (chamada ao abrir outra). */
function fecharLogin() {
  const win = _janelaLogin;
  _janelaLogin = null;
  if (!win || win.isDestroyed()) return;
  try {
    win.close();
  } catch (_) {
    /* já fechada */
  }
}

/**
 * Desafio autoritativo: abre `LOGIN_URL` oculta na mesma partição e lê onde o
 * Canva deixou.
 *
 * - logado → redireciona para fora do `/login/` → `ok`;
 * - não logado → a página de login fica → `not_session`;
 * - sem rede → `network` (nada de "não logado" para erro de conexão).
 *
 * @returns {Promise<{ok: boolean, code: "ok" | "not_session" | "network" | "unavailable"}>}
 */
function verificar() {
  const problema = _semElectron("Conferência de sessão indisponível.");
  if (problema) return Promise.resolve({ ok: false, code: "unavailable" });

  const win = new BrowserWindow({
    show: false,
    width: 800,
    height: 600,
    webPreferences: webPreferences(),
  });

  return new Promise((resolve) => {
    let ultimo = "";
    let assentar = null;
    let terminado = false;

    const destruir = () => {
      clearTimeout(geral);
      if (assentar) clearTimeout(assentar);
      try {
        win.destroy();
      } catch (_) {
        /* já destruída */
      }
    };

    const acabar = () => {
      if (terminado) return;
      terminado = true;
      destruir();
      if (!ultimo) {
        resolve({ ok: false, code: "network" });
        return;
      }
      const logado = !ehPaginaDeLogin(ultimo);
      resolve({ ok: logado, code: logado ? "ok" : "not_session" });
    };

    /* Rede caiu de verdade: isso NÃO é "não logado" — é não conseguir carregar. */
    const caiu = () => {
      if (terminado) return;
      terminado = true;
      destruir();
      resolve({ ok: false, code: "network" });
    };

    /* Cada salto zera o cronômetro: só lemos depois da cadeia parar. */
    const marcar = (url) => {
      ultimo = String(url || "");
      if (assentar) clearTimeout(assentar);
      assentar = setTimeout(acabar, SETTLE_MS);
    };

    const geral = setTimeout(acabar, TOTAL_TIMEOUT_MS);
    win.webContents.on("did-navigate", (_event, url) => marcar(url));
    win.webContents.on("did-navigate-in-page", (_event, url) => marcar(url));
    /*
     * Só o frame principal e nunca `-3` (ERR_ABORTED): o redirecionamento
     * cancela a navegação anterior e o `did-navigate` vem logo em seguida —
     * tratar isso como falha encerraria a conferência no meio do salto.
     */
    win.webContents.on(
      "did-fail-load",
      (_event, errorCode, _description, _validatedUrl, isMainFrame) => {
        if (!isMainFrame || errorCode === -3) return;
        caiu();
      }
    );

    void win.loadURL(LOGIN_URL);
  });
}

/**
 * Sai do SITE do Canva — apaga a sessão dele na partição da projeção.
 *
 * Não é o "Desconectar" da tela de Integrações: esse revoga o token da API no
 * Canva. Aqui só a sessão web sai, para trocar de conta ou forçar um login
 * novo antes do culto. O token da API continua valendo.
 *
 * Tudo escopado em `canva.com`: a partição é compartilhada com os Sites da
 * liturgia, e derrubar a sessão inteira apagaria um enquete que não tem nada a
 * ver com o Canva. São duas camadas por segurança — `clearStorageData` com
 * `origin` e a remoção cookie a cookie, porque domínio `.canva.com` e host
 * `www.canva.com` são filtrados de formas diferentes.
 *
 * @returns {Promise<{ok: boolean, code?: string, message?: string, removidos?: number}>}
 */
async function sairDoSite() {
  if (!session || typeof session.fromPartition !== "function") {
    return { ok: false, code: "unavailable", message: "Sessão do site indisponível." };
  }

  try {
    const ses = session.fromPartition(SITE_PARTITION);

    /* `Promise.resolve` porque a API antiga devolve void quando não há callback. */
    try {
      await Promise.resolve(ses.clearStorageData({ origin: "https://www.canva.com" }));
    } catch (_) {
      /* Sem `origin` ou sem suporte: a varredura abaixo dá conta. */
    }

    const visiveis = await ses.cookies.get({
      urls: ["https://canva.com", "https://www.canva.com"],
    });
    for (const cookie of visiveis) {
      const host = String(cookie.domain || ".canva.com").replace(/^\./, "");
      const url = `https://${host}${cookie.path || "/"}`;
      await ses.cookies.remove({ url, name: cookie.name });
    }
    return { ok: true, removidos: visiveis.length };
  } catch (err) {
    return { ok: false, code: "error", message: err?.message || String(err) };
  }
}

module.exports = {
  LOGIN_URL,
  SITE_PARTITION,
  abrirLogin,
  decidir,
  fecharLogin,
  sairDoSite,
  verificar,
  webPreferences,
};
