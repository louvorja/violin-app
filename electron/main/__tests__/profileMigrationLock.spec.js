// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
const require = createRequire(import.meta.url);
const fs = require("fs-extra");
const { acquireProfileMigrationLock } = require("../profileMigrationLock.js");
let root;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "lj-migration-lock-")); });
afterEach(() => { vi.restoreAllMocks(); fs.removeSync(root); });
const lock = () => path.join(root, ".profile-migration.lock");

it("mantém exclusividade mesmo numa migração longa e libera ao terminar", () => {
  const release = acquireProfileMigrationLock(root);
  fs.utimesSync(lock(), new Date(0), new Date(0));
  expect(() => acquireProfileMigrationLock(root)).toThrow(/em andamento/);
  release();
  expect(fs.existsSync(lock())).toBe(false);
  acquireProfileMigrationLock(root)();
});

it("recupera somente um PID local comprovadamente encerrado", () => {
  fs.outputJsonSync(path.join(lock(), "owner.json"), { pid: 42, hostname: os.hostname() });
  vi.spyOn(process, "kill").mockImplementation(() => { throw Object.assign(new Error("missing"), { code: "ESRCH" }); });
  const release = acquireProfileMigrationLock(root);
  expect(fs.readJsonSync(path.join(lock(), "owner.json")).pid).toBe(process.pid);
  release();
});

it.each(["EPERM", "EINVAL"])("não remove lock quando o processo é inacessível (%s)", (code) => {
  const original = { pid: 42, hostname: os.hostname() };
  fs.outputJsonSync(path.join(lock(), "owner.json"), original);
  vi.spyOn(process, "kill").mockImplementation(() => { throw Object.assign(new Error("inaccessible"), { code }); });
  expect(() => acquireProfileMigrationLock(root)).toThrow(/em andamento/);
  expect(fs.readJsonSync(path.join(lock(), "owner.json"))).toEqual(original);
});

it("preserva lock de outro host e diretório desconhecido", () => {
  fs.outputJsonSync(path.join(lock(), "owner.json"), { pid: 42, hostname: "another-host" });
  expect(() => acquireProfileMigrationLock(root)).toThrow(/em andamento/);
  fs.removeSync(path.join(lock(), "owner.json"));
  fs.outputFileSync(path.join(lock(), "private.txt"), "preserve");
  expect(() => acquireProfileMigrationLock(root)).toThrow(/em andamento/);
  expect(fs.readFileSync(path.join(lock(), "private.txt"), "utf8")).toBe("preserve");
});

it("não apaga um lock substituído por outro processo", () => {
  const release = acquireProfileMigrationLock(root);
  fs.removeSync(lock());
  fs.outputJsonSync(path.join(lock(), "owner.json"), { pid: 42, hostname: os.hostname(), nonce: "different" });
  release();
  expect(fs.readJsonSync(path.join(lock(), "owner.json")).nonce).toBe("different");
});
