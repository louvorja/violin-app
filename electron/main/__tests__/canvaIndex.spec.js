// @vitest-environment node
import { afterAll, describe, expect, it, vi } from "vitest";
import { createRequire } from "module";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { KEYS } from "@/constants/UserDataKeys";

const require = createRequire(import.meta.url);

const base = mkdtempSync(join(tmpdir(), "louvorja-canva-index-"));
const caminhoPaths = require.resolve("../paths.js");
require.cache[caminhoPaths] = {
  id: caminhoPaths,
  filename: caminhoPaths,
  loaded: true,
  exports: { dataDir: () => base },
};

const store = require("../canva/store.js");
const index = require("../canva/index.js");

const SECRET = "cnvca_SEGREDO-QUE-NAO-PODE-VAZAR";

afterAll(() => rmSync(base, { recursive: true, force: true }));

describe("fachada — credenciais", () => {
  it("recusa payload malformado com código, sem lançar", async () => {
    expect(await index.setCredentials(null)).toMatchObject({
      ok: false,
      code: "invalid_client_id",
    });
    expect(await index.setCredentials({ clientId: "???", clientSecret: "x" })).toMatchObject({
      ok: false,
      code: "invalid_client_id",
    });
    expect(await index.setCredentials({ clientId: "OC-1", clientSecret: "" })).toMatchObject({
      ok: false,
      code: "invalid_client_secret",
    });
    expect(await index.setCredentials({ clientId: "OC-1", clientSecret: "x".repeat(600) })).toMatchObject({
      ok: false,
      code: "invalid_client_secret",
    });
    expect(store.getCredentials()).toBeNull();
  });

  it("o retorno nunca carrega o segredo", async () => {
    const resultado = await index.setCredentials({ clientId: "OC-1234", clientSecret: SECRET });

    expect(resultado.ok).toBe(true);
    expect(resultado.hasCredentials).toBe(true);
    expect(JSON.stringify(resultado)).not.toContain(SECRET);
    expect(JSON.stringify((await index.status()))).not.toContain(SECRET);
    /* No disco, não no cofre em memória: o arquivo tem que estar cifrado. */
    const emDisco = readFileSync(join(base, "storage", `${store.STORE_KEY}.json`), "utf8");
    expect(emDisco).not.toContain(SECRET);
  });

  it("trocar as credenciais derruba o token da tentativa anterior", async () => {
    await index.setCredentials({ clientId: "OC-velho", clientSecret: SECRET });
    await store.setToken({
      access_token: "ACESSO",
      refresh_token: "REFRESH",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    });
    expect((await index.status()).connected).toBe(true);

    await index.setCredentials({ clientId: "OC-novo", clientSecret: SECRET });

    expect((await index.status()).hasCredentials).toBe(true);
    expect((await index.status()).connected).toBe(false);
    expect(store.getToken()).toBeNull();
  });
});

