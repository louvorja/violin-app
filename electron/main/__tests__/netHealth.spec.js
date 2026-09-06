// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const netHealth = require("../netHealth.js");

/**
 * Declarar offline cedo demais é pior que declarar tarde: o app degrada a
 * interface no meio de um culto por causa de um único arquivo grande que
 * demorou. Daí as duas falhas seguidas — e a volta imediata no primeiro
 * sucesso, porque aí não há dúvida.
 */
describe("netHealth", () => {
  beforeEach(() => netHealth._reset());

  it("começa online", () => {
    expect(netHealth.status().online).toBe(true);
  });

  it("uma falha isolada não derruba", () => {
    netHealth.report(false);
    expect(netHealth.status().online).toBe(true);
  });

  it("duas falhas seguidas derrubam", () => {
    netHealth.report(false);
    netHealth.report(false);
    expect(netHealth.status().online).toBe(false);
  });

  it("um sucesso no meio zera a contagem", () => {
    netHealth.report(false);
    netHealth.report(true);
    netHealth.report(false);
    expect(netHealth.status().online).toBe(true);
  });

  it("um único sucesso traz de volta", () => {
    netHealth.report(false);
    netHealth.report(false);
    netHealth.report(true);
    expect(netHealth.status().online).toBe(true);
  });

  it("registra desde quando está fora", () => {
    expect(netHealth.status().since).toBe(null);
    netHealth.report(false);
    netHealth.report(false);
    expect(typeof netHealth.status().since).toBe("number");
    netHealth.report(true);
    expect(netHealth.status().since).toBe(null);
  });

  it("avisa os ouvintes só quando o estado muda", () => {
    const vistos = [];
    netHealth.onChange((s) => vistos.push(s.online));
    netHealth.report(false);
    netHealth.report(false);
    netHealth.report(false);
    netHealth.report(true);
    expect(vistos).toEqual([false, true]);
  });
});
