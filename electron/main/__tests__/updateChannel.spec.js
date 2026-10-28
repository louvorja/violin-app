// @vitest-environment node
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { isPrerelease, resolveUseBeta, readLastRunVersion, writeLastRunVersion } = require("../updateChannel.js");

describe("canal de atualização", () => {
  it("qualquer identificador depois do hífen é pré-versão", () => {
    for (const v of ["2.0.0-beta.18", "2.0.0-rc.1", "v2.1.0-preview.3", "2.0.0-alpha"]) expect(isPrerelease(v)).toBe(true);
    for (const v of ["2.0.0", "v2.0.1", "", null]) expect(isPrerelease(v)).toBe(false);
  });

  it("sem escolha salva, acompanha o tipo da versão instalada", () => {
    expect(resolveUseBeta({ currentVersion: "2.0.0-beta.18", lastRunVersion: "2.0.0-beta.17", saved: null }))
      .toEqual({ useBeta: true, persist: true });
    expect(resolveUseBeta({ currentVersion: "2.0.1", lastRunVersion: "2.0.0", saved: undefined }))
      .toEqual({ useBeta: false, persist: true });
  });

  it("chegar numa estável vindo de pré-versão desliga, mesmo com a opção ligada", () => {
    expect(resolveUseBeta({ currentVersion: "2.0.0", lastRunVersion: "2.0.0-rc.1", saved: true }))
      .toEqual({ useBeta: false, persist: true });
    // Quem pulou direto da beta.17 (que não registrava a versão) para a estável.
    expect(resolveUseBeta({ currentVersion: "2.0.0", lastRunVersion: null, saved: true }))
      .toEqual({ useBeta: false, persist: true });
  });

  it("depois disso respeita quem ligou de novo, inclusive de estável para estável", () => {
    expect(resolveUseBeta({ currentVersion: "2.0.0", lastRunVersion: "2.0.0", saved: true }))
      .toEqual({ useBeta: true, persist: false });
    expect(resolveUseBeta({ currentVersion: "2.0.1", lastRunVersion: "2.0.0", saved: true }))
      .toEqual({ useBeta: true, persist: false });
  });

  it("numa pré-versão mantém a escolha salva", () => {
    expect(resolveUseBeta({ currentVersion: "2.1.0-beta.1", lastRunVersion: "2.0.0", saved: false }))
      .toEqual({ useBeta: false, persist: false });
    expect(resolveUseBeta({ currentVersion: "2.0.0-rc.2", lastRunVersion: "2.0.0-rc.1", saved: true }))
      .toEqual({ useBeta: true, persist: false });
  });

  it("guarda e lê a última versão executada; arquivo ausente ou inválido é null", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lj-canal-"));
    try {
      expect(readLastRunVersion(dir)).toBeNull();
      writeLastRunVersion(dir, "2.0.0-beta.18");
      expect(readLastRunVersion(dir)).toBe("2.0.0-beta.18");
      fs.writeFileSync(path.join(dir, "update-channel.json"), "{quebrado");
      expect(readLastRunVersion(dir)).toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
