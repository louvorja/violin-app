"use strict";

/**
 * auth.js — OAuth2 Authorization Code + PKCE do Canva.
 *
 * Fluxo completo no main process: nada disto roda no renderer, então o Client
 * Secret e o token nunca atravessam o contextBridge. Referência de implementação:
 * o starter kit oficial (`canva-sdks/canva-connect-api-starter-kit`) e o
 * `CanvaConnect` do FreeShow — mesmos parâmetros, mesma ordem de campos.
 *
 * `state` aleatório liga o retorno à tentativa em andamento (CSRF) e
 * `code_verifier`/`code_challenge` (S256) impedem que um código interceptado
 * seja trocado por outra pessoa: o verifier só existe neste processo.
 */

const crypto = require("crypto");
const store = require("./store.js");
const callbackServer = require("./callbackServer.js");

const AUTHORIZE_URL = "https://www.canva.com/api/oauth/authorize";
const TOKEN_URL = "https://api.canva.com/rest/v1/oauth/token";
const REVOKE_URL = "https://api.canva.com/rest/v1/oauth/revoke";

/*
 * Escopos somente leitura, pedidos na URL de consentimento. O portal define o
 * que o app PODE pedir; o que o token RECEBE vem do parâmetro `scope` desta
 * URL — por isso os dois têm que acompanhar.
 *
 * `design:content:read` é o do export (`POST /v1/exports` e
 * `GET /v1/exports/{id})`, e é o que faltava: o portal foi marcado, mas esta
 * lista nunca pediu, então nenhum token ganhava o escopo.
 *
 * Escopo só entra numa NOVA autorização: o refresh_token devolve o escopo do
 * grant original. Mudou a lista aqui → reconectar.
 */
const SCOPES = [
  "folder:read",
  "design:content:read",
  "design:meta:read",
  "profile:read",
];

/**
 * Escopos que o token atual declara, ou `null` quando não dá para saber.
 *
 * `null` importa: sem ele, uma guarda de escopo bloquearia um token válido por
 * engano (API que não devolve o campo `scope`). Nesses casos manda o Canva.
 * @returns {string[] | null}
 */
function escoposDoToken() {
  const scope = store.getToken()?.scope;
  if (typeof scope !== "string" || !scope.trim()) return null;
  return scope.split(/[\s,]+/).filter(Boolean);
}

/**
 * O token tem um escopo específico?
 * @param {string} alvo ex.: `"design:content:read"`
 * @returns {true | false | null} `null` = não dá para saber
 */
function temEscopo(alvo) {
  const escopos = escoposDoToken();
  if (!escopos) return null;
  return escopos.includes(alvo);
}

/** Troca o access token 10 min antes de expirar, como o starter kit. */
const REFRESH_LEEWAY_S = 600;
const REQUEST_TIMEOUT_MS = 15_000;

/** Tentativa de consentimento em andamento — uma por vez. */
let _flow = null;
/*
 * Renovação em andamento. Duas chamadas simultâneas (listagem + clique num
 * design, por exemplo) não podem renovar juntas: o Canva pode rotacionar o
 * refresh_token e a segunda usaria um já velho. Quem chega depois pega a
 * mesma promise; quem chega DEPOIS de ela terminar reencontra o token novo
 * na releitura dentro de `_renovar`.
 */
let _refreshEmAndamento = null;

function _random() {
  return crypto.randomBytes(96).toString("base64url");
}

function codeChallenge(verifier) {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

/** URL de consentimento — ordem de parâmetros igual ao starter kit. */
function authorizeUrl({ clientId, redirectUri, codeChallenge: challenge, state }) {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("scope", SCOPES.join(" "));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  return url.toString();
}

function _basicHeader() {
  const creds = store.getCredentials();
  if (!creds) {
    const err = new Error("Credenciais do Canva ausentes.");
    err.code = "no_credentials";
    throw err;
  }
  return `Basic ${Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString("base64")}`;
}

function _messageOf(body, status) {
  if (!body || typeof body !== "object") return `Erro ${status} do Canva.`;
  const text = body.error_description || body.message || body.error;
  if (typeof text === "string" && text) return text;
  return `Erro ${status} do Canva.`;
}

/** POST em form-urlencoded com o Client Auth que o Canva exige. */
async function _post(url, params) {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) body.set(key, String(value));
  }

  /* Antes do try: falta de credencial não é "sem resposta do Canva". */
  const authorization = _basicHeader();

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
        Authorization: authorization,
      },
      body: body.toString(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    const falha = new Error(`Sem resposta do Canva: ${err?.message || err}`);
    falha.code = "network";
    throw falha;
  }

  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const falha = new Error(_messageOf(json, res.status));
    falha.code = "canva_" + res.status;
    falha.status = res.status;
    throw falha;
  }
  return json || {};
}

/** Resposta de token → forma persistida, com expiração absoluta em segundos. */
function _toToken(payload, previous) {
  const expiresIn = Number(payload.expires_in);
  const token = {
    access_token: typeof payload.access_token === "string" ? payload.access_token : "",
    refresh_token:
      typeof payload.refresh_token === "string" && payload.refresh_token
        ? payload.refresh_token
        : previous?.refresh_token || "",
    token_type: typeof payload.token_type === "string" ? payload.token_type : "Bearer",
    /*
     * Sem `|| SCOPES`: afirmar os escopos da lista quando a API não devolveu
     * faria qualquer guarda de escopo enxergar um token "com tudo" que na
     * verdade não tem nada. Escopo desconhecido é melhor que escopo inventado.
     */
    scope: typeof payload.scope === "string" ? payload.scope : previous?.scope || "",
    expires_at:
      Number.isFinite(expiresIn) && expiresIn > 0
        ? Math.floor(Date.now() / 1000) + expiresIn
        : 0,
  };
  if (!token.access_token) {
    const err = new Error("O Canva devolveu um token vazio.");
    err.code = "empty_token";
    throw err;
  }
  return token;
}

