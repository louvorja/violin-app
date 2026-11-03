// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import path from "node:path";
import os from "node:os";

const require = createRequire(import.meta.url);
const fs = require("fs-extra");
const recovery = require("../storageRecovery.js");

let root;
let bootstrap;
const put = (file, content = "x") => fs.outputFileSync(file, content);
const exists = (file) => fs.existsSync(file);

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lj-recovery-")));
  bootstrap = path.join(root, "LouvorJA Violin");
});

afterEach(() => {
  fs.removeSync(root);
});

describe("reparar", () => {
  it("refaz caches e ferramentas sem tocar em preferências, documentos e bancos", () => {
    const profile = path.join(bootstrap, "profile");
    const chromium = path.join(profile, ".electron");
    for (const name of ["Cache/data_0", "Code Cache/js/a", "GPUCache/data", "DawnWebGPUCache/x"]) put(path.join(chromium, name));
    put(path.join(chromium, "IndexedDB/louvorja/000.ldb"), "favoritos");
    put(path.join(chromium, "Local Storage/leveldb/1.log"), "local");
    put(path.join(profile, "bin/ytdlp/abc/yt-dlp"));
    put(path.join(profile, "temp/videos/.ytdlp-cache/player.json"));
    put(path.join(profile, "storage/user_data.json"), "{}");
    put(path.join(profile, "library/musics.playlists.json"), "[]");

    recovery.request(bootstrap, "repair");
    expect(recovery.applyRequest(bootstrap)).toEqual({ freshStart: false });

    for (const gone of ["Cache", "Code Cache", "GPUCache", "DawnWebGPUCache"]) expect(exists(path.join(chromium, gone))).toBe(false);
    expect(exists(path.join(profile, "bin"))).toBe(false);
    expect(exists(path.join(profile, "temp/videos/.ytdlp-cache"))).toBe(false);
    expect(fs.readFileSync(path.join(chromium, "IndexedDB/louvorja/000.ldb"), "utf8")).toBe("favoritos");
    expect(exists(path.join(chromium, "Local Storage/leveldb/1.log"))).toBe(true);
    expect(exists(path.join(profile, "storage/user_data.json"))).toBe(true);
    expect(exists(path.join(profile, "library/musics.playlists.json"))).toBe(true);
    // O pedido foi consumido: a próxima abertura não repara de novo.
    expect(recovery.applyRequest(bootstrap)).toEqual({ freshStart: false });
  });
});

describe("começar do zero", () => {
  it("continua guardando o perfil em recovery/", () => {
    put(path.join(bootstrap, "profile/storage/user_data.json"), "{}");
    put(path.join(bootstrap, "storage-layout.json"), "{}");
    recovery.request(bootstrap, "reset");
    expect(recovery.applyRequest(bootstrap)).toEqual({ freshStart: true });
    const [copy] = fs.readdirSync(path.join(bootstrap, "recovery"));
    expect(exists(path.join(bootstrap, "recovery", copy, "profile/storage/user_data.json"))).toBe(true);
  });
});

describe("reset total", () => {
  function scenario({ mediaShared = false, legacyName = "LouvorJA Violin" } = {}) {
    const legacy = path.join(root, "Documents", legacyName);
    const media = path.join(root, "Acervo");
    const videos = path.join(root, "Movies", "LouvorJA Violin");
    put(path.join(bootstrap, "profile/storage/user_data.json"), "{}");
    put(path.join(bootstrap, "recovery/2026-01-01-comecar-do-zero/profile/x"));
    put(path.join(bootstrap, "data-location.json"), JSON.stringify({ dataDir: legacy }));
    put(path.join(bootstrap, "storage-layout.json"), JSON.stringify({
      version: 1, mediaDir: media, videosDir: videos, legacyRoot: legacy, mediaShared, videosShared: false,
    }));
    for (const name of [".electron/Cache/a", "storage/user_data.json", "json_db/x.json", "bin/yt-dlp", "server/a"]) put(path.join(legacy, name));
    put(path.join(legacy, "files/musics/pt/antiga.mp3"), "acervo antigo");
    put(path.join(media, "musics/pt/hino.mp3"), "hino");
    put(path.join(media, "anotacoes.txt"), "do usuário");
    put(path.join(media, ".louvorja-collection.json"), JSON.stringify({ version: 1, kind: "media", shared: mediaShared }));
    put(path.join(videos, "abcdefghijk.mp4"), "video");
    put(path.join(videos, "abcdefghijk.keep"), "");
    put(path.join(videos, "Casamento.mp4"), "pessoal");
    return { legacy, media, videos };
  }

  it("apaga perfil, registro, cópias de recuperação, âncora e o perfil antigo, sem cópia", () => {
    const { legacy, media, videos } = scenario();
    recovery.request(bootstrap, "wipe");
    expect(recovery.applyRequest(bootstrap)).toEqual({ freshStart: true });

    for (const gone of ["profile", "storage-layout.json", "recovery", "data-location.json"]) {
      expect(exists(path.join(bootstrap, gone))).toBe(false);
    }
    for (const gone of [".electron", "storage", "json_db", "bin", "server"]) expect(exists(path.join(legacy, gone))).toBe(false);
    // Sem pedir, acervo e vídeos ficam — inclusive o acervo que mora na pasta antiga.
    expect(exists(path.join(legacy, "files/musics/pt/antiga.mp3"))).toBe(true);
    expect(exists(path.join(media, "musics/pt/hino.mp3"))).toBe(true);
    expect(exists(path.join(videos, "abcdefghijk.mp4"))).toBe(true);
  });

  it("com acervo e vídeos marcados, apaga só o que o app gerencia", () => {
    const { media, videos } = scenario();
    recovery.request(bootstrap, "wipe", { media: true, videos: true });
    recovery.applyRequest(bootstrap);

    expect(exists(path.join(media, "musics"))).toBe(false);
    expect(fs.readFileSync(path.join(media, "anotacoes.txt"), "utf8")).toBe("do usuário");
    expect(exists(path.join(videos, "abcdefghijk.mp4"))).toBe(false);
    expect(exists(path.join(videos, "abcdefghijk.keep"))).toBe(false);
    expect(fs.readFileSync(path.join(videos, "Casamento.mp4"), "utf8")).toBe("pessoal");
  });

  it("acervo compartilhado com outras contas não é apagado", () => {
    const { media } = scenario({ mediaShared: true });
    recovery.request(bootstrap, "wipe", { media: true });
    recovery.applyRequest(bootstrap);
    expect(exists(path.join(media, "musics/pt/hino.mp3"))).toBe(true);
  });

  it("pasta antiga que não é claramente do app (Documentos inteira) não é limpa", () => {
    const { legacy } = scenario({ legacyName: "Documentos" });
    recovery.request(bootstrap, "wipe");
    recovery.applyRequest(bootstrap);
    expect(exists(path.join(legacy, "storage/user_data.json"))).toBe(true);
    expect(exists(path.join(legacy, "bin/yt-dlp"))).toBe(true);
  });

  it("pedido desconhecido é recusado", () => {
    expect(() => recovery.request(bootstrap, "formatar")).toThrow(/desconhecido/);
  });
});
