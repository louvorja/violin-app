/**
 * Confere o áudio de um vídeo local com o mesmo decodificador do player.
 *
 * O Chromium encerra o `<video>` inteiro por um único quadro AAC que o FFmpeg
 * recusa (VLC e `ffmpeg` só pulam o quadro). Aqui o áudio é decodificado com
 * WebCodecs — o mesmo FFmpeg do player — e os quadros recusados vão para o
 * main, que os entrega como silêncio pelo `louvorja://` a todas as janelas.
 *
 * Quem abre o vídeo espera só o registro da varredura (dezenas de ms): a partir
 * dele o protocolo não entrega bytes que ainda não foram conferidos, e a
 * varredura corre bem à frente do player.
 *
 * @category helper-puro — sem APIs Vue.
 */
import Platform from "@/helpers/Platform";
import Telemetry from "@/helpers/Telemetry";
import { mediaSourceDetails } from "@/helpers/MediaDiagnostics";

interface ScanCodecs {
  video_codec?: string | null;
  audio_codec?: string | null;
}

export type AudioScanBegin =
  | (ScanCodecs & {
      state: "scan";
      token: string;
      codec: string;
      sampleRate: number;
      numberOfChannels: number;
      description: Uint8Array;
      count: number;
      frameDurationUs: number;
    })
  | (ScanCodecs & {
      state: "scanning" | "done" | "unsupported" | "aborted";
      reason?: string;
      patched?: number;
    });

type AudioRepairApi = NonNullable<Window["louvorjaApi"]>["audioRepair"];
type Decode = (_config: AudioDecoderConfig, _chunks: EncodedAudioChunk[]) => Promise<boolean>;

const BATCH = 1000;
/** O registro é rápido; isto só protege a abertura de um main travado. */
const BEGIN_WAIT_MS = 1500;
const EXTENSIONS = new Set(["mp4", "m4v", "mov", "m4a"]);

const _pending = new Map<string, Promise<void>>();
const _reportedUnsupported = new Set<string>();

/** Uma rodada no decodificador: `true` se ele aceitou todos os quadros. */
export function decodeBatch(
  config: AudioDecoderConfig,
  chunks: EncodedAudioChunk[]
): Promise<boolean> {
  return new Promise((resolve) => {
    let failed = false;
    let decoder: AudioDecoder;
    try {
      decoder = new AudioDecoder({
        output: (data) => data.close(),
        error: () => {
          failed = true;
        },
      });
      decoder.configure(config);
      for (const chunk of chunks) {
        if (decoder.state !== "configured") break;
        decoder.decode(chunk);
      }
    } catch {
      resolve(false);
      return;
    }
    const flushed = decoder.state === "configured" ? decoder.flush() : Promise.reject();
    flushed
      .then(
        () => resolve(!failed),
        () => resolve(false)
      )
      .finally(() => {
        try {
          decoder.close();
        } catch {
          /* já fechado pelo erro */
        }
      });
  });
}

/**
 * Índices (no lote) dos quadros que o decodificador recusa. O lote inteiro vai
 * de uma vez; só quando ele falha cada quadro é refeito, precedido do último
 * quadro aceito — o mesmo contexto que o player daria a ele.
 */
export async function rejectedFrames(
  config: AudioDecoderConfig,
  chunks: EncodedAudioChunk[],
  decode: Decode = decodeBatch
): Promise<{ rejected: number[]; unlocated: boolean }> {
  if (await decode(config, chunks)) return { rejected: [], unlocated: false };
  const rejected: number[] = [];
  let lastGood: EncodedAudioChunk | null = null;
  for (let i = 0; i < chunks.length; i++) {
    const context = lastGood ? [lastGood, chunks[i]] : [chunks[i]];
    if (await decode(config, context)) lastGood = chunks[i];
    else rejected.push(i);
  }
  return { rejected, unlocated: rejected.length === 0 };
}

