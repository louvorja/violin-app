// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const accounts = require("../collectionAccounts.js");

const DAY = 86_400_000;
const NOW = Date.parse("2026-11-10T12:00:00Z");
const secretaria = { user: { username: "Secretaria" }, home: "/home/secretaria" };
const sonoplastia = { user: { username: "Sonoplastia" }, home: "/home/sonoplastia" };
let root;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "lj-collection-accounts-"));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("quem usa o acervo", () => {
  it("só esta conta, assinatura recente: ainda não dá para garantir que a pasta é só dela", () => {
    accounts.sign(root, { now: NOW - 2 * DAY, ...secretaria });
    accounts.sign(root, { now: NOW, ...secretaria });
    expect(accounts.usage(root, { now: NOW, ...secretaria })).toEqual({
      known: true,
      settled: false,
      others: [],
    });
  });

  it("só esta conta há mais de 30 dias: a pasta compartilhada se comporta como privada", () => {
    accounts.sign(root, { now: NOW - 40 * DAY, ...secretaria });
    accounts.sign(root, { now: NOW, ...secretaria });
    expect(accounts.usage(root, { now: NOW, ...secretaria })).toEqual({
      known: true,
      settled: true,
      others: [],
    });
  });

  it("outra conta que abriu nos últimos 90 dias aparece com o nome e a data", () => {
    accounts.sign(root, { now: NOW - 40 * DAY, ...secretaria });
    accounts.sign(root, { now: NOW - 3 * DAY, ...sonoplastia });
    const { others, known } = accounts.usage(root, { now: NOW, ...secretaria });
    expect(known).toBe(true);
    expect(others).toEqual([
      { name: "Sonoplastia", lastSeen: new Date(NOW - 3 * DAY).toISOString() },
    ]);
  });

  it("conta parada há mais de 90 dias não segura o aviso", () => {
    accounts.sign(root, { now: NOW - 200 * DAY, ...sonoplastia });
    accounts.sign(root, { now: NOW - 40 * DAY, ...secretaria });
    accounts.sign(root, { now: NOW, ...secretaria });
    expect(accounts.usage(root, { now: NOW, ...secretaria })).toMatchObject({
      known: true,
      settled: true,
      others: [],
    });
  });

  it("a primeira abertura fica registrada e não recua ao assinar de novo", () => {
    accounts.sign(root, { now: NOW - 40 * DAY, ...secretaria });
    accounts.sign(root, { now: NOW, ...secretaria });
    const file = path.join(root, accounts.DIR, `${accounts.accountId(secretaria.user, secretaria.home)}.json`);
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(saved.firstSeen).toBe(new Date(NOW - 40 * DAY).toISOString());
    expect(saved.lastSeen).toBe(new Date(NOW).toISOString());
    expect(fs.readdirSync(path.join(root, accounts.DIR))).toHaveLength(1);
  });

  it("assinatura corrompida, grande demais ou com nome estranho não derruba nem engana", () => {
    accounts.sign(root, { now: NOW, ...secretaria });
    const dir = path.join(root, accounts.DIR);
    fs.writeFileSync(path.join(dir, "0123456789abcdef.json"), "{ quebrado");
    fs.writeFileSync(path.join(dir, "fedcba9876543210.json"), JSON.stringify({ version: 1, name: "x".repeat(5000), firstSeen: new Date(NOW).toISOString(), lastSeen: new Date(NOW).toISOString() }));
    fs.writeFileSync(path.join(dir, "aaaaaaaaaaaaaaaa.json"), JSON.stringify({ version: 1, name: "Ana\u0007\n", firstSeen: new Date(NOW).toISOString(), lastSeen: new Date(NOW).toISOString() }));
    fs.writeFileSync(path.join(dir, "nao-e-assinatura.json"), JSON.stringify({ version: 1, name: "Intrusa", firstSeen: new Date(NOW).toISOString(), lastSeen: new Date(NOW).toISOString() }));
    expect(accounts.usage(root, { now: NOW, ...secretaria }).others).toEqual([
      { name: "Ana", lastSeen: new Date(NOW).toISOString() },
    ]);
  });

  it("não cria o acervo que ainda não existe", () => {
    const novo = path.join(root, "ainda-nao-escolhido");
    expect(() => accounts.sign(novo, { now: NOW, ...secretaria })).toThrow();
    expect(fs.existsSync(novo)).toBe(false);
  });

  it("sem conseguir ler a pasta, o resultado é desconhecido", () => {
    expect(accounts.usage(path.join(root, "nao-existe"), { now: NOW, ...secretaria })).toEqual({
      known: false,
      settled: false,
      others: [],
    });
  });
});
