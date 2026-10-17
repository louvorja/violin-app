import { afterEach, describe, expect, it, vi } from "vitest";

async function load() {
  vi.resetModules();
  return (await import("@/config/Api")).apiTokenHeaders;
}

describe("apiTokenHeaders", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("não manda o token por padrão: a API oficial é pública e o cabeçalho só gera pré-voo", async () => {
    const apiTokenHeaders = await load();
    expect(apiTokenHeaders("segredo")).toEqual({});
  });

  it("manda o token quando o servidor configurado o exige", async () => {
    vi.stubEnv("VITE_API_TOKEN_REQUIRED", "true");
    const apiTokenHeaders = await load();
    expect(apiTokenHeaders("segredo")).toEqual({ "Api-Token": "segredo" });
  });

  it("não manda cabeçalho vazio, mesmo exigido", async () => {
    vi.stubEnv("VITE_API_TOKEN_REQUIRED", "true");
    const apiTokenHeaders = await load();
    expect(apiTokenHeaders("")).toEqual({});
  });

  it("só o valor 'true' liga o envio", async () => {
    vi.stubEnv("VITE_API_TOKEN_REQUIRED", "1");
    const apiTokenHeaders = await load();
    expect(apiTokenHeaders("segredo")).toEqual({});
  });
});
