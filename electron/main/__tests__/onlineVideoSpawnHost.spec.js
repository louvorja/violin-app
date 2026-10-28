// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { createRequire } from "node:module";
import { EventEmitter } from "node:events";

const require = createRequire(import.meta.url);
const { createSpawnHost } = require("../onlineVideo/spawnHost.js");
const { runWorker } = require("../onlineVideo/spawnWorker.cjs");

/** Um "processo utilitário" no mesmo processo: mensagens clonadas e entregues depois, como no Electron. */
function linkedFork(forks = []) {
  return () => {
    const worker = new EventEmitter();
    const port = new EventEmitter();
    port.postMessage = (message) => setImmediate(() => worker.emit("message", structuredClone(message)));
    worker.postMessage = (message) => setImmediate(() => port.emit("message", { data: structuredClone(message) }));
    worker.kill = vi.fn(() => {
      setImmediate(() => worker.emit("exit", 0));
      return true;
    });
    runWorker(port);
    forks.push(worker);
    return worker;
  };
}

const node = (script, options = {}, host = createSpawnHost({ fork: linkedFork() })) => ({
  host,
  child: host.spawn(process.execPath, ["-e", script], { stdio: ["ignore", "pipe", "pipe"], ...options }),
});

function collect(child) {
  const out = { stdout: "", stderr: "", events: [] };
  child.stdout.setEncoding("utf8").on("data", (chunk) => {
    out.stdout += chunk;
    out.events.push("stdout");
  });
  child.stderr.setEncoding("utf8").on("data", (chunk) => {
    out.stderr += chunk;
    out.events.push("stderr");
  });
  out.closed = new Promise((resolve) => child.on("close", (code, signal) => resolve({ code, signal })));
  return out;
}

describe("processo utilitário das ferramentas de vídeo", () => {
  it("entrega a saída inteira, decodificada, antes de avisar que o processo fechou", async () => {
    const { child } = node(
      "process.stdout.write(Buffer.from([0x61, 0xc3])); setTimeout(() => { process.stdout.write(Buffer.from([0xa7, 0xc3, 0xa3, 0x6f])); process.stderr.write('aviso'); process.exitCode = 3; }, 30)"
    );
    const out = collect(child);
    const { code } = await out.closed;
    expect(out.stdout).toBe("ação");
    expect(out.stderr).toBe("aviso");
    expect(code).toBe(3);
    expect(child.pid).toBeGreaterThan(0);
  });

  it("imita o execFile: saída no sucesso, erro com o stderr na falha", async () => {
    const host = createSpawnHost({ fork: linkedFork() });
    const run = (script) =>
      new Promise((resolve) =>
        host.execFile(process.execPath, ["-e", script], { timeout: 5_000 }, (error, stdout) => resolve({ error, stdout }))
      );
    const ok = await run("console.log('ffmpeg version 7')");
    expect(ok.error).toBeNull();
    expect(ok.stdout).toMatch(/ffmpeg version 7/);
    const bad = await run("console.error('barrado'); process.exit(2)");
    expect(bad.error.message).toMatch(/código 2: barrado/);
  });

  it("o timeout do execFile derruba o processo pendurado", async () => {
    const host = createSpawnHost({ fork: linkedFork() });
    const started = Date.now();
    const error = await new Promise((resolve) =>
      host.execFile(process.execPath, ["-e", "setTimeout(() => {}, 30_000)"], { timeout: 200 }, resolve)
    );
    expect(error.message).toMatch(/não respondeu em 200 ms/);
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it("killTree chega ao processo pelo utilitário, mesmo pedido antes de ele nascer", async () => {
    const { host, child } = node("setTimeout(() => {}, 30_000)", { detached: process.platform !== "win32" });
    const out = collect(child);
    host.killTree(child);
    const { code, signal } = await out.closed;
    expect(code === 0 && signal === null).toBe(false);
  });

  it("se o utilitário cai, os filhos vivos falham em vez de esperar para sempre", async () => {
    const forks = [];
    const host = createSpawnHost({ fork: linkedFork(forks) });
    const { child } = node("setTimeout(() => {}, 30_000)", {}, host);
    const out = collect(child);
    const errors = [];
    child.on("error", (error) => errors.push(error.message));
    await new Promise((resolve) => child.once("spawn", resolve));
    const pid = child.pid;
    forks[0].emit("exit", 1);
    await out.closed;
    expect(errors).toEqual(["O processo auxiliar das ferramentas de vídeo encerrou"]);
    await host.settle(1_000);
    process.kill(pid);
  });

  it("um executável que não existe vira erro e fechamento, como no child_process", async () => {
    const host = createSpawnHost({ fork: linkedFork() });
    const child = host.spawn("/caminho/que/nao/existe/yt-dlp", [], { stdio: ["ignore", "pipe", "pipe"] });
    const errors = [];
    child.on("error", (error) => errors.push(error.code));
    await new Promise((resolve) => child.on("close", resolve));
    expect(errors).toEqual(["ENOENT"]);
  });

  it("encerra o utilitário ocioso e abre outro no próximo pedido", async () => {
    const forks = [];
    const host = createSpawnHost({ fork: linkedFork(forks), idleMs: 20 });
    await collect(node("", {}, host).child).closed;
    await vi.waitFor(() => expect(host.running()).toBe(false));
    expect(forks[0].kill).toHaveBeenCalledTimes(1);
    await collect(node("", {}, host).child).closed;
    expect(forks).toHaveLength(2);
  });

  it("settle espera os filhos vivos, sem passar do limite", async () => {
    const { host, child } = node("setTimeout(() => {}, 30_000)");
    collect(child);
    await new Promise((resolve) => child.once("spawn", resolve));
    const started = Date.now();
    await host.settle(100);
    expect(Date.now() - started).toBeGreaterThanOrEqual(90);
    host.killTree(child);
    await host.settle(5_000);
    expect(host.running()).toBe(true);
  });
});
