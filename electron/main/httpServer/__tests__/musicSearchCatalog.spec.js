// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { createMusicSearchCatalog, normalize } = require("../musicSearchCatalog.js");

let root;
afterEach(async () => {
  vi.restoreAllMocks();
  if (root) await fs.rm(root, { recursive: true, force: true });
  root = null;
});

async function catalog(name = "pt_musics.json") {
  root ||= await fs.mkdtemp(path.join(os.tmpdir(), "lj-music-search-"));
  return path.join(root, name);
}

describe("HTTP music search catalog", () => {
  it("reuses parsed rows for concurrent and repeated searches", async () => {
    const file = await catalog();
    await fs.writeFile(file, JSON.stringify([
      { name: "Graça", albums_names: "Louvor" },
      { name: "Outra", albums_names: "Álbum" },
    ]));
    const read = vi.spyOn(fs, "readFile");
    const search = createMusicSearchCatalog();
    const [first, second] = await Promise.all([
      search.search(file, normalize("graca")),
      search.search(file, normalize("ALBUM")),
    ]);
    expect(first.map((item) => item.name)).toEqual(["Graça"]);
    expect(second.map((item) => item.name)).toEqual(["Outra"]);
    expect((await search.search(file, "louvor")).length).toBe(1);
    expect(read.mock.calls.filter(([filePath]) => filePath === file)).toHaveLength(1);
  });

  it("reloads after atomic replacement and does not return deleted catalog", async () => {
    const file = await catalog();
    const search = createMusicSearchCatalog();
    await fs.writeFile(file, JSON.stringify([{ name: "Antiga" }]));
    expect(await search.search(file, "antiga")).toHaveLength(1);

    const replacement = `${file}.tmp`;
    await fs.writeFile(replacement, JSON.stringify([{ name: "Nova" }]));
    await fs.rename(replacement, file);
    expect(await search.search(file, "antiga")).toEqual([]);
    expect((await search.search(file, "nova"))[0].name).toBe("Nova");

    await fs.unlink(file);
    await expect(search.search(file, "nova")).rejects.toMatchObject({ code: "ENOENT" });
    await fs.writeFile(file, JSON.stringify([{ name: "Recriada" }]));
    expect((await search.search(file, "recriada"))[0].name).toBe("Recriada");
  });

  it("keeps only two catalog versions and isolates paths", async () => {
    const pt = await catalog();
    const es = path.join(root, "es_musics.json");
    const other = path.join(root, "other_musics.json");
    await Promise.all([
      fs.writeFile(pt, '[{"name":"Português"}]'),
      fs.writeFile(es, '[{"name":"Español"}]'),
      fs.writeFile(other, '[{"name":"Other"}]'),
    ]);
    const read = vi.spyOn(fs, "readFile");
    const search = createMusicSearchCatalog();
    await search.search(pt, "portugues");
    await search.search(es, "espanol");
    await search.search(other, "other");
    expect((await search.search(pt, "portugues"))[0].name).toBe("Português");
    expect(read.mock.calls.filter(([filePath]) => filePath === pt)).toHaveLength(2);
  });
});