/**
 * Abre o consentimento e conclui a troca de código por token.
 *
 * Mantém o invoke pendente até o usuário autorizar (ou o tempo acabar), para o
 * renderer mostrar "aguardando" sem polling.
 *
 * @param {{openExternal?: (url: string) => Promise<void> | void,
 *          timeoutMs?: number, port?: number}} [opts]
 * @returns {Promise<{ok: true}>}
 */
async function startConnect(opts = {}) {
  const creds = store.getCredentials();
  if (!creds) {
    const err = new Error("Informe o Client ID e o Client Secret antes de conectar.");
    err.code = "no_credentials";
    throw err;
  }
  if (_flow || callbackServer.busy()) {
    const err = new Error("Já há uma conexão do Canva em andamento.");
    err.code = "already_connecting";
    throw err;
  }

  const verifier = _random();
  const state = _random();
  _flow = { verifier, state };

  const open =
    opts.openExternal ||
    ((url) => require("electron").shell.openExternal(url));

  try {
    /*
     * A porta da produção é fixa (a que está registrada no portal); em teste
     * pode ser efêmera. O redirect_uri da ABERTURA e o da TROCA precisam ser
     * idênticos byte a byte — o Canva compara.
     */
    let redirect = callbackServer.REDIRECT_URI;

    const retorno = await callbackServer.start({
      timeoutMs: opts.timeoutMs,
      port: opts.port,
      /* Só depois do bind: o redirect tem que cair num servidor que já responde. */
      onListening: (boundPort) => {
        redirect = callbackServer.redirectUri(boundPort);
        return open(
          authorizeUrl({
            clientId: creds.clientId,
            redirectUri: redirect,
            codeChallenge: codeChallenge(verifier),
            state,
          })
        );
      },
    });

    if (retorno.state !== state) {
      const err = new Error("O retorno do Canva não corresponde a esta tentativa.");
      err.code = "state_mismatch";
      throw err;
    }

    const troca = await _post(TOKEN_URL, {
      grant_type: "authorization_code",
      code: retorno.code,
      redirect_uri: redirect,
      code_verifier: verifier,
    });
    await store.setToken(_toToken(troca));
    return { ok: true };
  } finally {
    _flow = null;
  }
}

/**
 * Renova e persiste o token. Releitura no início: se outra tentativa já
 * terminou enquanto esta era montada, o token novo é válido e não há nada a
 * renovar — é o que fecha a janela entre "li o token velho" e "comecei".
 */
async function _renovar() {
  const atual = store.getToken();
  const agora = Math.floor(Date.now() / 1000);

  if (atual?.access_token && atual.expires_at && agora < atual.expires_at - REFRESH_LEEWAY_S) {
    return atual.access_token;
  }
  if (!atual?.refresh_token) {
    const err = new Error("Canva não está conectado.");
    err.code = "not_connected";
    throw err;
  }

  const troca = await _post(TOKEN_URL, {
    grant_type: "refresh_token",
    refresh_token: atual.refresh_token,
  });
  await store.setToken(_toToken(troca, atual));
  return store.getToken()?.access_token || "";
}

/**
 * Access token válido, renovando em silêncio quando perto de expirar.
 * Devolve texto claro só para quem está dentro do main — nunca ao renderer.
 * @returns {Promise<string>}
 */
async function getAccessToken() {
  const token = store.getToken();
  const now = Math.floor(Date.now() / 1000);
  if (token?.access_token && token.expires_at && now < token.expires_at - REFRESH_LEEWAY_S) {
    return token.access_token;
  }
  if (!token?.refresh_token) {
    const err = new Error("Canva não está conectado.");
    err.code = "not_connected";
    throw err;
  }

  if (!_refreshEmAndamento) {
    _refreshEmAndamento = _renovar();
    /* Limpa nos dois sentidos; o handler rejeito impede rejection sem dono. */
    const limpar = () => {
      _refreshEmAndamento = null;
    };
    _refreshEmAndamento.then(limpar, limpar);
  }
  return _refreshEmAndamento;
}

/**
 * Desconecta de verdade: revoga a LINHAGEM do refresh token no Canva (é isso
 * que cancela o consentimento) e apaga o cofre local.
 *
 * Falha de rede na revogação não deixa o app preso — o cofre local é limpo de
 * qualquer forma, e o revoke no servidor pode ser refeito na próxima conexão.
 */
async function disconnect() {
  const token = store.getToken();
  if (token?.refresh_token) {
    try {
      await _post(REVOKE_URL, { token: token.refresh_token });
    } catch (err) {
      console.warn("[canva] Revogação remota falhou:", err?.message || err);
    }
  }
  await store.clear();
  return { ok: true };
}

module.exports = {
  SCOPES,
  AUTHORIZE_URL,
  TOKEN_URL,
  REVOKE_URL,
  REFRESH_LEEWAY_S,
  codeChallenge,
  authorizeUrl,
  escoposDoToken,
  temEscopo,
  startConnect,
  getAccessToken,
  disconnect,
};