function _extension(url: string): string {
  return /\.([a-z\d]{1,5})$/i.exec(url.split(/[?#]/, 1)[0])?.[1]?.toLowerCase() || "";
}

function _chunks(
  block: { data: Uint8Array; sizes: number[] },
  first: number,
  frameDurationUs: number
): EncodedAudioChunk[] {
  const chunks: EncodedAudioChunk[] = [];
  let offset = 0;
  block.sizes.forEach((size, i) => {
    chunks.push(
      new EncodedAudioChunk({
        type: "key",
        timestamp: Math.round((first + i) * frameDurationUs),
        data: block.data.subarray(offset, offset + size),
      })
    );
    offset += size;
  });
  return chunks;
}

async function _scan(
  api: AudioRepairApi,
  url: string,
  plan: Extract<AudioScanBegin, { state: "scan" }>
): Promise<void> {
  const startedAt = performance.now();
  const base = {
    ...mediaSourceDetails(url),
    packets: plan.count,
    channels: plan.numberOfChannels,
    sample_rate: plan.sampleRate,
    video_codec: plan.video_codec ?? null,
    audio_codec: plan.audio_codec ?? null,
  };
  const abort = (reason: string, error?: unknown): void => {
    void api.report(plan.token, { abort: true }).catch(() => {});
    Telemetry.track("media_audio_scan", {
      ...base,
      outcome: "failed",
      reason,
      error_name: error instanceof Error ? error.name : undefined,
      duration_ms: Math.round(performance.now() - startedAt),
    });
  };
  const config: AudioDecoderConfig = {
    codec: plan.codec,
    sampleRate: plan.sampleRate,
    numberOfChannels: plan.numberOfChannels,
    description: plan.description,
  };
  if (typeof AudioDecoder === "undefined") return abort("webcodecs_missing");
  try {
    if (!(await AudioDecoder.isConfigSupported(config)).supported)
      return abort("config_unsupported");
  } catch (error) {
    return abort("config_unsupported", error);
  }

  const rejected: number[] = [];
  let unlocatedBatches = 0;
  let readMs = 0;
  let patched = 0;
  let unpatchable = 0;
  try {
    for (let from = 0; from < plan.count; ) {
      const readStart = performance.now();
      const block = await api.read(plan.token, from, BATCH);
      readMs += performance.now() - readStart;
      if (!block || block.sizes.length === 0) return abort("read_failed");
      const chunks = _chunks(block, from, plan.frameDurationUs);
      const result = await rejectedFrames(config, chunks);
      if (result.unlocated) unlocatedBatches++;
      const bad = result.rejected.map((i) => from + i);
      rejected.push(...bad);
      from += chunks.length;
      const ack = await api.report(plan.token, {
        upto: from,
        bad,
        done: from >= plan.count,
      });
      if (!ack?.ok) return abort("report_rejected");
      patched = ack.patched ?? patched;
      unpatchable = ack.unpatchable ?? unpatchable;
    }
  } catch (error) {
    return abort("scan_failed", error);
  }

  const outcome = rejected.length ? "repaired" : unlocatedBatches ? "unlocated" : "clean";
  const details = {
    ...base,
    outcome,
    bad_packets: rejected.length,
    patched,
    unpatchable,
    unlocated_batches: unlocatedBatches,
    first_bad_s: rejected.length
      ? Math.round((rejected[0] * plan.frameDurationUs) / 1000) / 1000
      : null,
    duration_ms: Math.round(performance.now() - startedAt),
    read_ms: Math.round(readMs),
  };
  Telemetry.track("media_audio_scan", details);
  if (outcome !== "clean") Telemetry.log("warn", "media audio scan found rejected frames", details);
}

/**
 * Registra a conferência do áudio de um vídeo local e a deixa correndo.
 * Resolve assim que o main sabe do arquivo — antes disso, nada dele deve ser
 * carregado. Nunca rejeita e nunca segura a abertura mais que `BEGIN_WAIT_MS`.
 */
export function prepareLocalMediaAudio(url: string | null | undefined): Promise<void> {
  const api = Platform.audioRepair as AudioRepairApi | null;
  if (!api || typeof url !== "string" || !url.startsWith("louvorja://local/"))
    return Promise.resolve();
  if (!EXTENSIONS.has(_extension(url))) return Promise.resolve();
  const pending = _pending.get(url);
  if (pending) return pending;

  const registered = api.begin(url).then(
    (plan) => {
      if (plan?.state === "scan") {
        void _scan(api, url, plan).finally(() => _pending.delete(url));
        return;
      }
      _pending.delete(url);
      if (plan?.state === "unsupported" && !_reportedUnsupported.has(url)) {
        _reportedUnsupported.add(url);
        Telemetry.track("media_audio_scan", {
          ...mediaSourceDetails(url),
          outcome: "unsupported",
          reason: plan.reason,
          video_codec: plan.video_codec ?? null,
          audio_codec: plan.audio_codec ?? null,
        });
      }
    },
    () => {
      _pending.delete(url);
    }
  );
  const ready = Promise.race([
    registered,
    new Promise<void>((resolve) => setTimeout(resolve, BEGIN_WAIT_MS)),
  ]);
  _pending.set(url, ready);
  return ready;
}
