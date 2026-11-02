// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { createRequire } from "module";
import { EventEmitter } from "events";
import { PassThrough } from "stream";

const require = createRequire(import.meta.url);
const collections = require("../onlineVideo/collections.js");

const CHANNEL = "UC" + "a".repeat(22);

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.pid = undefined;
  return child;
}

describe("collectionUrl", () => {
  it("monta a aba Vídeos do canal, pelo ID ou pelo @", () => {
    expect(collections.collectionUrl({ kind: "channel", id: CHANNEL })).toBe(
      `https://www.youtube.com/channel/${CHANNEL}/videos`
    );
    expect(collections.collectionUrl({ kind: "channel", id: "@novotempo" })).toBe(
      "https://www.youtube.com/@novotempo/videos"
    );
  });

  it("monta a playlist pelo ID", () => {
    expect(collections.collectionUrl({ kind: "playlist", id: "PLabcdefghijkl" })).toBe(
      "https://www.youtube.com/playlist?list=PLabcdefghijkl"
    );
  });

  it("recusa o que não é ID: URL, opção de linha de comando, caminho", () => {
    for (const id of ["--exec=rm", "https://evil.com", "../x", "@a b", "UCshort"]) {
      expect(collections.collectionUrl({ kind: "channel", id })).toBeNull();
      expect(collections.collectionUrl({ kind: "playlist", id })).toBeNull();
    }
    expect(collections.collectionUrl({ kind: "video", id: CHANNEL })).toBeNull();
    expect(collections.collectionUrl(null)).toBeNull();
  });
});

describe("buildListArgs", () => {
  it("lista sem baixar, só a página pedida, com a URL por último", () => {
    const args = collections.buildListArgs({ url: "https://www.youtube.com/@x/videos", start: 31, count: 30 });
    expect(args).toContain("--flat-playlist");
    expect(args).toContain("-J");
    expect(args[args.indexOf("--playlist-items") + 1]).toBe("31:60");
    expect(args.at(-1)).toBe("https://www.youtube.com/@x/videos");
    expect(args[args.indexOf("--extractor-args") + 1]).toBe("youtube:lang=pt");
  });

  it("aceita só idiomas conhecidos", () => {
    const args = collections.buildListArgs({ url: "u", start: 1, count: 1, lang: "es" });
    expect(args[args.indexOf("--extractor-args") + 1]).toBe("youtube:lang=es");
    const bad = collections.buildListArgs({ url: "u", start: 1, count: 1, lang: "pt,player_client=x" });
    expect(bad[bad.indexOf("--extractor-args") + 1]).toBe("youtube:lang=pt");
  });
});

describe("parseCollection", () => {
  it("fica só com vídeos válidos e diz se a página veio cheia", () => {
    const info = {
      channel: "Novo Tempo",
      title: "Novo Tempo - Videos",
      thumbnails: [
        { url: "https://yt3.googleusercontent.com/a=s88", width: 88, height: 88 },
        { url: "https://yt3.googleusercontent.com/a=s900", width: 900, height: 900 },
        { url: "https://evil.com/x.jpg", width: 2000, height: 2000 },
      ],
      entries: [
        { id: "dQw4w9WgXcQ", title: "Um", duration: 212.4 },
        { id: "curto", title: "Lixo" },
        { id: "aaaaaaaaaaa", title: "", duration: null },
      ],
    };
    const res = collections.parseCollection(info, "channel", 3);
    expect(res.title).toBe("Novo Tempo");
    expect(res.thumbnail).toBe("https://yt3.googleusercontent.com/a=s88");
    expect(res.entries).toEqual([
      { id: "dQw4w9WgXcQ", title: "Um", duration: 212 },
      { id: "aaaaaaaaaaa", title: "aaaaaaaaaaa", duration: null },
    ]);
    expect(res.hasMore).toBe(true);
    expect(collections.parseCollection(info, "playlist", 30).hasMore).toBe(false);
  });
});

describe("listCollection", () => {
  it("roda o yt-dlp e devolve a página", async () => {
    const child = fakeChild();
    const spawnImpl = vi.fn(() => child);
    const promise = collections.listCollection({
      tools: { ytdlp: "/fake/yt-dlp" },
      source: { kind: "playlist", id: "PLabcdefghijkl" },
      range: { start: 1, count: 2 },
      spawnImpl,
    });
    child.stdout.end(JSON.stringify({ title: "Louvores", entries: [{ id: "dQw4w9WgXcQ", title: "Um" }] }));
    await new Promise((r) => setTimeout(r, 5));
    child.emit("close", 0);
    const res = await promise;
    expect(res).toMatchObject({ title: "Louvores", hasMore: false });
    expect(spawnImpl.mock.calls[0][1].at(-1)).toBe("https://www.youtube.com/playlist?list=PLabcdefghijkl");
  });

  it("limita a página e recusa fonte inválida sem rodar nada", async () => {
    const spawnImpl = vi.fn();
    await expect(
      collections.listCollection({ tools: { ytdlp: "x" }, source: { kind: "channel", id: "-x" }, spawnImpl })
    ).rejects.toMatchObject({ kind: "invalid" });
    expect(spawnImpl).not.toHaveBeenCalled();
    const args = collections.buildListArgs({ url: "u", start: 1, count: collections.MAX_PAGE });
    expect(args[args.indexOf("--playlist-items") + 1]).toBe("1:50");
  });
});
