import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  platform: { isDesktop: true },
  local: vi.fn((p: string) => `louvorja://local/${p}`),
}));

vi.mock("@/helpers/Platform", () => ({ default: h.platform }));
vi.mock("@/helpers/Path", () => ({ default: { local: h.local } }));

import { resolveBackgroundSoundPath } from "@/helpers/BackgroundSoundPath";

/**
 * Caminho reproduzível dos sons de fundo.
 *
 * O caso de regressão é o primeiro: bytes embutidos precisam de uma URL
 * **nova a cada chamada** — o player revoga a URL ativa em `playFile`/
 * `stop`/`cleanup` e reutilizar a cache significava replay de URL revogada
 * ("não funciona mais" na segunda vez).
 */
describe("resolveBackgroundSoundPath", () => {
  let counter = 0;
  const createObjectURL = vi.fn(() => `blob:test/${++counter}`);
  const revokeObjectURL = vi.fn();

  beforeEach(() => {
    counter = 0;
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
    // Mesmo padrão de SljaPlayer.spec.ts: anexa os spies no URL global do jsdom.
    Object.assign(URL, { createObjectURL, revokeObjectURL });
  });

  it("data+mime devolve uma URL NOVA a cada chamada (nunca reaproveita)", () => {
    const rec = { data: new Uint8Array([1, 2, 3]), mime: "audio/mpeg", path: "" };

    const primeira = resolveBackgroundSoundPath(rec);
    const segunda = resolveBackgroundSoundPath(rec);

    expect(primeira).toMatch(/^blob:test\//);
    expect(segunda).toMatch(/^blob:test\//);
    expect(primeira).not.toBe(segunda);
    expect(createObjectURL).toHaveBeenCalledTimes(2);
  });

  it("bytes com um blob: vencido no path também recriam a URL", () => {
    // Registro salvo com path blob: da sessão antiga — a URL não existe mais.
    const url = resolveBackgroundSoundPath({
      data: new Uint8Array([9]),
      mime: "audio/wav",
      path: "blob:recurso-vencido",
    });

    expect(url).toMatch(/^blob:test\//);
    expect(url).not.toBe("blob:recurso-vencido");
  });

  it("path com esquema conhecido passa direto (mesmo com bytes)", () => {
    const rec = { data: new Uint8Array([1]), mime: "audio/mpeg", path: "louvorja://local/som.mp3" };

    expect(resolveBackgroundSoundPath(rec)).toBe("louvorja://local/som.mp3");
    expect(resolveBackgroundSoundPath({ path: "https://exemplo/x.mp3" })).toBe(
      "https://exemplo/x.mp3"
    );
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it("path de disco vira URL do protocolo via Path.local (só no desktop)", () => {
    h.platform.isDesktop = true;
    expect(resolveBackgroundSoundPath({ path: "C:/acervo/som.mp3" })).toBe(
      "louvorja://local/C:/acervo/som.mp3"
    );
    expect(h.local).toHaveBeenCalledWith("C:/acervo/som.mp3");

    h.platform.isDesktop = false;
    expect(resolveBackgroundSoundPath({ path: "/var/som.mp3" })).toBe("/var/som.mp3");
    h.platform.isDesktop = true;
  });

  it("sem path e sem bytes devolve string vazia", () => {
    expect(resolveBackgroundSoundPath({})).toBe("");
    expect(resolveBackgroundSoundPath({ path: null, data: null })).toBe("");
  });
});
