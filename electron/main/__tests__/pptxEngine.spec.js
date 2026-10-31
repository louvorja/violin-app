// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "fs";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { detectConverter, ENGINES } = require("../pptx/converters.js");
const { PY_SCRIPT } = require("../pptx/libreShowScript.js");

describe("escolha do programa de apresentações", () => {
  afterEach(() => vi.restoreAllMocks());

  it("aceita só os três valores das Opções", () => {
    expect(ENGINES).toEqual(["auto", "powerpoint", "libreoffice"]);
  });

  it("no Linux com LibreOffice, 'auto' usa o LibreOffice sem aviso", async () => {
    vi.spyOn(fs, "existsSync").mockImplementation((p) => String(p) === "/usr/bin/soffice");
    const c = await detectConverter("linux", "auto");
    expect(c.id).toBe("libreoffice");
    expect(c.fallback).toBe(false);
    expect(c.disponiveis).toEqual({ powerpoint: false, libreoffice: true });
  });

  it("pedido o PowerPoint onde ele não existe, usa o outro e avisa", async () => {
    vi.spyOn(fs, "existsSync").mockImplementation((p) => String(p) === "/usr/bin/soffice");
    const c = await detectConverter("linux", "powerpoint");
    expect(c.id).toBe("libreoffice");
    expect(c.fallback).toBe(true);
  });

  it("valor desconhecido vira 'auto'", async () => {
    vi.spyOn(fs, "existsSync").mockImplementation((p) => String(p) === "/usr/bin/soffice");
    const c = await detectConverter("linux", "qualquer");
    expect(c.preferido).toBe("auto");
  });

  it("sem nenhum programa, não escolhe nada", async () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(false);
    const c = await detectConverter("linux", "libreoffice");
    expect(c.id).toBe(null);
  });

  it("a ponte do LibreOffice fala o mesmo protocolo da do PowerPoint", () => {
    expect(PY_SCRIPT).toContain('enviar({"id": 0, "ok": True, "result": {"ready": True}})');
    for (const cmd of ["start", "nav", "state", "end", "quit"]) expect(PY_SCRIPT).toContain(`cmd == "${cmd}"`);
    expect(PY_SCRIPT).not.toContain("﻿");
  });
});
