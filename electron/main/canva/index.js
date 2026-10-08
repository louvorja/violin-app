"use strict";

/**
 * index.js — Fachada do Canva para o `main.cjs`.
 *
 * TODA função pública devolve `{ ok }` em vez de lançar: o Electron repassa ao
 * renderer só `message`/`stack` de um Error, e aí o motivo ("porta ocupada",
 * "credenciais ausentes", "estado divergente") se perderia na tela de
 * Integrações. Aqui o código de erro sobrevive junto da mensagem.
 *
 * Nenhum retorno traz credencial ou token — só `hasCredentials`, `connected`
 * e o nome do perfil.
 */

const store = require("./store.js");
const auth = require("./auth.js");
const api = require("./api.js");
const cryptoBox = require("./crypto.js");
const callbackServer = require("./callbackServer.js");
const webSession = require("./webSession.js");
const present = require("./present.js");
const exporter = require("./export.js");

/*
 * Caminhos no `user_data` — espelho de `KEYS.OPTIONS.INTEGRATIONS.CANVA.*` em
 * src/constants/UserDataKeys.ts. Mudou lá, muda aqui.
 */
const PROFILE_PATH = "options.integrations.canva.profile";
const WEB_SESSION_PATH = "options.integrations.canva.web_session";

/** Devolutiva do main: persiste um valor no `_userDataMain` e avisa as janelas. */
let _setUserData = null;
/** Leitura do `_userDataMain` (somente o que é exibível). */
let _getUserData = null;

function configure({ setUserData, getUserData } = {}) {
  _setUserData = typeof setUserData === "function" ? setUserData : null;
  _getUserData = typeof getUserData === "function" ? getUserData : null;
}

function fail(code, message) {
  return { ok: false, code, message };
}

function wrap(err) {
  const code = typeof err?.code === "string" ? err.code : "unknown";
  const message = err?.message || String(err);
  console.warn(`[canva] ${code}: ${message}`);
  return fail(code, message);
}

function readProfile() {
  try {
    const value = _getUserData ? _walk(_getUserData(), PROFILE_PATH) : null;
    return typeof value === "string" ? value : "";
  } catch (_) {
    return "";
  }
}

function writeProfile(name) {
  try {
    _setUserData?.(PROFILE_PATH, name || "");
  } catch (err) {
    console.warn("[canva] Não foi possível gravar o perfil:", err?.message || err);
  }
}

/**
 * Selo da sessão do SITE — resultado da última conferência, não um palpite.
 *
 * Escrito só por `setWebSession`: o desafio de `webSession.verificar()` quando
 * dá certo, e o detector de parede de login da projeção quando dá errado.
 * @param {boolean} valor
 */
function setWebSession(valor) {
  try {
    _setUserData?.(WEB_SESSION_PATH, valor === true);
  } catch (err) {
    console.warn("[canva] Não foi possível gravar a sessão do site:", err?.message || err);
  }
}

function readWebSession() {
  try {
    return (_getUserData ? _walk(_getUserData(), WEB_SESSION_PATH) : null) === true;
  } catch (_) {
    return false;
  }
}

function _walk(obj, pathKey) {
  return String(pathKey)
    .split(".")
    .reduce((cur, key) => (cur == null ? cur : cur[key]), obj);
}

/**
 * Estado para a tela de Integrações. Nunca inclui segredo algum.
 *
 * `async` só para manter o contrato com o renderer (a leitura é síncrona).
 * `webSession` vem de `user_data` — o resultado do último desafio — porque
 * contar cookie de `www.canva.com` mentia: `CDI`/`CL`/`_cfuvid` existem para
 * qualquer visitante anônimo.
 */
async function status() {
  const base = {
    ok: true,
    available: true,
    hasCredentials: false,
    connected: false,
    encrypted: false,
    keyOk: true,
    /* Sessão do SITE (cookies da partição) — separada do token da API. */
    webSession: readWebSession(),
    /*
     * O token não tem o escopo do export: a tela avisa ANTES de o operador
     * clicar num design, em vez de esperar o 403 crudo do Canva.
     * `null` (token sem campo `scope`) não conta como faltando — quem manda é
     * o Canva, para não bloquear um token válido por engano.
     */
    requiresReconnect: auth.temEscopo("design:content:read") === false,
    profile: readProfile(),
    redirectUri: callbackServer.REDIRECT_URI,
    port: callbackServer.PORT,
    keyFile: "",
  };

  try {
    base.keyFile = cryptoBox.keyFile();
  } catch (err) {
    base.keyOk = false;
    base.error = err?.message || String(err);
  }

  try {
    const data = store.readAll();
    base.hasCredentials = Boolean(
      typeof data?.clientId === "string" && data.clientId &&
      typeof data?.clientSecret === "string" && data.clientSecret
    );
    base.connected = Boolean(data?.token?.access_token && data?.token?.refresh_token);

    const integridade = store.integrity();
    base.encrypted = integridade.present && integridade.readable;
    /* Arquivo presente mas indecifrável: a chave mudou ou o JSON foi tocado. */
    if (integridade.present && !integridade.readable) {
      base.keyOk = false;
      base.connected = false;
      base.error = "Cofre do Canva ilegível — informe as credenciais de novo.";
    }
  } catch (err) {
    base.keyOk = false;
    base.error = err?.message || String(err);
    console.warn(`[canva] status: ${base.error}`);
  }

  return base;
}

/**
 * Grava Client ID + Client Secret no cofre.
 *
 * Trocar as credenciais invalida o token emitido para o app anterior — apaga
 * junto, senão o "Conectar" seguinte misturaria contas.
 *
 * @param {{clientId?: unknown, clientSecret?: unknown}} payload
 */
