// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { createSystemTrust, trustedCertificates } = require("../onlineVideo/certs.js");
const { createAgent } = require("../onlineVideo/progressive.js");

const pem = (name) => `-----BEGIN CERTIFICATE-----\n${name}\n-----END CERTIFICATE-----\n`;

describe("certificados em que o Node confia ao baixar do YouTube", () => {
  it("soma os do sistema aos embutidos, sem repetir", () => {
    const getCerts = (kind) => (kind === "system" ? [pem("PROXY"), pem("A")] : [pem("A"), pem("B")]);
    expect(createSystemTrust(getCerts)()).toEqual([pem("A"), pem("B"), pem("PROXY")]);
  });

  it("sem certificados do sistema devolve undefined, e o Node fica com os embutidos", () => {
    const getCerts = (kind) => (kind === "system" ? [] : [pem("A")]);
    expect(createSystemTrust(getCerts)()).toBeUndefined();
  });

  it("Node sem a API, ou sem acesso ao repositório, não derruba o download", () => {
    const missing = () => {
      throw new TypeError("tls.getCACertificates is not a function");
    };
    expect(createSystemTrust(missing)()).toBeUndefined();
  });

  it("lê o repositório do sistema uma única vez", () => {
    const getCerts = vi.fn((kind) => (kind === "system" ? [pem("PROXY")] : [pem("A")]));
    const trusted = createSystemTrust(getCerts);
    const first = trusted();
    expect(trusted()).toBe(first);
    expect(getCerts).toHaveBeenCalledTimes(2); // "system" e "default", na primeira leitura
  });

  it("a instância padrão funciona no Node em que os testes rodam", () => {
    const certs = trustedCertificates();
    expect(certs === undefined || (Array.isArray(certs) && certs.every((c) => typeof c === "string"))).toBe(true);
  });
});

describe("agente do download em pedaços", () => {
  it("entrega os certificados confiáveis ao https.Agent", () => {
    expect(createAgent(() => [pem("X")]).options.ca).toEqual([pem("X")]);
  });

  it("sem certificados extras deixa o Node usar os padrões", () => {
    expect(createAgent(() => undefined).options.ca).toBeUndefined();
  });

  it("reaproveita a conexão TLS entre um pedaço e o seguinte", () => {
    const agent = createAgent(() => undefined);
    expect(agent.keepAlive).toBe(true);
    expect(agent.maxSockets).toBe(6);
  });
});
