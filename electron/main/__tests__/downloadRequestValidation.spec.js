// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { validateDownloadEntries, MAX_FILES, MAX_PATH_LENGTH } = require("../download/requestValidation.js");
const filesDir = path.join(os.tmpdir(), "LouvorJA Violin", "files");
const options = {
  filesDir,
  filesBaseUrl: "https://api.louvorja.workers.dev/file",
};

const valid = (overrides = {}) => ({
  remote: "/musics/pt/Adoradores 5/01 Sublime Graça.opus",
  local: "musics/pt/Adoradores 5/01 Sublime Graça.opus",
  remoteUrl: "https://api.louvorja.workers.dev/file/musics/pt/Adoradores%205/01%20Sublime%20Gra%C3%A7a.opus",
  expectedSize: 0,
  ...overrides,
});

describe("download IPC file-entry validation", () => {
  it("accepts the renderer catalog shape and returns a separate bounded entry", () => {
    const input = valid();
    const result = validateDownloadEntries([input], options);
    expect(result).toEqual([valid()]);
    expect(result[0]).not.toBe(input);
  });

  it("preserves safe legacy absolute paths inside filesDir and explicit trusted CDN origins", () => {
    const absolute = path.join(filesDir, "covers", "1992.bmp");
    const entries = [
      valid({ remote: "/covers/1992.bmp", local: absolute, remoteUrl: undefined }),
      valid({
        remote: "/images/capa.jpg",
        local: "images/capa.jpg",
        remoteUrl: "https://cdn.louvorja.com/images/capa.jpg?version=2",
      }),
      valid({
        remote: "/covers/capa.bmp",
        local: "covers/capa.bmp",
        remoteUrl: "https://api.louvorja.com.br/file/covers/capa.bmp",
      }),
    ];
    expect(validateDownloadEntries(entries, {
      ...options,
      allowedRemoteOrigins: ["https://cdn.louvorja.com", "https://api.louvorja.com.br"],
    })).toHaveLength(3);
  });

  it.each([
    { remote: "/musics/../secret.opus", local: "musics/../secret.opus", remoteUrl: undefined },
    { remote: "/musics/%2e%2e/secret.opus", local: "musics/%2e%2e/secret.opus", remoteUrl: undefined },
    { remote: "/musics/%252e%252e/secret.opus", local: "musics/%252e%252e/secret.opus", remoteUrl: undefined },
    { remote: "/musics/%2fsecret.opus", local: "musics/%2fsecret.opus", remoteUrl: undefined },
    { remote: "/musics\\secret.opus", local: "musics\\secret.opus", remoteUrl: undefined },
    { remote: "musics/pt/song.opus", local: "musics/pt/song.opus", remoteUrl: undefined },
    { remote: "/musics/pt/song.opus", local: "../song.opus", remoteUrl: undefined },
    { remote: "/musics/pt/song.opus", local: path.join(os.tmpdir(), "outside.opus"), remoteUrl: undefined },
    { remote: "/musics/pt/song.opus", local: "covers/song.opus", remoteUrl: undefined },
  ])("rejects unsafe or mismatched paths: $remote / $local", (entry) => {
    expect(() => validateDownloadEntries([entry], options)).toThrow(TypeError);
  });

  it.each([
    "https://evil.example/file/musics/pt/hino.opus",
    "http://evil.example/musics/pt/hino.opus",
    "file:///tmp/hino.opus",
    "https://user:password@api.louvorja.workers.dev/file/musics/pt/hino.opus",
    "https://api.louvorja.workers.dev/file/other.opus",
    "https://api.louvorja.workers.dev/musics/pt/hino.opus",
    "https://api.louvorja.workers.dev/file/other/../musics/pt/hino.opus",
    "https://api.louvorja.workers.dev/file/%2e%2e/file/musics/pt/hino.opus",
    "https://api.louvorja.workers.dev/file/musics%2fpt/hino.opus",
    "https://api.louvorja.workers.dev/file/musics/pt/hino.opus#fragment",
    "HTTPS://api.louvorja.workers.dev/file/musics/pt/hino.opus",
    " https://api.louvorja.workers.dev/file/musics/pt/hino.opus",
  ])("rejects arbitrary or unrelated remoteUrl: %s", (remoteUrl) => {
    expect(() => validateDownloadEntries([
      { remote: "/musics/pt/hino.opus", local: "musics/pt/hino.opus", remoteUrl },
    ], options)).toThrow(TypeError);
  });

  it("rejects malformed and oversized lists before work can be scheduled", () => {
    expect(() => validateDownloadEntries(null, options)).toThrow(TypeError);
    expect(() => validateDownloadEntries(new Array(MAX_FILES + 1), options)).toThrow(TypeError);
    expect(() => validateDownloadEntries([null], options)).toThrow(TypeError);
    expect(() => validateDownloadEntries([{ ...valid(), untrusted: { nested: "data" } }], options)).toThrow(TypeError);
    expect(() => validateDownloadEntries([{ ...valid(), expectedSize: Infinity }], options)).toThrow(TypeError);
    expect(() => validateDownloadEntries([{ ...valid(), expectedSize: -1 }], options)).toThrow(TypeError);
    expect(() => validateDownloadEntries([{ ...valid(), remote: `/${"a".repeat(MAX_PATH_LENGTH)}` }], options)).toThrow(TypeError);
  });

  it("allows an empty list and remote paths with literal percent signs", () => {
    expect(validateDownloadEntries([], options)).toEqual([]);
    expect(validateDownloadEntries([{
      remote: "/images/100% livre.jpg",
      local: "images/100% livre.jpg",
    }], options)).toHaveLength(1);
    expect(validateDownloadEntries([{
      remote: "/musics/pt/hino.opus",
      local: "musics/pt/hino.opus",
      remoteUrl: "https://api.louvorja.workers.dev/file/musics/pt/hino.opus?v=2",
    }], options)).toHaveLength(1);
  });
});
