// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const fs = require("fs-extra");
const { createRuntimeIncidentJournal, MAX_RECORDS, MAX_ENTRY_BYTES, MAX_FILE_BYTES, TTL_MS } = require("../runtimeIncidentJournal.js");
let dir, file, clock;
const instance = "00000000-0000-4000-8000-000000000001";
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const incident = (n = 1, extra = {}) => ({
  app_instance_id: instance,
  incident_id: id(n),
  incident_type: "renderer_unresponsive",
  incident_status: "detected",
  observed_at: new Date(clock).toISOString(),
  window_role: "auxiliary",
  severity: "error",
  duration_ms: 2500,
  ...extra,
});
const journal = (io = fs) => createRuntimeIncidentJournal({ file, io, now: () => clock });

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "lj-incidents-"));
  file = path.join(dir, "incidents.json");
  clock = Date.parse("2026-09-24T12:00:00Z");
});
afterEach(async () => { vi.restoreAllMocks(); await fs.remove(dir); });

describe("runtime incident journal", () => {
  it("recupera incidente confirmado após reinício e preserva detecção e recuperação", async () => {
    const first = journal();
    await first.append(incident());
    await first.append(incident(1, { incident_status: "recovered", duration_ms: 8000 }));
    const records = await journal().read();
    expect(records.map((record) => record.incident_status)).toEqual(["detected", "recovered"]);
    expect(records[1].duration_ms).toBe(8000);
    expect(records[0].app_instance_id).toBe(instance);
  });

  it("serializa append/read e retém somente os últimos vinte incidentes", async () => {
    const queue = journal();
    const appends = Array.from({ length: 25 }, (_, i) => queue.append(incident(i + 1)));
    const read = queue.read();
    await Promise.all(appends);
    expect((await read).map((record) => record.incident_id)).toEqual(Array.from({ length: 20 }, (_, i) => id(i + 6)));
    expect((await journal().read()).length).toBe(MAX_RECORDS);
    expect((await fs.stat(file)).size).toBeLessThanOrEqual(MAX_FILE_BYTES);
  });

  it("remove conteúdo livre inclusive em identificadores e mantém métricas seguras", async () => {
    await journal().append(incident(1, {
      incident_id: "https://private.local/secret.mp4",
      playback_id: "C:\\private\\secret.mp4",
      app_instance_id: "Título secreto",
      feature: "Título secreto",
      renderer_route: "/private/path",
      reason: "https://private.local",
      token: "secret",
      recent_runtime_events: [{ title: "secret" }],
      process_metrics: [{ process_name: "secret" }],
      main_cpu_percent: 23.4,
      presentation_active: true,
      main_loop_max_ms: Infinity,
    }));
    const records = await journal().read();
    expect(records[0]).toMatchObject({ main_cpu_percent: 23.4, presentation_active: true });
    expect(records[0].incident_id).toMatch(/^sha256:/);
    expect(records[0]).not.toHaveProperty("main_loop_max_ms");
    const raw = await fs.readFile(file, "utf8");
    expect(raw).not.toMatch(/private|secret|Título|https|mp4/);
    expect(await journal().read()).toEqual(records);
  });

  it("limita cada entrada mesmo com payload externo enorme", async () => {
    const queue = journal();
    await queue.append(incident(1, { stack: "x".repeat(MAX_ENTRY_BYTES * 10), windows: Array(1000).fill({ title: "secret" }) }));
    for (const record of await queue.read()) {
      expect(Buffer.byteLength(JSON.stringify(record))).toBeLessThanOrEqual(MAX_ENTRY_BYTES);
    }
    await expect(queue.append(incident(2, { incident_id: "x".repeat(1000) }))).resolves.toMatchObject({ ok: false });
    expect(await queue.read()).toHaveLength(1);
  });

  it("ignora arquivo malformado e registros inválidos sem propagar conteúdo", async () => {
    await fs.writeFile(file, "{broken");
    expect(await journal().read()).toEqual([]);
    await fs.writeJson(file, { version: 1, records: [null, { title: "secret" }, incident()] });
    expect(await journal().read()).toHaveLength(1);
    await fs.writeJson(file, { version: 999, records: [incident()] });
    expect(await journal().read()).toEqual([]);
  });

  it("rejeita arquivo acima do limite antes de ler ou fazer parse", async () => {
    await fs.writeFile(file, "x".repeat(MAX_FILE_BYTES + 1));
    const io = { ...fs, readFile: vi.fn(fs.readFile) };
    expect(await journal(io).read()).toEqual([]);
    expect(io.readFile).not.toHaveBeenCalled();
  });

  it("expira em sete dias sem gravar por leitura nem criar timers", async () => {
    const io = { ...fs, writeFile: vi.fn(fs.writeFile) };
    const queue = journal(io);
    await queue.append(incident());
    const writes = io.writeFile.mock.calls.length;
    clock += TTL_MS + 1;
    expect(await queue.read()).toEqual([]);
    await queue.flush();
    expect(io.writeFile).toHaveBeenCalledTimes(writes);
    await expect(queue.append(incident(2, { observed_at: new Date(clock - TTL_MS - 1).toISOString() }))).resolves.toMatchObject({ ok: false });
    expect(await journal().read()).toEqual([]);
  });

  it("evita nova escrita para replay duplicado sem instância declarada", async () => {
    const io = { ...fs, writeFile: vi.fn(fs.writeFile) };
    const queue = journal(io);
    const payload = incident(1, { app_instance_id: undefined });
    await queue.append(payload);
    const writes = io.writeFile.mock.calls.length;
    await expect(queue.append(payload)).resolves.toMatchObject({ duplicate: true });
    expect(io.writeFile).toHaveBeenCalledTimes(writes);
    expect(await journal().read()).toHaveLength(1);
  });

  it("falha de escrita preserva arquivo anterior e não bloqueia tentativas futuras", async () => {
    await journal().append(incident());
    const io = { ...fs, writeFile: vi.fn().mockRejectedValueOnce(new Error("disk full")).mockImplementation(fs.writeFile) };
    const queue = journal(io);
    await expect(queue.append(incident(2))).rejects.toThrow("disk full");
    await expect(queue.flush()).rejects.toThrow("disk full");
    expect((await journal().read()).map((record) => record.incident_id)).toEqual([id(1)]);
    await queue.append(incident(3));
    await expect(queue.flush()).resolves.toEqual({ ok: true });
    expect((await journal().read()).map((record) => record.incident_id)).toEqual([id(1), id(3)]);
  });

  it("falha no rename não apaga o snapshot anterior", async () => {
    await journal().append(incident());
    const io = { ...fs, rename: vi.fn().mockRejectedValue(Object.assign(new Error("I/O failure"), { code: "EIO" })) };
    await expect(journal(io).append(incident(2))).rejects.toThrow("I/O failure");
    expect((await journal().read()).map((record) => record.incident_id)).toEqual([id(1)]);
  });

  it("recupera backup após troca interrompida e limpa também cópias recuperáveis", async () => {
    await journal().append(incident());
    await fs.rename(file, `${file}.bak`);
    const queue = journal();
    expect(await queue.read()).toHaveLength(1);
    await queue.clear();
    expect(await journal().read()).toEqual([]);
    expect(await fs.pathExists(`${file}.bak`)).toBe(false);
  });

  it("propaga falha de leitura sem sobrescrever dados desconhecidos", async () => {
    await journal().append(incident());
    const io = { ...fs, readFile: vi.fn().mockRejectedValue(Object.assign(new Error("locked"), { code: "EACCES" })) };
    await expect(journal(io).append(incident(2))).rejects.toThrow("locked");
    expect((await journal().read()).map((record) => record.incident_id)).toEqual([id(1)]);
  });

  it("retorna cópias e captura o payload antes de enfileirar", async () => {
    const queue = journal();
    const payload = incident();
    const pending = queue.append(payload);
    payload.duration_ms = 999;
    await pending;
    const records = await queue.read();
    expect(records[0].duration_ms).toBe(2500);
    records[0].duration_ms = 1;
    expect((await queue.read())[0].duration_ms).toBe(2500);
  });
});
