// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const fs = require("fs-extra");
const base = fs.mkdtempSync(path.join(os.tmpdir(), "lj-persistent-stores-"));

// paths.js depende de Electron; estes stores precisam apenas da raiz mutavel.
const pathsModule = require.resolve("../paths.js");
require.cache[pathsModule] = {
  id: pathsModule,
  filename: pathsModule,
  loaded: true,
  exports: { dataDir: () => base },
};

const userStore = require("../userStore.js");
const docStore = require("../docStore.js");

beforeAll(() => fs.ensureDir(base));

afterAll(async () => {
  await Promise.allSettled([userStore.flush(), docStore.flush()]);
  await fs.remove(base);
});

describe("userStore assíncrono", () => {
  it("expoe a revisao mais nova durante a fila e persiste somente ela", async () => {
    const first = userStore.write("burst", { revision: 1 });
    const last = userStore.write("burst", { revision: 2 });

    expect(userStore.read("burst")).toEqual({ revision: 2 });
    await userStore.flush();
    const results = await Promise.all([first, last]);

    expect(results[0].revision).toBe(results[1].revision);
    expect(await fs.readJson(path.join(base, "storage", "burst.json"))).toEqual({
      revision: 2,
    });
  });
});

describe("docStore assíncrono", () => {
  it("coalesce a colecao inteira e flush confirma a ultima versao", async () => {
    const first = docStore.write("liturgies", [{ id: "old" }]);
    const last = docStore.write("liturgies", [{ id: "new" }, { id: "latest" }]);

    expect(docStore.read("liturgies")).toEqual([{ id: "new" }, { id: "latest" }]);
    expect(docStore.list()).toContain("liturgies");
    await docStore.flush();
    const results = await Promise.all([first, last]);

    expect(results[0].revision).toBe(results[1].revision);
    expect(await fs.readJson(path.join(base, "library", "liturgies.json"))).toEqual([
      { id: "new" },
      { id: "latest" },
    ]);
  });
});
