// @vitest-environment node
import { describe, it, expect, afterEach, vi } from "vitest";
import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const {
  isPermissionError,
  macStagingDisponivel,
  planoAposBloqueio,
  convertToPdf,
  MAC_PERMISSION_MESSAGE,
} = require("../pptx/converters.js");

describe("macOS 27 — permissão do container do PowerPoint", () => {
  afterEach(() => vi.restoreAllMocks());

  it("reconhece os erros de permissão do macOS", () => {
    expect(isPermissionError(Object.assign(new Error("x"), { code: "EPERM" }))).toBe(true);
    expect(isPermissionError(Object.assign(new Error("x"), { code: "EACCES" }))).toBe(true);
    expect(isPermissionError(new Error("EPERM: operation not permitted, mkdir"))).toBe(true);
    expect(isPermissionError(new Error("ENOENT: no such file or directory"))).toBe(false);
  });

  it("sonda a escrita na pasta e limpa o arquivo de teste", async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "lj-pptx-stage-"));
    vi.spyOn(fs, "existsSync").mockReturnValue(false);
    try {
      const r = await macStagingDisponivel({ tempDir: dir });
      expect(r).toEqual({ ok: true, base: dir });
      expect(await fsp.readdir(dir)).toEqual([]);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it("sem permissão no container, devolve permission: true", async () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    vi.spyOn(fsp, "mkdir").mockRejectedValue(
      Object.assign(new Error("EPERM: operation not permitted, mkdir"), { code: "EPERM" })
    );
    const r = await macStagingDisponivel({ tempDir: os.tmpdir() });
    expect(r.permission).toBe(true);
  });

  it("a conversão no Mac falha com mac_permission antes de abrir o PowerPoint", async () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    vi.spyOn(fsp, "mkdir").mockRejectedValue(
      Object.assign(new Error("EPERM: operation not permitted, mkdir"), { code: "EPERM" })
    );
    await expect(
      convertToPdf({ id: "powerpoint", label: "PowerPoint" }, "/tmp/x.pptx", "/tmp/x.pdf", {
        platform: "darwin",
        tempDir: os.tmpdir(),
      })
    ).rejects.toMatchObject({ code: "mac_permission", message: MAC_PERMISSION_MESSAGE });
  });

  it("no modo auto cai para o LibreOffice; no modo powerpoint só explica", () => {
    const ppt = { id: "powerpoint", label: "PowerPoint" };
    expect(planoAposBloqueio(ppt, "auto", "/usr/bin/soffice")).toMatchObject({
      converter: { id: "libreoffice" },
      fallback: true,
    });
    expect(planoAposBloqueio(ppt, "powerpoint", "/usr/bin/soffice")).toMatchObject({
      converter: null,
      permission: true,
    });
    expect(planoAposBloqueio(ppt, "auto", null)).toMatchObject({
      converter: null,
      permission: true,
    });
    const lo = { id: "libreoffice", label: "LibreOffice", soffice: "/usr/bin/soffice" };
    expect(planoAposBloqueio(lo, "auto", null)).toMatchObject({ converter: lo, fallback: false });
  });
});