describe("fachada — status", () => {
  it("espelha o caminho do perfil no user_data e não expõe segredo", async () => {
    /*
     * `_walkSet` do main cria a estrutura ANINHADA — é assim que o
     * `_walk` daqui caminha. Um dicionário plano não representa o real.
     */
    const user_data = { options: { integrations: { canva: { profile: "" } } } };
    index.configure({
      setUserData: (caminho, valor) => {
        const chaves = caminho.split(".");
        let atual = user_data;
        for (let i = 0; i < chaves.length - 1; i++) {
          atual = atual[chaves[i]] ||= {};
        }
        atual[chaves.at(-1)] = valor;
      },
      getUserData: () => user_data,
    });

    /* Espelho do renderer: se um dos dois mudar sozinho, este teste falha. */
    expect(index.PROFILE_PATH).toBe(KEYS.OPTIONS.INTEGRATIONS.CANVA.PROFILE);
    expect((await index.status()).profile).toBe("");

    await index.disconnect();
    expect(user_data.options.integrations.canva.profile).toBe("");

    index.configure({
      setUserData: () => {},
      getUserData: () => ({ options: { integrations: { canva: { profile: "Maria" } } } }),
    });
    expect((await index.status()).profile).toBe("Maria");

    const texto = JSON.stringify((await index.status()));
    expect(texto).not.toContain(SECRET);
    expect(texto).not.toContain("access_token");
    expect((await index.status())).toMatchObject({ ok: true, available: true, keyOk: true });
    /* O selo da sessão do SITE existe e não vaza nada — é booleano, não cookie. */
    expect(typeof (await index.status()).webSession).toBe("boolean");
  });

  it("o selo de sessão vem do user_data e o disconnect zera ele", async () => {
    const user_data = { options: { integrations: { canva: {} } } };
    const gravar = (caminho, valor) => {
      const chaves = caminho.split(".");
      let atual = user_data;
      for (let i = 0; i < chaves.length - 1; i++) atual = atual[chaves[i]] ||= {};
      atual[chaves.at(-1)] = valor;
    };
    index.configure({ setUserData: gravar, getUserData: () => user_data });

    /* Espelho do renderer — se um dos dois mudar sozinho, este teste falha. */
    expect(index.WEB_SESSION_PATH).toBe(KEYS.OPTIONS.INTEGRATIONS.CANVA.WEB_SESSION);

    expect((await index.status()).webSession).toBe(false);
    index.setWebSession(true);
    expect((await index.status()).webSession).toBe(true);

    /* Sem conta não há sessão de site a favorar. */
    await index.disconnect();
    expect((await index.status()).webSession).toBe(false);
  });

  it("requiresReconnect diz quando falta o escopo do export", async () => {
    await store.clear();
    expect((await index.status()).requiresReconnect).toBe(false);

    /* O token do reporte: marcado no portal, mas nunca pedido na URL. */
    await store.setToken({
      access_token: "A",
      refresh_token: "R",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      scope: "folder:read design:meta:read profile:read",
    });
    expect((await index.status()).requiresReconnect).toBe(true);

    /* Reconectou: o escopo entrou. */
    await store.setToken({
      access_token: "B",
      refresh_token: "R2",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      scope: "folder:read design:content:read design:meta:read profile:read",
    });
    expect((await index.status()).requiresReconnect).toBe(false);
  });

  it("token que não declara `scope` não gera aviso falso", async () => {
    /* `null` ≠ `false`: não sabemos o que o Canva concedeu, então não
       assustamos o operador. Quem manda é o 403 na hora de exportar. */
    await store.setToken({
      access_token: "A",
      refresh_token: "R",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    });
    expect((await index.status()).requiresReconnect).toBe(false);
  });
});

describe("fachada — operações sem rede", () => {
  it("designUrl sem id devolve código, não lança", async () => {
    expect(await index.designUrl({})).toMatchObject({ ok: false, code: "invalid_id" });
    expect(await index.designUrl(null)).toMatchObject({ ok: false, code: "invalid_id" });
  });

  it("exportDesign sem id devolve código, não lança — e antes de qualquer rede", async () => {
    expect(await index.exportDesign({})).toMatchObject({ ok: false, code: "invalid_id" });
    expect(await index.exportDesign(null)).toMatchObject({ ok: false, code: "invalid_id" });
  });

  it("items desconectado devolve código em vez de exceção", async () => {
    await store.clear();
    expect(await index.items({ folderId: "root" })).toMatchObject({
      ok: false,
      code: "not_connected",
    });
  });

  it("payload não-objeto não derruba a listagem", async () => {
    await store.setToken({
      access_token: "ACESSO",
      refresh_token: "R",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    });
    /* Rede fora do jogo: o formato do retorno é o que interessa, não o 200. */
    vi.stubGlobal("fetch", () => Promise.reject(new Error("sem rede")));
    try {
      const resultado = await index.items(null);
      expect(resultado).toMatchObject({ ok: false, code: "network" });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
