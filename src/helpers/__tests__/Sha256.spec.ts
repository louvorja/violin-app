// @vitest-environment node
import { webcrypto } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sha256Hex } from "../Sha256";

afterEach(() => vi.unstubAllGlobals());

describe.each(["native", "fallback"])("SHA-256 (%s)", (mode) => {
  it.each([
    ["", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
    ["abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
  ])("valida o vetor %j sem incluir bytes fora da view", async (input, expected) => {
    vi.stubGlobal("crypto", mode === "native" ? webcrypto : {});
    const padded = new TextEncoder().encode(`!${input}!`);
    await expect(sha256Hex(padded.subarray(1, padded.length - 1))).resolves.toBe(expected);
  });
});

it("propaga falhas de um WebCrypto disponível", async () => {
  const error = new Error("digest falhou");
  vi.stubGlobal("crypto", { subtle: { digest: vi.fn().mockRejectedValue(error) } });
  await expect(sha256Hex(new Uint8Array())).rejects.toBe(error);
});
