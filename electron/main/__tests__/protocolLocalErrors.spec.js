// @vitest-environment node
/**
 * `louvorja://local` responde 404 só quando o arquivo não existe.
 *
 * Antes, qualquer falha ao checar o caminho virava 404, e a liturgia dizia
 * "Arquivo não encontrado" para um arquivo que estava lá, numa pasta sem
 * permissão de leitura. O renderer lê o motivo pelo status (cabeçalho próprio
 * não atravessa a origem cruzada), então o status é o contrato.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Path from "@/helpers/Path";

const require = createRequire(import.meta.url);
const root = fs.mkdtempSync(join(tmpdir(), "lj-protocol-local-errors-"));
let handleRequest;

function stub(modulePath, exports) {
  const resolved = require.resolve(modulePath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

stub("electron", {
  protocol: {
    handle: (_scheme, handler) => {
      handleRequest = handler;
    },
  },
  app: { getAppPath: () => root },
});
stub("../paths.js", { filesDir: () => join(root, "files") });
stub("../onlineVideo/index.js", { fileFor: () => null });

const protocol = require("../protocol.js");

const canTestPermission =
  process.platform !== "win32" && !(typeof process.getuid === "function" && process.getuid() === 0);

async function get(file) {
  const res = await handleRequest(
    new Request(Path.local(file), { headers: { Range: "bytes=0-0" } })
  );
  return { status: res.status, error: res.headers.get("X-Louvorja-File-Error") };
}

beforeAll(() => {
  protocol.handle();
});

afterAll(() => {
  const locked = join(root, "trancado.mp4");
  if (fs.existsSync(locked)) fs.chmodSync(locked, 0o644);
  fs.rmSync(root, { recursive: true, force: true });
});

describe("motivo da falha de um arquivo local", () => {
  it("arquivo legível é entregue", async () => {
    const file = join(root, "ok.mp4");
    fs.writeFileSync(file, "abc");
    expect(await get(file)).toEqual({ status: 206, error: null });
  });

  it("arquivo que não existe é 404", async () => {
    expect(await get(join(root, "sumiu.mp4"))).toEqual({ status: 404, error: "not_found" });
  });

  it("pasta no lugar do arquivo é 404", async () => {
    const dir = join(root, "pasta.mp4");
    fs.mkdirSync(dir);
    expect(await get(dir)).toEqual({ status: 404, error: "not_found" });
  });

  it.skipIf(!canTestPermission)("arquivo sem permissão de leitura é 403, não 404", async () => {
    const file = join(root, "trancado.mp4");
    fs.writeFileSync(file, "abc");
    fs.chmodSync(file, 0o000);
    expect(await get(file)).toEqual({ status: 403, error: "permission" });
  });
});
