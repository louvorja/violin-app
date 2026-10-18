// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const fs = require("fs-extra");
const { migrateVideoWork } = require("../onlineVideo/workMigration.js");
const { migrateDownloads } = require("../onlineVideo/migration.js");
const A = "aaaaaaaaaaa";
const B = "bbbbbbbbbbb";
let root;
let target;

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lj-video-work-")));
  target = path.join(root, "profile", "temp", "videos");
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.removeSync(root);
});

describe("migração do trabalho privado de vídeos", () => {
  it("leva o registro de importação para não restaurar vídeos já excluídos", async () => {
    const source = path.join(root, "old-work");
    const legacy = path.join(root, "online_videos");
    const videos = path.join(root, "videos");
    fs.outputFileSync(path.join(legacy, `${A}.mp4`), "preserved original");
    fs.outputJsonSync(path.join(source, ".legacy-downloads-v1.json"), { version: 1, sources: [legacy] });
    fs.outputJsonSync(path.join(target, ".legacy-downloads-v1.json"), { version: 1, sources: ["/earlier-origin"] });
    migrateVideoWork([source, legacy], target);
    expect(fs.readJsonSync(path.join(target, ".legacy-downloads-v1.json"))).toEqual({
      version: 1, sources: ["/earlier-origin", legacy],
    });
    await migrateDownloads(legacy, videos, { workDir: target });
    expect(fs.existsSync(path.join(videos, `${A}.mp4`))).toBe(false);
    expect(fs.readFileSync(path.join(legacy, `${A}.mp4`), "utf8")).toBe("preserved original");
  });

  it("preserva registros inválidos e não conclui a migração silenciosamente", () => {
    const source = path.join(root, "old-work");
    fs.outputJsonSync(path.join(source, ".legacy-downloads-v1.json"), { version: 1, sources: [false] });
    expect(() => migrateVideoWork([source], target)).toThrow("registro");
    expect(fs.existsSync(path.join(target, ".legacy-work-v1.json"))).toBe(false);
    expect(fs.readJsonSync(path.join(source, ".legacy-downloads-v1.json"))).toEqual({ version: 1, sources: [false] });
  });

  it("preserva checkpoints e cache, sem copiar streams, vídeos prontos ou itens desconhecidos", () => {
    const source = path.join(root, "legacy-videos");
    const checkpoint = JSON.stringify({ downloader: { current_fragment: { index: 7 }, fragment_count: 20 } });
    fs.outputFileSync(path.join(source, ".partial", A, `${A}.f137.mp4.part`), "bytes recebidos");
    fs.outputFileSync(path.join(source, ".partial", A, `${A}.f137.mp4.ytdl`), checkpoint);
    fs.outputFileSync(path.join(source, ".ytdlp-cache", "youtube", "player.json"), "cached player");
    fs.outputFileSync(path.join(source, ".stream", A, "video.mp4"), "disposable stream");
    fs.outputFileSync(path.join(source, ".partial", "unknown", "file"), "unrelated");
    fs.outputFileSync(path.join(source, `${A}.mp4`), "ready video");

    migrateVideoWork([source], target);

    expect(fs.readFileSync(path.join(target, ".partial", A, `${A}.f137.mp4.part`), "utf8")).toBe("bytes recebidos");
    expect(fs.readFileSync(path.join(target, ".partial", A, `${A}.f137.mp4.ytdl`), "utf8")).toBe(checkpoint);
    expect(fs.readFileSync(path.join(target, ".ytdlp-cache", "youtube", "player.json"), "utf8")).toBe("cached player");
    expect(fs.existsSync(path.join(target, ".stream"))).toBe(false);
    expect(fs.existsSync(path.join(target, ".partial", "unknown"))).toBe(false);
    expect(fs.existsSync(path.join(target, `${A}.mp4`))).toBe(false);
    expect(fs.readFileSync(path.join(source, ".partial", A, `${A}.f137.mp4.part`), "utf8")).toBe("bytes recebidos");
    expect(fs.readFileSync(path.join(source, ".stream", A, "video.mp4"), "utf8")).toBe("disposable stream");

    fs.removeSync(path.join(target, ".partial"));
    fs.removeSync(path.join(target, ".ytdlp-cache"));
    migrateVideoWork([source], target);
    expect(fs.existsSync(path.join(target, ".partial"))).toBe(false);
    expect(fs.existsSync(path.join(target, ".ytdlp-cache"))).toBe(false);
  });

  it("mantém cada checkpoint inteiro: destino atual e depois a primeira origem têm prioridade", () => {
    const first = path.join(root, "private-old");
    const second = path.join(root, "legacy-videos");
    fs.outputFileSync(path.join(target, ".partial", A, "current.part"), "current");
    fs.outputFileSync(path.join(first, ".partial", A, "old.part"), "old");
    fs.outputFileSync(path.join(first, ".partial", B, "first.part"), "first");
    fs.outputFileSync(path.join(second, ".partial", B, "second.part"), "second");
    migrateVideoWork([first, second], target);
    expect(fs.readdirSync(path.join(target, ".partial", A))).toEqual(["current.part"]);
    expect(fs.readdirSync(path.join(target, ".partial", B))).toEqual(["first.part"]);
  });

  it("falha de verificação não publica checkpoint parcial e permite repetir", () => {
    const source = path.join(root, "legacy-videos");
    fs.outputFileSync(path.join(source, ".partial", A, "video.part"), "complete original");
    const copy = vi.spyOn(fs, "copyFileSync").mockImplementationOnce((_from, to) => fs.writeFileSync(to, "short"));
    expect(() => migrateVideoWork([source], target)).toThrow("verificada");
    expect(fs.existsSync(path.join(target, ".partial", A))).toBe(false);
    expect(fs.existsSync(path.join(target, ".legacy-work-v1.json"))).toBe(false);
    expect(fs.readdirSync(target)).toEqual([]);
    expect(fs.readFileSync(path.join(source, ".partial", A, "video.part"), "utf8")).toBe("complete original");
    copy.mockRestore();
    migrateVideoWork([source], target);
    expect(fs.readFileSync(path.join(target, ".partial", A, "video.part"), "utf8")).toBe("complete original");
  });

  it("não segue links em uma pasta de checkpoint nem marca a origem como concluída", () => {
    const source = path.join(root, "legacy-videos");
    const outside = path.join(root, "outside");
    fs.outputFileSync(path.join(outside, "secret"), "private outside");
    fs.ensureDirSync(path.join(source, ".partial", A));
    fs.symlinkSync(outside, path.join(source, ".partial", A, "link"), process.platform === "win32" ? "junction" : "dir");
    expect(() => migrateVideoWork([source], target)).toThrow("link");
    expect(fs.existsSync(path.join(target, ".partial", A))).toBe(false);
    expect(fs.existsSync(path.join(target, ".legacy-work-v1.json"))).toBe(false);
    expect(fs.readFileSync(path.join(outside, "secret"), "utf8")).toBe("private outside");
  });
});
