import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

const source = readFileSync(resolve(__dirname, "../public/sw-skip-waiting.js"), "utf8");

function evaluateInWorker() {
  const listeners = {};
  const scope = {
    skipWaiting: vi.fn(),
    addEventListener: (type, handler) => (listeners[type] = handler),
  };
  new Function("self", source)(scope);
  return { scope, message: (data) => listeners.message({ data }) };
}

describe("SW atende o pedido da página para ativar a versão nova", () => {
  it("chama skipWaiting ao receber SKIP_WAITING", () => {
    const { scope, message } = evaluateInWorker();
    message({ type: "SKIP_WAITING" });
    expect(scope.skipWaiting).toHaveBeenCalledOnce();
  });

  it("ignora outras mensagens", () => {
    const { scope, message } = evaluateInWorker();
    message({ type: "OUTRA" });
    message(null);
    expect(scope.skipWaiting).not.toHaveBeenCalled();
  });

  it("o sw.js gerado importa o arquivo", () => {
    const config = readFileSync(resolve(__dirname, "../vite.config.js"), "utf8");
    expect(config).toMatch(/importScripts:\s*\["sw-skip-waiting\.js"\]/);
  });
});
