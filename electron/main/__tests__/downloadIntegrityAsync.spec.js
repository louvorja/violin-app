// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
let root;
let integrity;
let resolver;

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "lj-integrity-"));
  const pathsId = require.resolve("../paths.js");
  require.cache[pathsId] = {
    id: pathsId,
    filename: pathsId,
    loaded: true,
    exports: { filesDir: () => path.join(root, "files") },
  };
  resolver = require("../mediaResolver.js");
  integrity = require("../download/integrity.js");
  resolver.setClassicRoot({ dir: path.join(root, "classic"), lang: "pt" });
  await fs.mkdir(path.join(root, "files", "musics", "pt"), { recursive: true });
  await fs.mkdir(path.join(root, "classic", "musicas"), { recursive: true });
  await fs.writeFile(path.join(root, "files", "musics", "pt", "current.opus"), "12345");
  await fs.writeFile(path.join(root, "classic", "musicas", "legacy.mp3"), "legacy");
  await fs.writeFile(path.join(root, "files", "musics", "pt", "empty.opus"), "");
});

afterAll(async () => {
  resolver?.clearClassicRoot();
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});

describe("download integrity without synchronous filesystem scans", () => {
  it("preserves source, variant, size and ordering contracts", async () => {
    const syncResolver = vi.spyOn(resolver, "resolveReadSync").mockImplementation(() => {
      throw new Error("synchronous resolver was used");
    });
    const own = await integrity.checkFile("musics/pt/current.opus", 5);
    const classic = await integrity.checkFile("musics/pt/legacy.opus", 6);
    expect(own).toMatchObject({ exists: true, sizeOk: true, actualSize: 5, origin: "own" });
    expect(classic).toMatchObject({ exists: true, sizeOk: true, actualSize: 6, origin: "classic" });

    const files = [
      { remote: "first", local: "musics/pt/missing.opus" },
      { remote: "second", local: "musics/pt/current.opus", expectedSize: 6 },
      { remote: "third", local: "musics/pt/legacy.opus" },
      { remote: "fourth", local: "musics/pt/empty.opus" },
    ];
    const result = await integrity.diff(files);
    expect(result.missing).toEqual([files[0], files[3]]);
    expect(result.damaged).toEqual([{ ...files[1], actualSize: 5 }]);
    expect(result.ok).toEqual([files[2]]);
    expect(syncResolver).not.toHaveBeenCalled();
  });
});
