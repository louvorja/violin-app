// @vitest-environment node
import fs from "fs-extra";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const queue = require("../telemetryErrorQueue.js");

const tempDirs = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.removeSync(dir);
});

function queuePath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "louvorja-telemetry-"));
  tempDirs.push(dir);
  return path.join(dir, "errors.json");
}

describe("telemetryErrorQueue", () => {
  it("persiste erro para recuperação após reinício", () => {
    const file = queuePath();
    expect(queue.enqueue(file, {
      id: "err-1",
      source: "electron.uncaught_exception",
      name: "TypeError",
      message: "falha",
      stack: "TypeError: falha\n    at main.cjs:10:2",
    })).toBe(true);

    expect(queue.read(file)).toEqual([
      expect.objectContaining({ id: "err-1", name: "TypeError", message: "falha" }),
    ]);
  });

  it("remove somente o erro confirmado pelo renderer", () => {
    const file = queuePath();
    queue.enqueue(file, { id: "err-1", message: "um" });
    queue.enqueue(file, { id: "err-2", message: "dois" });

    expect(queue.acknowledge(file, "err-1")).toBe(true);
    expect(queue.read(file).map((item) => item.id)).toEqual(["err-2"]);
  });
});
