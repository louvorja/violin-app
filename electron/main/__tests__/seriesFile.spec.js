// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRequire } from "module";
import os from "os";
import path from "path";
import fs from "fs";
import { IMAGE_EXT, VIDEO_EXT } from "../../../src/constants/FileTypes";

const require = createRequire(import.meta.url);
const series = require("../seriesFile.js");

let dir;
const touch = (...names) => names.forEach((n) => fs.writeFileSync(path.join(dir, n), "x"));
const raw = () => JSON.parse(fs.readFileSync(path.join(dir, series.FILE_NAME), "utf8"));
const active = (doc) => doc.plays.filter((p) => !p.undone && p.cycle === doc.cycle).map((p) => p.file);

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "lj-series-"));
  touch("01.mp4", "02.mp4", "notas.pdf");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("seriesFile", () => {
  it("a lista de mídia é a mesma do renderer", () => {
    expect([...series.MEDIA_EXT].sort()).toEqual([...VIDEO_EXT, ...IMAGE_EXT].sort());
  });

  it("pasta sem série devolve null; caminho relativo e operação inválida são recusados", async () => {
    expect(await series.read(dir)).toEqual({ ok: true, series: null, versions: [] });
    expect((await series.read("relativo")).ok).toBe(false);
    expect((await series.apply(dir, { type: "play", file: "01.mp4" })).error).toBe("not_a_series");
    expect((await series.apply(dir, "x")).ok).toBe(false);
  });

  it("registra exibições sobre o que está no disco, com o ciclo do disco", async () => {
    await series.apply(dir, { type: "create", name: "Momento Saúde", onEnd: "suggest_new" });
    // Outro computador recomeçou a série enquanto esta cópia estava aberta.
    fs.writeFileSync(path.join(dir, series.FILE_NAME), JSON.stringify({ ...raw(), cycle: 4 }));
    const res = await series.apply(dir, { type: "play", file: "01.mp4" });
    expect(res.series.plays.at(-1)).toMatchObject({ file: "01.mp4", cycle: 4 });
  });

  it("registrar um vídeo não desfaz configurações de outro computador", async () => {
    await series.apply(dir, { type: "create", name: "Saúde", onEnd: "restart" });
    await series.apply(dir, { type: "settings", active: false });
    const res = await series.apply(dir, { type: "play", file: "01.mp4" });
    expect(res.series.active).toBe(false);
  });

  it("com todos os vídeos passados, recomeça sozinho — PDF não conta", async () => {
    await series.apply(dir, { type: "create", name: "Saúde", onEnd: "restart" });
    await series.apply(dir, { type: "play", file: "01.mp4" });
    const res = await series.apply(dir, { type: "play", file: "02.mp4" });
    expect(res.series.cycle).toBe(2);
    expect(active(res.series)).toEqual([]);
  });

  it("recomeçar só vale uma vez por ciclo, mesmo pedido por dois computadores", async () => {
    await series.apply(dir, { type: "create", name: "S", onEnd: "suggest_new" });
    await series.apply(dir, { type: "restart", fromCycle: 1 });
    const res = await series.apply(dir, { type: "restart", fromCycle: 1 });
    expect(res.series.cycle).toBe(2);
  });

  it("gravações simultâneas na mesma pasta não se perdem", async () => {
    await series.apply(dir, { type: "create", name: "S", onEnd: "suggest_new" });
    await Promise.all([
      series.apply(dir, { type: "play", file: "01.mp4" }),
      series.apply(dir, { type: "play", file: "02.mp4" }),
      series.apply(dir, { type: "undo", file: "01.mp4" }),
    ]);
    expect(active(raw())).toEqual(["02.mp4"]);
  });

  it("histórico ilegível (meio sincronizado) não é sobrescrito", async () => {
    fs.writeFileSync(path.join(dir, series.FILE_NAME), "{ meio");
    expect((await series.read(dir)).error).toBe("unreadable");
    expect((await series.apply(dir, { type: "create", name: "S", onEnd: "restart" })).error).toBe("unreadable");
    expect(fs.readFileSync(path.join(dir, series.FILE_NAME), "utf8")).toBe("{ meio");
  });

  describe("cópias em conflito", () => {
    const copy = (name, plays) =>
      fs.writeFileSync(path.join(dir, name), JSON.stringify({ ...raw(), settingsAt: "2026-01-01", plays }));
    const play = (id, file) => ({ id, file, at: `2026-09-2${id.length}T19:00:00Z`, cycle: 1 });

    beforeEach(async () => {
      await series.apply(dir, { type: "create", name: "S", onEnd: "suggest_new" });
      await series.apply(dir, { type: "play", file: "01.mp4" });
    });

    it("reconhece os padrões dos sincronizadores, e só eles", () => {
      for (const n of [".louvorja-serie-IGREJA-PC.json", ".louvorja-serie (1).json", ".louvorja-serie 2.json"]) {
        expect(series.CONFLICT_RE.test(n), n).toBe(true);
      }
      expect(series.CONFLICT_RE.test(".louvorja-serie.json.123.tmp")).toBe(false);
      expect(series.CONFLICT_RE.test("louvorja-serie-x.json")).toBe(false);
    });

    it("descreve cada versão, com a principal marcada", async () => {
      copy(".louvorja-serie-IGREJA-PC.json", [play("b", "02.mp4")]);
      const res = await series.read(dir);
      expect(res.versions.map((v) => [v.name, v.main, v.plays])).toEqual([
        [series.FILE_NAME, true, 1],
        [".louvorja-serie-IGREJA-PC.json", false, 1],
      ]);
    });

    it("juntar: nada se perde e a cópia lida sai da pasta", async () => {
      copy(".louvorja-serie-IGREJA-PC.json", [play("b", "02.mp4")]);
      const res = await series.resolve(dir, "merge");
      expect(active(res.series).sort()).toEqual(["01.mp4", "02.mp4"]);
      expect(fs.existsSync(path.join(dir, ".louvorja-serie-IGREJA-PC.json"))).toBe(false);
    });

    it("cópia ilegível (ainda baixando) fica na pasta e é avisada", async () => {
      fs.writeFileSync(path.join(dir, ".louvorja-serie (1).json"), "{ meio");
      const res = await series.resolve(dir, "merge");
      expect(res).toMatchObject({ ok: true, partial: 1 });
      expect(fs.existsSync(path.join(dir, ".louvorja-serie (1).json"))).toBe(true);
    });

    it("nome fora da lista é recusado", async () => {
      expect((await series.resolve(dir, "../x.json")).ok).toBe(false);
    });
  });
});
