// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import fs from "fs-extra";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Path from "@/helpers/Path";

const require = createRequire(import.meta.url);
const root = fs.mkdtempSync(join(tmpdir(), "louvorja-protocol-async-"));
const filesDir = join(root, "files");
const ownFile = join(filesDir, "musics", "pt", "hino.opus");
const localFile = join(root, "arquivo.mp3");
let handleRequest;

function stub(modulePath, exports) {
  const resolved = require.resolve(modulePath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

stub("electron", {
  protocol: { handle: (_scheme, handler) => { handleRequest = handler; } },
  app: { getAppPath: () => root },
});
stub("../paths.js", { filesDir: () => filesDir });
stub("../onlineVideo/index.js", { fileFor: () => null });

const protocol = require("../protocol.js");

describe("louvorja:// local media requests", () => {
  beforeAll(() => {
    fs.ensureDirSync(join(filesDir, "musics", "pt"));
    fs.writeFileSync(ownFile, "abcdefghij");
    fs.writeFileSync(localFile, "0123456789");
    protocol.handle();
  });

  afterAll(() => {
    fs.removeSync(root);
  });

  it("serves files and local paths with async stat while preserving full and Range responses", async () => {
    const syncStat = vi.spyOn(fs, "statSync").mockImplementation(() => {
      throw new Error("statSync reached from protocol request");
    });
    try {
      const full = await handleRequest(new Request("louvorja://files/musics/pt/hino.opus"));
      expect(full.status).toBe(200);
      expect(full.headers.get("Content-Length")).toBe("10");
      expect(await full.text()).toBe("abcdefghij");

      const ranged = await handleRequest(new Request(Path.local(localFile), {
        headers: { Range: "bytes=3-5" },
      }));
      expect(ranged.status).toBe(206);
      expect(ranged.headers.get("Content-Range")).toBe("bytes 3-5/10");
      expect(await ranged.text()).toBe("345");

      const beyondEnd = await handleRequest(new Request(Path.local(localFile), {
        headers: { Range: "bytes=10-" },
      }));
      expect(beyondEnd.status).toBe(416);
      expect(beyondEnd.headers.get("Content-Range")).toBe("bytes */10");

      const missing = await handleRequest(new Request(Path.local(join(root, "missing.mp3"))));
      expect(missing.status).toBe(404);
      expect(syncStat).not.toHaveBeenCalled();
    } finally {
      syncStat.mockRestore();
    }
  });
});
