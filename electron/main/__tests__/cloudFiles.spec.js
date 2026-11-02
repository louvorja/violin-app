// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRequire } from "module";
import fs from "fs";
import os from "os";
import path from "path";

const require = createRequire(import.meta.url);
const { createCloudFiles, stateFromStat, parseWindowsListing } = require("../cloudFiles.js");

let dir;
beforeEach(() => (dir = fs.mkdtempSync(path.join(os.tmpdir(), "lj-cloud-"))));
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("cloudFiles", () => {
  it("só na nuvem: tamanho cheio e nenhum bloco no disco", () => {
    const file = { isFile: () => true };
    expect(stateFromStat({ ...file, size: 26537474, blocks: 0 })).toBe("cloud");
    expect(stateFromStat({ ...file, size: 26537474, blocks: 51832 })).toBe("local");
    expect(stateFromStat({ ...file, size: 0, blocks: 0 })).toBe("local");
  });

  it("Windows: atributos de recuperar ao acessar / offline marcam a nuvem", () => {
    const listing = parseWindowsListing("5248544\tMinuto 01.mp4\r\n32\tAnúncio.png\r\n4198432\tOffline.pdf\r\n");
    expect(listing.get("Minuto 01.mp4")).toBe("cloud");
    expect(listing.get("Anúncio.png")).toBe("local");
    expect(listing.get("Offline.pdf")).toBe("cloud");
  });

  it("Windows: uma consulta por pasta, com a pasta em variável de ambiente", async () => {
    const calls = [];
    const execImpl = (cmd, args, opts, cb) => {
      calls.push(opts.env.LJ_DIR);
      cb(null, "5248544\ta.mp4\n32\tb.png\n");
    };
    const cloud = createCloudFiles({ platform: "win32", execImpl });
    const a = path.join(dir, "a.mp4");
    const b = path.join(dir, "b.png");
    expect(await cloud.states([a, b])).toEqual({ [a]: "cloud", [b]: "local" });
    expect(calls).toEqual([dir]);
  });

  it("macOS: arquivo comum é local; caminho relativo ou inexistente fica de fora", async () => {
    const file = path.join(dir, "video.mp4");
    fs.writeFileSync(file, Buffer.alloc(10_000, 1));
    const cloud = createCloudFiles({ platform: "darwin" });
    expect(await cloud.states([file, "relativo.mp4", path.join(dir, "sumiu.mp4")])).toEqual({ [file]: "local" });
  });

  it("baixar lê o arquivo até o fim, com andamento, e pedidos repetidos esperam o mesmo", async () => {
    const file = path.join(dir, "grande.mp4");
    fs.writeFileSync(file, Buffer.alloc(3 * 1024 * 1024 + 10, 2));
    const cloud = createCloudFiles({ platform: "darwin" });
    const seen = [];
    const [a, b] = await Promise.all([cloud.download(file, (p) => seen.push(p)), cloud.download(file)]);
    expect(a).toEqual({ ok: true });
    expect(b).toEqual({ ok: true });
    expect(seen.at(-1)).toBe(100);
    expect(await cloud.download(path.join(dir, "sumiu.mp4"))).toEqual({ ok: false, error: "not_found" });
    expect(await cloud.download("relativo.mp4")).toEqual({ ok: false, error: "invalid_path" });
  });
});
