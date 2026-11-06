// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import path from "node:path";
import os from "node:os";
const require = createRequire(import.meta.url);
const fs = require("fs-extra");
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lj-remote-cancel-")));
let handleRequest, upstream;
function stub(modulePath, exports) {
  const id = require.resolve(modulePath);
  require.cache[id] = { id, filename: id, loaded: true, exports };
}
/** Servidor de mentira: responde 206 e registra se o pedido foi abortado. */
function serve(init) {
  const state = { init, cancelled: false, controller: null };
  state.response = new Response(
    new ReadableStream({
      start(controller) { state.controller = controller; },
      cancel() { state.cancelled = true; },
    }),
    { status: 206, headers: { "Content-Range": "bytes 100-199/1000", "Content-Type": "audio/ogg" } }
  );
  upstream = state;
  return state.response;
}
stub("electron", {
  protocol: { handle: (_scheme, handler) => { handleRequest = handler; } },
  app: { getAppPath: () => root },
  net: { fetch: async (_url, init) => serve(init) },
});
stub("../paths.js", { filesDir: () => path.join(root, "Acervo"), dataDir: () => path.join(root, "profile") });
stub("../storageAccess.js", { canWrite: () => true, status: () => ({ media: { shared: false, writable: true } }) });
stub("../onlineVideo/index.js", { fileFor: () => null });
const protocol = require("../protocol.js");

beforeAll(async () => {
  await fs.ensureDir(path.join(root, "Acervo"));
  protocol.setRemoteConfig({ filesUrl: "https://example.invalid" });
  protocol.handle();
});
afterAll(async () => { await fs.remove(root); });

const rangeRequest = () =>
  handleRequest(new Request("louvorja://files/musics/pt/medley.opus", { headers: { Range: "bytes=100-" } }));

describe("trecho remoto que o player abandona", () => {
  it("entrega os dados e o cabeçalho do servidor", async () => {
    const response = await rangeRequest();
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 100-199/1000");
    upstream.controller.enqueue(new TextEncoder().encode("áudio"));
    upstream.controller.close();
    expect(await response.text()).toBe("áudio");
  });

  it("cancelar o corpo aborta o pedido ao servidor", async () => {
    const response = await rangeRequest();
    upstream.controller.enqueue(new TextEncoder().encode("começo"));
    const reader = response.body.getReader();
    await reader.read();
    await reader.cancel();
    expect(upstream.init.signal.aborted).toBe(true);
    await expect.poll(() => upstream.cancelled).toBe(true);
  });
});
