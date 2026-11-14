// @vitest-environment node
/**
 * O leitor do índice do MP4 decide QUAIS bytes o protocolo troca por silêncio:
 * uma posição errada trocaria vídeo por lixo no meio do culto. Os arquivos são
 * montados aqui, com quadros de bytes conhecidos, nas variantes que aparecem
 * nos arquivos reais (índice no começo ou no fim, `co64`, `.mov` com `wave`).
 */
import { afterAll, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const require = createRequire(import.meta.url);
const { readAudioTrack, parseAudioSpecificConfig } = require("../audioRepair/mp4AudioTrack.js");
const { buildMp4 } = require("./fixtures/mp4Builder.cjs");

const root = fs.mkdtempSync(join(tmpdir(), "lj-audio-mp4-"));
let n = 0;

function write(built) {
  const file = join(root, `f${n++}.mp4`);
  fs.writeFileSync(file, built.file);
  return file;
}

async function read(opts) {
  const built = buildMp4(opts);
  const file = write(built);
  return { built, track: await readAudioTrack(file, built.file.length) };
}

async function reason(opts) {
  try {
    await read(opts);
  } catch (error) {
    return { reason: error.reason, details: error.details };
  }
  return null;
}

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("posições dos quadros de áudio", () => {
  const base = { sizes: [11, 23, 17, 9, 30], perChunk: [2, 2, 1] };

  it.each([
    ["índice no fim", {}],
    ["índice no começo", { faststart: true }],
    ["offsets de 64 bits", { co64: true }],
    [".mov com esds dentro de wave", { qtVersion: 1 }],
    ["tamanho uniforme", { sizes: [20, 20, 20, 20, 20] }],
  ])("%s", async (_name, extra) => {
    const { built, track } = await read({ ...base, ...extra });
    expect(Array.from(track.positions)).toEqual(built.positions);
    expect(Array.from(track.sizes)).toEqual(built.sizes);
    for (let i = 0; i < built.sizes.length; i++) {
      const at = track.positions[i];
      expect(built.file.subarray(at, at + track.sizes[i])).toEqual(built.frames[i]);
    }
    expect(track).toMatchObject({ channels: 2, sampleRate: 48000, aot: 2, sbr: false });
    expect(track.video_codec).toBe("avc1");
    expect(track.audio_codec).toBe("mp4a");
    expect(track.asc).toEqual(Buffer.from([0x11, 0x90]));
  });

  it("menor posição ainda não conferida, mesmo fora de ordem", async () => {
    const { track } = await read(base);
    for (let i = 0; i < track.positions.length; i++) {
      expect(track.minFrom[i]).toBe(Math.min(...Array.from(track.positions).slice(i)));
    }
  });

  it("mono aceito", async () => {
    const { track } = await read({ ...base, asc: Buffer.from([0x12, 0x08]), channels: 1 });
    expect(track).toMatchObject({ channels: 1, sampleRate: 44100 });
  });
});

describe("o que não dá para remendar diz o porquê", () => {
  const base = { sizes: [10, 10], perChunk: [2] };

  it("codec de áudio diferente traz os codecs encontrados", async () => {
    expect(await reason({ ...base, codec: "ac-3" })).toEqual({
      reason: "audio_codec",
      details: { video_codec: "avc1", audio_codec: "ac-3" },
    });
  });

  it.each([
    ["HE-AAC", Buffer.from([0x29, 0x90]), "aac_profile"],
    ["AAC-LC com SBR explícito", Buffer.from([0x11, 0x90, 0x56, 0xe5, 0x80]), "aac_profile"],
    ["5.1", Buffer.from([0x11, 0xb0]), "aac_channels"],
  ])("%s", async (_name, asc, expected) => {
    expect((await reason({ ...base, asc }))?.reason).toBe(expected);
  });

  it("MP4 fragmentado", async () => {
    expect((await reason({ ...base, fragmented: true }))?.reason).toBe("fragmented");
  });

  it("arquivo que não é MP4", async () => {
    const file = join(root, "texto.mp4");
    fs.writeFileSync(file, "não sou um vídeo");
    await expect(readAudioTrack(file, fs.statSync(file).size)).rejects.toMatchObject({
      reason: "no_moov",
    });
  });
});

describe("AudioSpecificConfig", () => {
  it("a extensão de sincronismo do ffmpeg sem SBR continua AAC-LC", () => {
    expect(parseAudioSpecificConfig(Buffer.from("119056e500", "hex"))).toMatchObject({
      aot: 2,
      sampleRate: 48000,
      channels: 2,
      sbr: false,
    });
  });
});
