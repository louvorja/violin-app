// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { retainWebAssets, RETENTION_LIMITS, RETENTION_MANIFEST } from "../retain-web-assets.mjs";

let root;
const now = Date.UTC(2026, 9, 10);
const oldScript = "assets/Index-aaaaaaaa.js";
const oldStyle = "assets/Index-bbbbbbbb.css";
const currentScript = "assets/Index-cccccccc.js";

async function build(name, files) {
  const directory = path.join(root, name);
  await fs.mkdir(path.join(directory, "assets"), { recursive: true });
  for (const [relative, content] of Object.entries(files)) {
    await fs.writeFile(path.join(directory, relative), content);
  }
  return directory;
}

async function retain(directory, previousDirectory, at = now) {
  return retainWebAssets({ directory, previousDirectory, previousCreatedAt: at - 1000, now: at });
}

const manifest = async (directory) =>
  JSON.parse(await fs.readFile(path.join(directory, RETENTION_MANIFEST), "utf8"));

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "lj-retained-assets-"));
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("web deployment asset retention", () => {
  it("keeps old lazy JS/CSS without replacing HTML, SW, or copying arbitrary/source-map files", async () => {
    const previous = await build("previous", {
      [oldScript]: "export default 'A'",
      [oldStyle]: ".old { color: red }",
      "index.html": "old HTML",
      "sw.js": "old SW",
      "assets/Index-aaaaaaaa.js.map": "private source map",
      "assets/user-data.json": "private data",
    });
    const current = await build("current", {
      [currentScript]: "export default 'B'",
      "index.html": "new HTML",
      "sw.js": "new SW",
    });

    expect(await retain(current, previous)).toMatchObject({ releases: 2, copiedFiles: 2 });
    expect(await fs.readFile(path.join(current, oldScript), "utf8")).toBe("export default 'A'");
    expect(await fs.readFile(path.join(current, oldStyle), "utf8")).toBe(".old { color: red }");
    expect(await fs.readFile(path.join(current, "index.html"), "utf8")).toBe("new HTML");
    expect(await fs.readFile(path.join(current, "sw.js"), "utf8")).toBe("new SW");
    expect(await fs.readdir(path.join(current, "assets"))).toEqual(
      expect.arrayContaining(["Index-aaaaaaaa.js", "Index-bbbbbbbb.css", "Index-cccccccc.js"])
    );
    expect(await fs.readdir(path.join(current, "assets"))).toHaveLength(3);
  });

  it("bounds retained generations across consecutive deploys and removes the oldest as a complete build", async () => {
    let previous;
    const paths = [];
    for (let i = 0; i < RETENTION_LIMITS.releases + 2; i++) {
      const relative = `assets/Index-${String(i).padStart(8, "0")}.js`;
      paths.push(relative);
      const current = await build(`deploy-${i}`, { [relative]: String(i) });
      await retain(current, previous, now + i * 1000);
      previous = current;
    }

    const retained = await manifest(previous);
    expect(retained.releases).toHaveLength(RETENTION_LIMITS.releases);
    for (const relative of paths.slice(0, 2))
      await expect(fs.stat(path.join(previous, relative))).rejects.toMatchObject({
        code: "ENOENT",
      });
    for (const relative of paths.slice(2))
      expect((await fs.stat(path.join(previous, relative))).isFile()).toBe(true);
  });

  it("drops expired builds and preserves every current asset", async () => {
    const previous = await build("previous", { [oldScript]: "old" });
    await retain(previous, undefined, now - RETENTION_LIMITS.ageMs - 1);
    const current = await build("current", { [currentScript]: "current" });

    expect(await retain(current, previous)).toMatchObject({ releases: 1, copiedFiles: 0 });
    expect(await fs.readdir(path.join(current, "assets"))).toEqual(["Index-cccccccc.js"]);
  });

  it("never trims the current build when it exceeds the byte budget; skips whole previous generations", async () => {
    const previous = await build("previous", { [oldScript]: "old", [oldStyle]: "old CSS" });
    const current = await build("current", { [currentScript]: "" });
    const handle = await fs.open(path.join(current, currentScript), "r+");
    await handle.truncate(RETENTION_LIMITS.bytes + 1);
    await handle.close();

    expect(await retain(current, previous)).toMatchObject({
      releases: 1,
      copiedFiles: 0,
      bytes: RETENTION_LIMITS.bytes + 1,
    });
    expect((await fs.stat(path.join(current, currentScript))).size).toBe(
      RETENTION_LIMITS.bytes + 1
    );
    expect(await fs.readdir(path.join(current, "assets"))).toEqual(["Index-cccccccc.js"]);
  });

  it("rejects unsafe manifest paths before copying anything", async () => {
    const previous = await build("previous", { [oldScript]: "old" });
    await retain(previous);
    const unsafe = await manifest(previous);
    unsafe.releases[0].assets[0].path = "assets/../../secret";
    await fs.writeFile(path.join(previous, RETENTION_MANIFEST), JSON.stringify(unsafe));
    const current = await build("current", { [currentScript]: "current" });

    await expect(retain(current, previous)).rejects.toThrow("Invalid retention release");
    expect(await fs.readdir(path.join(current, "assets"))).toEqual(["Index-cccccccc.js"]);
  });

  it("rejects modified retained bytes and hashed-filename collisions", async () => {
    const previous = await build("previous", { [oldScript]: "old" });
    await retain(previous);
    await fs.writeFile(path.join(previous, oldScript), "corrupt");
    const current = await build("current", { [currentScript]: "current" });

    await expect(retain(current, previous)).rejects.toThrow("integrity mismatch");
    const collision = await build("collision", { [oldScript]: "different bytes" });
    await expect(retain(collision, previous)).rejects.toThrow("Immutable asset collision");
  });

  it("rejects symlink assets during legacy migration", async () => {
    const previous = await build("previous", { "secret.txt": "private" });
    await fs.symlink(path.join(previous, "secret.txt"), path.join(previous, oldScript));
    const current = await build("current", { [currentScript]: "current" });

    await expect(retain(current, previous)).rejects.toThrow("Invalid asset file");
  });
});
