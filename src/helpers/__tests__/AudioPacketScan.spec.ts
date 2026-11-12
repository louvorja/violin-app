/**
 * A varredura do renderer decide quais quadros o main troca por silêncio, e a
 * abertura do vídeo espera por ela. O decodificador aqui é falso: recusa o
 * quadro cujo primeiro byte é 0xFF, como o FFmpeg recusa um quadro corrompido.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ current: null as unknown }));
const telemetry = vi.hoisted(() => ({ track: vi.fn(), log: vi.fn() }));

vi.mock("@/helpers/Platform", () => ({
  default: {
    get audioRepair() {
      return api.current;
    },
  },
}));
vi.mock("@/helpers/Telemetry", () => ({ default: telemetry }));

import {
  decodeBatch,
  prepareLocalMediaAudio,
  rejectedFrames,
} from "@/helpers/AudioPacketScan";

class FakeChunk {
  timestamp: number;
  data: Uint8Array;
  bad: boolean;
  constructor(init: { timestamp: number; data: Uint8Array }) {
    this.timestamp = init.timestamp;
    this.data = init.data;
    this.bad = init.data[0] === 0xff;
  }
}

class FakeDecoder {
  static isConfigSupported = vi.fn(async () => ({ supported: true }));
  state = "unconfigured";
  onError: (_e: Error) => void;
  constructor(init: { error: (_e: Error) => void }) {
    this.onError = init.error;
  }
  configure() {
    this.state = "configured";
  }
  decode(chunk: FakeChunk) {
    if (!chunk.bad) return;
    this.state = "closed";
    queueMicrotask(() => this.onError(new Error("Failed to send audio packet")));
  }
  flush() {
    return this.state === "configured" ? Promise.resolve() : Promise.reject(new Error("closed"));
  }
  close() {
    this.state = "closed";
  }
}

const config = { codec: "mp4a.40.2", sampleRate: 48000, numberOfChannels: 2 };
const chunk = (bad: boolean) =>
  new FakeChunk({ timestamp: 0, data: new Uint8Array([bad ? 0xff : 0x21, 0]) });

/** API do main falsa: `count` quadros, os de índice em `bad` corrompidos. */
function fakeApi(count: number, bad: number[], begin?: () => Promise<unknown>) {
  const reports: Array<Record<string, unknown>> = [];
  return {
    reports,
    begin: vi.fn(
      begin ||
        (async () => ({
          state: "scan",
          token: "t",
          codec: "mp4a.40.2",
          sampleRate: 48000,
          numberOfChannels: 2,
          description: new Uint8Array([0x11, 0x90]),
          count,
          frameDurationUs: 1024 / 0.048,
          video_codec: "avc1",
          audio_codec: "mp4a",
        }))
    ),
    read: vi.fn(async (_token: string, from: number, n: number) => {
      const sizes = Array.from({ length: Math.min(n, count - from) }, () => 2);
      const data = new Uint8Array(sizes.length * 2);
      sizes.forEach((_s, i) => (data[i * 2] = bad.includes(from + i) ? 0xff : 0x21));
      return { data, sizes };
    }),
    report: vi.fn(async (_token: string, result: Record<string, unknown>) => {
      reports.push(result);
      return { ok: true, patched: bad.length, unpatchable: 0 };
    }),
  };
}

async function settle() {
  for (let i = 0; i < 50; i++) await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  vi.stubGlobal("AudioDecoder", FakeDecoder);
  vi.stubGlobal("EncodedAudioChunk", FakeChunk);
  telemetry.track.mockClear();
  telemetry.log.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  api.current = null;
});