async function setCredentials(payload) {
  const clientId = typeof payload?.clientId === "string" ? payload.clientId.trim() : "";
  const clientSecret =
    typeof payload?.clientSecret === "string" ? payload.clientSecret.trim() : "";

  if (!/^[A-Za-z0-9_.:-]{1,256}$/.test(clientId)) {
    return fail("invalid_client_id", "Client ID inválido.");
  }
  if (!clientSecret || clientSecret.length > 512) {
    return fail("invalid_client_secret", "Client Secret inválido.");
  }

  try {
    const hadToken = store.getToken() !== null;
    /* Nessa ordem e aguardadas: sem await o status seguinte leria o valor velho. */
    await store.setCredentials(clientId, clientSecret);
    if (hadToken) await store.setToken(null);
    return { ok: true, ...(await statusSummary()) };
  } catch (err) {
    return wrap(err);
  }
}

async function statusSummary() {
  const s = await status();
  return { hasCredentials: s.hasCredentials, connected: s.connected, encrypted: s.encrypted };
}

/** Abre o consentimento e conclui a troca. `openExternal` vem do main. */
async function connect(opts = {}) {
  try {
    const resultado = await auth.startConnect(opts);
    try {
      writeProfile((await api.getProfile()).name);
    } catch (err) {
      /* O token já está salvo: falhar o nome do perfil não pode desconectar. */
      console.warn(`[canva] perfil não consultado: ${err?.message || err}`);
    }
    return { ok: true, ...resultado, ...(await statusSummary()) };
  } catch (err) {
    return wrap(err);
  }
}

/**
 * Login no SITE do Canva, fora da projeção, na partição que a projeção usa.
 *
 * A janela NÃO fecha sozinha: fica aberta até o operador fechar, e é só então
 * que `verificar()` faz o desafio — carrega `/login/` na mesma partição e vê
 * se o Canva nos bota para fora. Gravar o selo antes de conferir foi o que
 * fez a versão anterior anunciar "sessão ativada" sem que ninguém tivesse
 * logado.
 */
async function webLogin() {
  try {
    const r = await webSession.abrirLogin();
    setWebSession(r.ok === true);
    if (r.ok) return { ok: true };
    if (r.code === "network") {
      return fail("web_login_network", "Não consegui conferir a sessão: verifique a conexão.");
    }
    if (r.code === "unavailable") {
      return fail("web_login_unavailable", "Conferência de sessão indisponível neste ambiente.");
    }
    return fail(
      "web_login_failed",
      "Não detectei a sessão do Canva — faça login e feche a janela, e tente de novo."
    );
  } catch (err) {
    setWebSession(false);
    return wrap(err);
  }
}

async function disconnect() {
  try {
    await auth.disconnect();
    writeProfile("");
    /* Sem conta, não há sessão de site a favorar. */
    setWebSession(false);
    return { ok: true };
  } catch (err) {
    return wrap(err);
  }
}

/**
 * Sai do SITE do Canva (cookies da partição da projeção).
 *
 * Distinto de `disconnect`: ali o token da API é revogado no Canva, aqui só a
 * sessão web sai. O selo é zerado junto — sem cookie não há design abrindo.
 */
async function webLogout() {
  try {
    const r = await webSession.sairDoSite();
    if (!r.ok) return r;
    setWebSession(false);
    return { ok: true, removidos: r.removidos };
  } catch (err) {
    return wrap(err);
  }
}

/**
 * Lista pastas (`folderId`) ou designs (`view: "designs"`).
 * @param {{folderId?: string, view?: string, ownership?: string,
 *          continuation?: string|null, limit?: number}} payload
 */
async function items(payload) {
  /* `null` ou string vindos do IPC não podem virar `payload.view` de um primitivo. */
  const p = payload && typeof payload === "object" ? payload : {};
  try {
    const list = p.view === "designs" ? await api.listDesigns(p) : await api.listFolderItems(p);
    return { ok: true, ...list };
  } catch (err) {
    return wrap(err);
  }
}

/** `view_url` novo a cada clique (o do Canva expira). */
async function designUrl(payload = {}) {
  try {
    return { ok: true, ...(await api.getDesignViewUrl(payload?.designId)) };
  } catch (err) {
    return wrap(err);
  }
}

/**
 * Tenta acionar o modo de apresentação na janela de projeção do Canva.
 * Melhor esforço: se não achar o botão, a projeção segue como está; nada falha aqui.
 * @param {Electron.BrowserWindow} win
 */
function tentarApresentar(win) {
  return present.tentarApresentar(win);
}

/**
 * Exporta o design como PDF e devolve o caminho local para projetar.
 *
 * É o caminho "Projetar como: PDF": usa o token da API, não precisa de sessão
 * web do Canva nem de gesto nenhum na página. Só retorna `{ok}` — o motivo
 * (`export_failed`, `export_timeout`, `canva_429`, …) chega à tela da aba.
 *
 * @param {{designId?: unknown}} payload
 * @param {{exportQuality?: unknown}} [opts] preferência vinda da tela de Integrações
 */
async function exportDesign(payload, opts = {}) {
  try {
    const designId = payload && typeof payload === "object" ? payload.designId : undefined;
    return await exporter.exportarPdf(designId, opts);
  } catch (err) {
    return wrap(err);
  }
}

module.exports = {
  PROFILE_PATH,
  WEB_SESSION_PATH,
  configure,
  status,
  setCredentials,
  setWebSession,
  connect,
  disconnect,
  webLogin,
  webLogout,
  items,
  designUrl,
  exportDesign,
  tentarApresentar,
};
