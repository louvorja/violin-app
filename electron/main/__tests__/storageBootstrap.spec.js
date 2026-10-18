// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { Worker } from "node:worker_threads";
import path from "node:path";
import os from "node:os";
const require = createRequire(import.meta.url);
const fs = require("fs-extra");
const { validateRequest, validProgress } = require("../storageBootstrap.js");
const { createHostLeases } = require("../storageCollectionLeaseBridge.cjs");
const roots = [];
afterEach(() => { for (const root of roots.splice(0)) fs.removeSync(root); });

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lj-bootstrap-worker-"));
  roots.push(root);
  const options = { bootstrap: path.join(root, "appData"), documents: path.join(root, "Documents"), videos: path.join(root, "Videos"), programDir: path.join(root, "program"), ownedBootstrapPid: process.pid };
  fs.ensureDirSync(options.bootstrap);
  return { root, options };
}
function run(options) {
  const worker = new Worker(require.resolve("../storageBootstrapWorker.cjs"), { workerData: options });
  const messages = [];
  const leases = createHostLeases(require("../storageAccess.js").acquire);
  return new Promise((resolve, reject) => {
    worker.on("message", (message) => { if (!leases.handle(message)) messages.push(message); });
    worker.once("error", reject);
    worker.once("exit", (code) => { leases.releaseAll(); code ? reject(new Error(`worker exit ${code}`)) : resolve(messages); });
  });
}

describe("preparação de armazenamento antes do perfil Chromium", () => {
  it("valida a fronteira do processo auxiliar", () => {
    const base = { version: 1, bootstrap: "/tmp/profile", documents: "/tmp/documents", videos: "/tmp/videos", programDir: "/tmp/program", ownedBootstrapPid: process.pid + 1 };
    expect(validateRequest(base)).toEqual(base);
    for (const change of [{ version: 2 }, { ownedBootstrapPid: process.pid }, { ownedBootstrapPid: -1 }, { bootstrap: "relative" }, { documents: null }]) {
      expect(() => validateRequest({ ...base, ...change })).toThrow(/inválida/);
    }
    expect(validProgress({ phase: "copying", files: 1, bytes: 8 })).toBe(true);
    expect(validProgress({ phase: "execute", files: 1, bytes: 8 })).toBeFalsy();
    expect(validProgress({ phase: "copying", files: -1, bytes: 8 })).toBeFalsy();
  });

  it("copia em worker sem bloquear o processo que exibe o progresso", async () => {
    const { root, options } = fixture();
    const legacy = path.join(root, "legacy");
    fs.outputJsonSync(path.join(options.bootstrap, "data-location.json"), { dataDir: legacy });
    fs.outputJsonSync(path.join(legacy, "storage", "user_data.json"), { fixture: "private" });
    for (let i = 0; i < 120; i++) fs.outputFileSync(path.join(legacy, ".electron", "IndexedDB", `fixture-${i}.ldb`), Buffer.alloc(4096, i));
    let ticks = 0;
    const interval = setInterval(() => ticks++, 2);
    let messages;
    try { messages = await run(options); } finally { clearInterval(interval); }
    expect(ticks).toBeGreaterThan(0);
    expect(messages.at(-1)).toEqual({ type: "complete" });
    expect(messages.some((m) => m.type === "progress" && m.progress.phase === "publishing")).toBe(true);
    const original = path.join(legacy, ".electron", "IndexedDB", "fixture-72.ldb");
    expect(fs.readFileSync(path.join(options.bootstrap, "profile", ".electron", "IndexedDB", "fixture-72.ldb"))).toEqual(fs.readFileSync(original));
    expect(fs.readJsonSync(path.join(options.bootstrap, "storage-layout.json"))).toMatchObject({ version: 1 });
  });

  it("recusa trabalhar quando o pai já morreu e conserva a origem", async () => {
    const { root, options } = fixture();
    const legacy = path.join(root, "legacy");
    fs.outputFileSync(path.join(legacy, ".electron", "IndexedDB", "saved"), "preserved");
    fs.outputJsonSync(path.join(options.bootstrap, "data-location.json"), { dataDir: legacy });
    const messages = await run({ ...options, ownedBootstrapPid: 2147483647 });
    expect(messages.at(-1)).toMatchObject({ type: "error", message: expect.stringContaining("encerrado") });
    expect(fs.existsSync(path.join(options.bootstrap, "profile"))).toBe(false);
    expect(fs.readFileSync(path.join(legacy, ".electron", "IndexedDB", "saved"), "utf8")).toBe("preserved");
  });
});
