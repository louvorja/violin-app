import { describe, expect, it } from "vitest";
import { DOMAINS_CSP } from "./cspDomains.cjs";
import { buildCsp } from "../electron/main/csp.js";

describe("PostHog CSP", () => {
  it("permite os bundles lazy do SDK e workers do Session Replay", () => {
    expect(DOMAINS_CSP.SCRIPT).toContain("https://*.posthog.com");
    expect(DOMAINS_CSP.CONNECT).toContain("https://*.posthog.com");
    expect(DOMAINS_CSP.WORKER).toContain("data:");
  });

  it("aplica os hosts do PostHog na CSP do Electron", () => {
    const csp = buildCsp("prod-desktop");
    expect(csp).toContain("script-src");
    expect(csp).toContain("https://*.posthog.com");
    expect(csp).toMatch(/worker-src 'self' blob:[^;]*data:/);
  });
});
