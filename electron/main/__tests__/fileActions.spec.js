// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { rename, setHidden, trash, reveal, readHidden, HIDDEN_FILE } = require("../fileActions.js");
const { listDir } = require("../fileBrowser.js");
const seriesFile = require("../seriesFile.js");

describe("fileActions", () => {
  let dir;
  const file = (name) => path.join(dir, name);

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lj-actions-"));
    fs.writeFileSync(file("aviso.png"), "img");
    fs.writeFileSync(file("outro.png"), "img");
    fs.mkdirSync(file("Sub"));
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("renomeia mantendo a extensão e sem sobrescrever outro arquivo", async () => {
    expect(await rename(file("aviso.png"), "outro.png")).toEqual({ ok: false, error: "exists" });
    expect(await rename(file("aviso.png"), "aviso.jpg")).toEqual({ ok: false, error: "extension_changed" });
    expect((await rename(file("aviso.png"), "a/b.png")).error).toBe("invalid_name");
    expect((await rename(file("aviso.png"), ".escondido.png")).error).toBe("invalid_name");
    const ok = await rename(file("aviso.png"), " Aviso da semana.PNG ");
    expect(ok).toEqual({ ok: true, path: file("Aviso da semana.PNG"), name: "Aviso da semana.PNG" });
    expect(fs.existsSync(file("Aviso da semana.PNG"))).toBe(true);
  });

  it("pasta não se renomeia nem vai para a Lixeira", async () => {
    expect((await rename(file("Sub"), "Outra")).error).toBe("not_found");
    const shell = { trashItem: vi.fn() };
    expect((await trash(file("Sub"), shell)).error).toBe("not_found");
    expect(shell.trashItem).not.toHaveBeenCalled();
  });

  it("ocultar grava na pasta, a listagem marca e o nome novo leva a marca", async () => {
    expect(await setHidden(file("aviso.png"), true)).toEqual({ ok: true });
    expect([...(await readHidden(dir))]).toEqual(["aviso.png"]);
    const listed = await listDir(dir);
    const byName = Object.fromEntries(listed.entries.map((e) => [e.name, e]));
    expect(byName["aviso.png"].hidden).toBe(true);
    expect(byName["outro.png"].hidden).toBeUndefined();
    expect(byName[HIDDEN_FILE]).toBeUndefined();

    await rename(file("aviso.png"), "aviso-novo.png");
    expect([...(await readHidden(dir))]).toEqual(["aviso-novo.png"]);

    await setHidden(file("aviso-novo.png"), false);
    expect(fs.existsSync(file(HIDDEN_FILE))).toBe(false);
  });

  it("Lixeira usa o shell e tira a marca do arquivo", async () => {
    await setHidden(file("aviso.png"), true);
    const shell = { trashItem: vi.fn(async (p) => fs.rmSync(p)) };
    expect(await trash(file("aviso.png"), shell)).toEqual({ ok: true });
    expect(shell.trashItem).toHaveBeenCalledWith(file("aviso.png"));
    expect((await readHidden(dir)).size).toBe(0);
  });

  it("mostrar no Finder só com caminho que existe", async () => {
    const shell = { showItemInFolder: vi.fn() };
    expect(await reveal(file("aviso.png"), shell)).toEqual({ ok: true });
    expect((await reveal(file("nada.png"), shell)).error).toBe("not_found");
    expect(shell.showItemInFolder).toHaveBeenCalledTimes(1);
  });

  it("renomear um vídeo da série leva o histórico junto", async () => {
    await seriesFile.apply(dir, { type: "create", name: "Série" });
    await seriesFile.apply(dir, { type: "play", file: "aviso.png" });
    await rename(file("aviso.png"), "episodio-1.png", {
      renameInSeries: (d, from, to) => seriesFile.apply(d, { type: "rename", from, to }),
    });
    const { series } = await seriesFile.read(dir);
    expect(series.plays.map((p) => p.file)).toEqual(["episodio-1.png"]);
  });
});