describe("quadros recusados", () => {
  it("o lote que o decodificador aceita não é refeito", async () => {
    const decode = vi.fn(async () => true);
    expect(await rejectedFrames(config, [chunk(false), chunk(false)] as never, decode)).toEqual({
      rejected: [],
      unlocated: false,
    });
    expect(decode).toHaveBeenCalledTimes(1);
  });

  it("aponta cada quadro recusado, com o último aceito como contexto", async () => {
    const chunks = [false, true, false, true, false].map(chunk);
    const contexts: FakeChunk[][] = [];
    const decode = vi.fn(async (_c: AudioDecoderConfig, list: FakeChunk[]) => {
      contexts.push(list);
      return !list.some((c) => c.bad);
    });
    const result = await rejectedFrames(config, chunks as never, decode as never);
    expect(result).toEqual({ rejected: [1, 3], unlocated: false });
    // O quadro 2 é conferido depois do 0 (último aceito), nunca depois do 1.
    expect(contexts[3]).toEqual([chunks[0], chunks[2]]);
  });

  it("falha que só aparece no lote inteiro é contada como não localizada", async () => {
    const decode = vi.fn(async (_c: AudioDecoderConfig, list: unknown[]) => list.length < 3);
    expect(await rejectedFrames(config, [false, false, false].map(chunk) as never, decode)).toEqual({
      rejected: [],
      unlocated: true,
    });
  });

  it("decodeBatch fala com a API do WebCodecs (configure, decode, flush)", async () => {
    expect(await decodeBatch(config, [chunk(false), chunk(false)] as never)).toBe(true);
    expect(await decodeBatch(config, [chunk(false), chunk(true)] as never)).toBe(false);
  });
});

describe("abertura de vídeo local", () => {
  it("ignora o que não é arquivo local com áudio AAC possível", async () => {
    const fake = fakeApi(10, []);
    api.current = fake;
    await prepareLocalMediaAudio("https://files.louvorja.com.br/a.mp4");
    await prepareLocalMediaAudio("louvorja://files/musics/a.opus");
    await prepareLocalMediaAudio("louvorja://local/C:/videos/a.webm");
    await prepareLocalMediaAudio(undefined);
    expect(fake.begin).not.toHaveBeenCalled();
  });

  it("varre em lotes e informa os quadros recusados pelo índice no arquivo", async () => {
    const fake = fakeApi(2500, [1700]);
    api.current = fake;
    const url = "louvorja://local/C:/Informativo/5.%2031-10-26_Um%20farol.mp4";
    await prepareLocalMediaAudio(url);
    await settle();
    expect(fake.reports).toEqual([
      { upto: 1000, bad: [], done: false },
      { upto: 2000, bad: [1700], done: false },
      { upto: 2500, bad: [], done: true },
    ]);
    expect(telemetry.track).toHaveBeenCalledWith(
      "media_audio_scan",
      expect.objectContaining({
        outcome: "repaired",
        bad_packets: 1,
        patched: 1,
        first_bad_s: 36.267,
        file_basename: "5. 31-10-26_Um farol.mp4",
        video_codec: "avc1",
      })
    );
  });

  it("chamadas repetidas durante a varredura não abrem outra", async () => {
    const fake = fakeApi(10, []);
    api.current = fake;
    const url = "louvorja://local/Users/a/repetido.mov";
    await Promise.all([prepareLocalMediaAudio(url), prepareLocalMediaAudio(url)]);
    expect(fake.begin).toHaveBeenCalledTimes(1);
  });

  it("main travado não segura a abertura", async () => {
    vi.useFakeTimers();
    api.current = fakeApi(10, [], () => new Promise(() => {}));
    let opened = false;
    prepareLocalMediaAudio("louvorja://local/Users/a/travado.mp4").then(() => (opened = true));
    await vi.advanceTimersByTimeAsync(1500);
    expect(opened).toBe(true);
  });

  it("formato que não dá para conferir é registrado uma vez, com os codecs", async () => {
    api.current = fakeApi(0, [], async () => ({
      state: "unsupported",
      reason: "audio_codec",
      video_codec: "hvc1",
      audio_codec: "ac-3",
    }));
    const url = "louvorja://local/Users/a/iphone.mov";
    await prepareLocalMediaAudio(url);
    await prepareLocalMediaAudio(url);
    expect(telemetry.track).toHaveBeenCalledTimes(1);
    expect(telemetry.track).toHaveBeenCalledWith(
      "media_audio_scan",
      expect.objectContaining({ outcome: "unsupported", reason: "audio_codec", video_codec: "hvc1" })
    );
  });

  it("sem WebCodecs a varredura desiste e libera o main", async () => {
    vi.stubGlobal("AudioDecoder", undefined);
    const fake = fakeApi(10, []);
    api.current = fake;
    await prepareLocalMediaAudio("louvorja://local/Users/a/sem-webcodecs.mp4");
    await settle();
    expect(fake.reports).toEqual([{ abort: true }]);
  });
});
