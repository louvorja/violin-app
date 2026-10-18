// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import path from "node:path";
import os from "node:os";
const require = createRequire(import.meta.url);
const fs = require("fs-extra");
let root, library, source, media, writable;
const ids = ["../paths.js", "../storageAccess.js", "../classicLibrary.js"].map((file) => require.resolve(file));
beforeEach(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "classic-copy-")));
  source = path.join(root, "Classic", "config");
  media = path.join(root, "Media"); writable = true;
  await fs.outputFile(path.join(source, "musicas", "faixa.mp3"), "classic-media");
  await fs.outputFile(path.join(source, "database.db"), "database");
  await fs.ensureDir(media);
  require.cache[ids[0]] = { id: ids[0], filename: ids[0], loaded: true, exports: {
    dataDir: () => path.join(root, "Private"), filesDir: () => media, videosDir: () => path.join(root, "Videos"),
  } };
  require.cache[ids[1]] = { id: ids[1], filename: ids[1], loaded: true, exports: {
    assertWritable: () => { if (!writable) throw new Error("read-only"); },
  } };
  delete require.cache[ids[2]];
  library = require("../classicLibrary.js");
});
afterEach(async () => { for (const id of ids) delete require.cache[id]; await fs.remove(root); });

describe("Classic read-only source", () => {
  it("não assume português para uma origem sem idioma", () => {
    expect(library.normalizeSource({ dir: source })).toMatchObject({ ok: false, error: "language-required" });
    expect(library.normalizeSource({ dir: source, lang: "es" })).toMatchObject({ ok: true, lang: "es" });
    expect(library.normalizeSource({ dir: source, lang: "../pt" })).toMatchObject({ ok: false, error: "invalid-language" });
  });

  it("mantém idioma indefinido quando a instalação tem evidências conflitantes", async () => {
    await fs.outputFile(path.join(source, "configPT.ja"), "pt");
    await fs.outputFile(path.join(source, "configES.ja"), "es");
    expect(library.validate(source).lang).toBeNull();
    await fs.outputFile(path.join(root, "Classic", "PT.translate"), "_=PT");
    await fs.outputFile(path.join(root, "Classic", "ES.translate"), "_=ES");
    expect(library.validate(source).lang).toBeNull();
  });

  it("recusa tipos e caminhos relativos na fronteira", () => {
    for (const dir of [5, {}, "../Classic", ""]) expect(library.validate(dir).ok).toBe(false);
    expect(library.normalizeSource({ dir: source, enabled: "false" }).ok).toBe(false);
  });

  it("permite desativar uma origem cujo disco está ausente", () => {
    expect(library.normalizeSource({ dir: path.join(root, "absent"), enabled: false })).toMatchObject({ ok: true, enabled: false });
  });

  it("copia para o acervo exato e preserva todo o Classic", async () => {
    expect(await library.importFrom(source, { lang: "es" })).toMatchObject({ ok: true, copiadas: ["musicas"] });
    expect(await fs.readFile(path.join(media, "musics", "es", "faixa.mp3"), "utf8")).toBe("classic-media");
    expect(await fs.readFile(path.join(source, "musicas", "faixa.mp3"), "utf8")).toBe("classic-media");
    expect(await fs.readFile(path.join(source, "database.db"), "utf8")).toBe("database");
    expect(await fs.pathExists(path.join(media, "files"))).toBe(false);
  });

  it("recusa mover mesmo quando solicitado por uma interface antiga", async () => {
    expect(await library.importFrom(source, { lang: "pt", move: true })).toEqual({ ok: false, error: "move-not-supported" });
    expect(await fs.pathExists(path.join(source, "musicas", "faixa.mp3"))).toBe(true);
  });

  it("detecta conflitos antes de copiar qualquer arquivo", async () => {
    await fs.outputFile(path.join(source, "capas", "capa.jpg"), "cover");
    await fs.outputFile(path.join(media, "musics", "pt", "faixa.mp3"), "existing");
    expect(await library.importFrom(source, { lang: "pt" })).toEqual({ ok: false, error: "destination-exists" });
    expect(await fs.readFile(path.join(media, "musics", "pt", "faixa.mp3"), "utf8")).toBe("existing");
    expect(await fs.pathExists(path.join(media, "covers", "capa.jpg"))).toBe(false);
  });

  it("recusa links na origem ou em um ancestral do destino", async () => {
    await fs.symlink(path.join(source, "database.db"), path.join(source, "musicas", "linked.mp3"));
    expect(await library.importFrom(source, { lang: "pt" })).toEqual({ ok: false, error: "symbolic-link" });
    await fs.remove(path.join(source, "musicas", "linked.mp3"));
    await fs.ensureDir(path.join(root, "outside"));
    await fs.symlink(path.join(root, "outside"), path.join(media, "musics"), "junction");
    expect(await library.importFrom(source, { lang: "pt" })).toEqual({ ok: false, error: "symbolic-link" });
  });

  it("detecta sobreposição através de um ancestral com alias", async () => {
    await fs.symlink(path.join(root, "Classic"), path.join(root, "alias"), "junction");
    media = path.join(root, "alias", "config", "novo");
    expect(library.normalizeSource({ dir: source, lang: "pt" })).toMatchObject({ ok: false, error: "overlapping" });
  });

  it("não grava quando outro processo detém a pasta compartilhada", async () => {
    writable = false;
    expect(await library.importFrom(source, { lang: "pt" })).toEqual({ ok: false, error: "read-only" });
    expect(await fs.readdir(media)).toEqual([]);
  });
});
