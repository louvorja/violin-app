// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { createRequire } from "module";
import http from "node:http";

const require = createRequire(import.meta.url);
const callbackServer = require("../canva/callbackServer.js");

/**
 * Sobe com porta efêmera e só devolve DEPOIS do bind — é a porta real que o
 * `onListening` entregou. O catch colado aqui evita "unhandled rejection"
 * enquanto o teste ainda está batendo no servidor.
 */
async function sobe(opts = {}) {
  let porta = 0;
  let resolveBind;
  const bind = new Promise((resolve) => {
    resolveBind = resolve;
  });

  const fluxo = callbackServer.start({
    port: 0,
    timeoutMs: 5000,
    onListening: (bound) => {
      porta = bound;
      resolveBind(bound);
    },
    ...opts,
  });
  fluxo.catch(() => {});

  await Promise.race([
    bind,
    new Promise((_, reject) => setTimeout(() => reject(new Error("bind demorou")), 2000)),
  ]);

  return { fluxo, porta: () => porta };
}

const get = (url) => fetch(url);

afterEach(() => callbackServer.stop());

describe("servidor de retorno", () => {
  it("resolve com code e state quando o Canva devolve os dois", async () => {
    const { fluxo, porta } = await sobe();

    const resposta = await get(
      `http://127.0.0.1:${porta()}/auth/canva?code=ABC&state=ESTADO-1`
    );

    expect(resposta.status).toBe(200);
    expect(await resposta.text()).toContain("Canva conectado");
    await expect(fluxo).resolves.toEqual({ ok: true, code: "ABC", state: "ESTADO-1" });
    expect(callbackServer.busy()).toBe(false);
  });

  it("rota errada responde 404 e o fluxo continua esperando", async () => {
    const { fluxo, porta } = await sobe();

    const outra = await get(`http://127.0.0.1:${porta()}/outra?code=X&state=Y`);
    expect(outra.status).toBe(404);

    await get(`http://127.0.0.1:${porta()}/auth/canva?code=CERTO&state=Z`);
    await expect(fluxo).resolves.toMatchObject({ code: "CERTO" });
  });

  it("recusa quando o Canva devolve error", async () => {
    const { fluxo, porta } = await sobe();

    const resposta = await get(
      `http://127.0.0.1:${porta()}/auth/canva?error=access_denied&error_description=Usu%C3%A1rio+recusou`
    );

    expect(resposta.status).toBe(200);
    await expect(fluxo).rejects.toMatchObject({
      code: "authorization_denied",
      message: expect.stringContaining("access_denied"),
    });
    expect(callbackServer.busy()).toBe(false);
  });

  it("callback incompleto é rejeitado em vez de trocar código vazio", async () => {
    const { fluxo, porta } = await sobe();

    await get(`http://127.0.0.1:${porta()}/auth/canva?state=SOMENTE-STATE`);

    await expect(fluxo).rejects.toMatchObject({ code: "malformed_callback" });
  });

  it("porta ocupada por outra coisa rejeita sem derrubar o app", async () => {
    /*
     * O `_server` do módulo só cobre a tentativa do próprio app; a corrida de
     * verdade é com OUTRO processo já na 5530 (ex.: um app espelhado). Por
     * isso o bloqueio aqui é um servidor alheio, não um segundo `start()`.
     */
    const alheio = http.createServer((_req, res) => res.end("ok"));
    await new Promise((resolve) => alheio.listen(0, "127.0.0.1", resolve));
    const ocupada = alheio.address().port;

    await expect(callbackServer.start({ port: ocupada, timeoutMs: 500 })).rejects.toMatchObject({
      code: "EADDRINUSE",
    });
    expect(callbackServer.busy()).toBe(false);

    await new Promise((resolve) => alheio.close(resolve));
  });

  it("duas tentativas ao mesmo tempo são recusadas", async () => {
    const { fluxo, porta } = await sobe();

    await expect(callbackServer.start({ port: 0 })).rejects.toMatchObject({ code: "EALREADY" });

    await get(`http://127.0.0.1:${porta()}/auth/canva?code=OK&state=S`);
    await fluxo;
  });

  it("tempo esgotado fecha a porta", async () => {
    const { fluxo } = await sobe({ timeoutMs: 120 });

    await expect(fluxo).rejects.toMatchObject({ code: "timeout" });
    expect(callbackServer.busy()).toBe(false);
  });

  it("stop() cancela o fluxo pendente em vez de deixá-lo até o timeout", async () => {
    const { fluxo } = await sobe({ timeoutMs: 30_000 });

    callbackServer.stop();

    /* Sem o abort, a promise ficaria pendurada e o timer dispararia mais tarde. */
    await expect(fluxo).rejects.toMatchObject({ code: "aborted" });
    expect(callbackServer.busy()).toBe(false);

    /* E uma nova tentativa em seguida funciona. */
    const deNovo = await sobe();
    await get(`http://127.0.0.1:${deNovo.porta()}/auth/canva?code=OK&state=S`);
    await expect(deNovo.fluxo).resolves.toMatchObject({ code: "OK" });
  });

  it("redirectUri aponta para a rota certa", () => {
    expect(callbackServer.redirectUri(5530)).toBe(callbackServer.REDIRECT_URI);
    expect(callbackServer.redirectUri(1234)).toBe("http://127.0.0.1:1234/auth/canva");
    expect(callbackServer.PORT).toBe(5530);
  });
});
