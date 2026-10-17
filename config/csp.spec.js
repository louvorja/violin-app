import { describe, expect, it } from "vitest";
import { DOMAINS_CSP } from "./cspDomains.cjs";
import { buildCsp } from "../electron/main/csp.js";

describe("PostHog CSP", () => {
  it("permite os bundles lazy do SDK e workers do Session Replay", () => {
    expect(DOMAINS_CSP.SCRIPT).toContain("https://*.posthog.com");
    expect(DOMAINS_CSP.CONNECT).toContain("https://*.posthog.com");
    expect(DOMAINS_CSP.WORKER).toContain("data:");
  });

  // O catálogo pode apontar capa e áudio direto para o armazenamento. Sem ele
  // aqui, o web/PWA barra a capa, o áudio e o download para uso offline.
  it("libera o armazenamento de mídia para imagem, áudio e download", () => {
    for (const directive of [DOMAINS_CSP.IMG, DOMAINS_CSP.MEDIA, DOMAINS_CSP.CONNECT]) {
      expect(directive).toContain("https://*.louvorja.com.br");
    }
  });

  it("aplica os hosts do PostHog na CSP do Electron", () => {
    const csp = buildCsp("prod-desktop");
    expect(csp).toContain("script-src");
    expect(csp).toContain("https://*.posthog.com");
    expect(csp).toMatch(/worker-src 'self' blob:[^;]*data:/);
  });
});
