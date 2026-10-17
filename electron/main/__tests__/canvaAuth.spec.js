// @vitest-environment node
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "module";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import crypto from "node:crypto";

const require = createRequire(import.meta.url);

/* Caminho de dados num temporário — ver canvaStore.spec.js. */
const base = mkdtempSync(join(tmpdir(), "louvorja-canva-auth-"));
const caminhoPaths = require.resolve("../paths.js");
require.cache[caminhoPaths] = {
  id: caminhoPaths,
  filename: caminhoPaths,
  loaded: true,
  exports: { dataDir: () => base },
};

const store = require("../canva/store.js");
const callbackServer = require("../canva/callbackServer.js");
const auth = require("../canva/auth.js");

const realFetch = globalThis.fetch;

/** Roteia api.canva.com para uma resposta gravada e o resto para a rede real. */
function stubCanva(handler) {
  const chamadas = [];
  vi.stubGlobal("fetch", (input, init) => {
    const url = typeof input === "string" ? input : String(input?.url ?? input);
    if (url.startsWith(callbackServer.REDIRECT_URI.split("/auth")[0])) return realFetch(input, init);
    if (url.startsWith("https://api.canva.com")) {
      const { body, resposta } = handler(url, init);
      chamadas.push({ url, init, body });
      return Promise.resolve(
        new Response(JSON.stringify(resposta), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );
    }
    return realFetch(input, init);
  });
  return chamadas;
}

function paramsOf(init) {
  return new URLSearchParams(typeof init?.body === "string" ? init.body : "");
}

/**
 * Simula o usuário: o openExternal recebe a URL de consentimento, e dali
 * extraímos `state` e `redirect_uri` para devolver o código ao servidor local.
 */
function openExternalSimulando(callback) {
  return async (url) => {
    const u = new URL(url);
    const redirect = u.searchParams.get("redirect_uri");
    const state = u.searchParams.get("state");
    await realFetch(`${redirect}?code=CODIGO-AUTORIZADO&state=${encodeURIComponent(state)}`);
    if (callback) await callback(url);
  };
}

const TOKEN = {
  access_token: "ACESSO-NOVO",
  refresh_token: "REFRESH-NOVO",
  expires_in: 3600,
  token_type: "Bearer",
  scope: "folder:read design:meta:read profile:read",
};

beforeEach(async () => {
  await store.clear();
  await store.setCredentials("OC-TESTE-1", "cnvca_segredo_teste");
});

afterEach(() => {
  vi.unstubAllGlobals();
  callbackServer.stop();
});

afterAll(() => rmSync(base, { recursive: true, force: true }));

describe("PKCE", () => {
  it("code_challenge é sha256 do verifier em base64url", () => {
    const verifier = crypto.randomBytes(96).toString("base64url");
    const esperado = crypto.createHash("sha256").update(verifier).digest("base64url");
    expect(auth.codeChallenge(verifier)).toBe(esperado);
    expect(auth.codeChallenge(verifier)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("a URL de consentimento traz todos os parâmetros que o Canva exige", () => {
    const url = new URL(
      auth.authorizeUrl({
        clientId: "OC-TESTE-1",
        redirectUri: "http://127.0.0.1:5530/auth/canva",
        codeChallenge: "DESAFIO",
        state: "ESTADO",
      })
    );

    expect(url.origin + url.pathname).toBe("https://www.canva.com/api/oauth/authorize");
    expect(url.searchParams.get("code_challenge")).toBe("DESAFIO");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("OC-TESTE-1");
    expect(url.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:5530/auth/canva");
    expect(url.searchParams.get("state")).toBe("ESTADO");
    expect(url.searchParams.get("scope")).toBe(auth.SCOPES.join(" "));
    /*
     * Regressão: `design:content:read` (o do export) NÃO estava sendo pedido.
     * O portal define o que o app PODE pedir; o token recebe o que ESTA URL
     * pede — por isso só marcar a caixa no portal não resolvia.
     */
    expect(auth.SCOPES).toEqual([
      "folder:read",
      "design:content:read",
      "design:meta:read",
      "profile:read",
    ]);
    expect(url.searchParams.get("scope")).toContain("design:content:read");
  });

  describe("temEscopo — o que o token declara", () => {
    it("com o escopo concedido", async () => {
      await store.setToken({
        access_token: "A",
        refresh_token: "R",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        scope: "folder:read design:content:read profile:read",
      });
      expect(auth.temEscopo("design:content:read")).toBe(true);
      expect(auth.temEscopo("design:content:write")).toBe(false);
    });

    it("token antigo, sem o escopo: false (é o caso do reporte)", async () => {
      await store.setToken({
        access_token: "A",
        refresh_token: "R",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        scope: "folder:read design:meta:read profile:read",
      });
      expect(auth.temEscopo("design:content:read")).toBe(false);
    });

    it("token sem campo `scope` → null: quem manda é o Canva, não nós", async () => {
      await store.setToken({
        access_token: "A",
        refresh_token: "R",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      });
      expect(auth.temEscopo("design:content:read")).toBeNull();
    });

    it("scope vazio conta como desconhecido, não como concedido", async () => {
      /*
       * Regressão: o fallback era `|| SCOPES.join(" ")`, que fazia o token
       * PARECER ter os escopos da lista mesmo sem a API ter devolvido nada —
       * e uma guarda de escopo escrita em cima disso nunca dispararia.
       */
      await store.setToken({
        access_token: "A",
        refresh_token: "R",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        scope: "",
      });
      expect(auth.temEscopo("design:content:read")).toBeNull();
    });
  });

  it("verifier e state são distintos e não repetíveis", async () => {
    const chamadas = stubCanva(() => ({ resposta: TOKEN }));
    const urls = [];

    await auth.startConnect({
      port: 0,
      timeoutMs: 5000,
      openExternal: openExternalSimulando((url) => {
        urls.push(url);
      }),
    });

    expect(urls).toHaveLength(1);
    const u = new URL(urls[0]);
    expect(u.searchParams.get("code_challenge")).not.toBe(u.searchParams.get("state"));
    expect(u.searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]{100,}$/);
    expect(chamadas).toHaveLength(1);
  });
});

describe("fluxo completo de conexão", () => {
  it("troca o código por token com Basic auth e grava no cofre", async () => {
    const chamadas = stubCanva(() => ({ resposta: TOKEN }));
    let authorizeUrl = "";

    await auth.startConnect({
      port: 0,
      timeoutMs: 5000,
      openExternal: openExternalSimulando((url) => {
        authorizeUrl = url;
      }),
    });

    expect(chamadas).toHaveLength(1);
    const troca = chamadas[0];
    expect(troca.url).toBe(auth.TOKEN_URL);

    const body = paramsOf(troca.init);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("CODIGO-AUTORIZADO");
    expect(body.get("redirect_uri")).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/auth\/canva$/);

    /* O verifier enviado tem que ser aquele cujo hash está na URL de consentimento. */
    const verifier = body.get("code_verifier");
    expect(verifier).toBeTruthy();
    expect(auth.codeChallenge(verifier)).toBe(
      new URL(authorizeUrl).searchParams.get("code_challenge")
    );

    const esperado = Buffer.from("OC-TESTE-1:cnvca_segredo_teste").toString("base64");
    expect(troca.init.headers.Authorization).toBe(`Basic ${esperado}`);

    const salvo = store.getToken();
    expect(salvo.access_token).toBe("ACESSO-NOVO");
    expect(salvo.refresh_token).toBe("REFRESH-NOVO");
    expect(salvo.expires_at).toBeGreaterThan(Math.floor(Date.now() / 1000) + 3000);

    expect(callbackServer.busy()).toBe(false);
  });

  it("sem credenciais salvas, recusa antes de abrir o navegador", async () => {
    await store.clear();
    const open = vi.fn();

    await expect(auth.startConnect({ port: 0, openExternal: open })).rejects.toMatchObject({
      code: "no_credentials",
    });
    expect(open).not.toHaveBeenCalled();
    expect(callbackServer.busy()).toBe(false);
  });

  it("recusa uma segunda tentativa enquanto a primeira está em andamento", async () => {
    stubCanva(() => ({ resposta: TOKEN }));
    const primeira = auth.startConnect({ port: 0, timeoutMs: 400, openExternal: vi.fn() });

    await expect(auth.startConnect({ port: 0, openExternal: vi.fn() })).rejects.toMatchObject({
      code: "already_connecting",
    });

    await expect(primeira).rejects.toMatchObject({ code: "timeout" });
    expect(callbackServer.busy()).toBe(false);
  });

  it("state divergente não troca o código", async () => {
    stubCanva(() => ({ resposta: TOKEN }));
    const fluxo = auth.startConnect({
      port: 0,
      timeoutMs: 5000,
      openExternal: async (url) => {
        const u = new URL(url);
        const redirect = u.searchParams.get("redirect_uri");
        await realFetch(`${redirect}?code=XYZ&state=ESTADO-FALSO`);
      },
    });

    await expect(fluxo).rejects.toMatchObject({ code: "state_mismatch" });
    expect(store.getToken()).toBeNull();
    expect(callbackServer.busy()).toBe(false);
  });
});

describe("refresh silencioso", () => {
  it("renova quando perto de expirar e mantém o refresh antigo se o Canva não mandar outro", async () => {
    await store.setToken({
      access_token: "ACESSO-VELHO",
      refresh_token: "REFRESH-UNICO",
      expires_at: Math.floor(Date.now() / 1000) + 30,
    });

    const chamadas = stubCanva(() => ({
      resposta: { access_token: "ACESSO-NOVO", expires_in: 3600, token_type: "Bearer" },
    }));

    const token = await auth.getAccessToken();

    expect(token).toBe("ACESSO-NOVO");
    const body = paramsOf(chamadas[0].init);
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("REFRESH-UNICO");
    expect(store.getToken().refresh_token).toBe("REFRESH-UNICO");
    expect(store.getToken().access_token).toBe("ACESSO-NOVO");
  });

  it("não mexe num token que ainda tem tempo", async () => {
    await store.setToken({
      access_token: "ACESSO-BOM",
      refresh_token: "REFRESH-BOM",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    });
    stubCanva(() => ({ resposta: TOKEN }));

    expect(await auth.getAccessToken()).toBe("ACESSO-BOM");
  });

  it("sem refresh token, diz que não está conectado", async () => {
    await store.setToken({ access_token: "X", expires_at: 1 });
    stubCanva(() => ({ resposta: TOKEN }));

    await expect(auth.getAccessToken()).rejects.toMatchObject({ code: "not_connected" });
  });

  it("duas chamadas simultâneas renovam UMA vez só", async () => {
    await store.setToken({
      access_token: "ACESSO-VELHO",
      refresh_token: "REFRESH-UNICO",
      expires_at: Math.floor(Date.now() / 1000) - 10,
    });
    const chamadas = stubCanva(() => ({
      resposta: { access_token: "ACESSO-NOVO", expires_in: 3600 },
    }));

    const [a, b] = await Promise.all([auth.getAccessToken(), auth.getAccessToken()]);

    expect(a).toBe("ACESSO-NOVO");
    expect(b).toBe("ACESSO-NOVO");
    /* Renovar duas vezes gastaria/rotacionaria o refresh_token à toa. */
    expect(chamadas.filter((c) => c.url === auth.TOKEN_URL)).toHaveLength(1);
  });
});

describe("desconexão", () => {
  it("revoga a linhagem do refresh no Canva e limpa o cofre", async () => {
    await store.setToken({
      access_token: "ACESSO",
      refresh_token: "REFRESH-A-REVOGAR",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    });
    const chamadas = stubCanva(() => ({ resposta: {} }));

    await auth.disconnect();

    const revoke = chamadas.find((c) => c.url === auth.REVOKE_URL);
    expect(revoke).toBeTruthy();
    expect(paramsOf(revoke.init).get("token")).toBe("REFRESH-A-REVOGAR");
    expect(store.getCredentials()).toBeNull();
    expect(store.getToken()).toBeNull();
  });

  it("falha de rede na revogação não deixa o cofre preso", async () => {
    await store.setToken({ access_token: "A", refresh_token: "R", expires_at: 1 });
    vi.stubGlobal("fetch", () => Promise.reject(new Error("sem rede")));

    await expect(auth.disconnect()).resolves.toEqual({ ok: true });
    expect(store.getToken()).toBeNull();
  });
});
