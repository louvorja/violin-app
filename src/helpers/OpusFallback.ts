// Safari no iOS não toca Ogg Opus, e as faixas novas do acervo só existem nesse
// formato (o `.mp3` do servidor devolve o mesmo Ogg). Onde o navegador não
// entende o formato, decodificamos para WAV em memória e entregamos ao <audio>.

let _unsupported: boolean | null = null;

export function opusNeedsFallback(): boolean {
  if (_unsupported === null) {
    try {
      const el = document.createElement("audio");
      _unsupported =
        el.canPlayType('audio/ogg; codecs="opus"') === "" && el.canPlayType("audio/opus") === "";
    } catch {
      _unsupported = false;
    }
  }
  return _unsupported;
}

export function isOpusUrl(url: string): boolean {
  return /\.opus(\?.*)?$/i.test(url);
}

function wavHeader(dataBytes: number, channels: number, sampleRate: number): ArrayBuffer {
  const buf = new ArrayBuffer(44);
  const v = new DataView(buf);
  const text = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  text(0, "RIFF");
  v.setUint32(4, 36 + dataBytes, true);
  text(8, "WAVE");
  text(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, channels, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * channels * 2, true);
  v.setUint16(32, channels * 2, true);
  v.setUint16(34, 16, true);
  text(36, "data");
  v.setUint32(40, dataBytes, true);
  return buf;
}

/** Decodifica um Ogg Opus para um blob WAV PCM 16 bits. */
export async function decodeOpusToWav(source: Blob): Promise<Blob> {
  const { OggOpusDecoder } = await import("ogg-opus-decoder");
  const decoder = new OggOpusDecoder();
  await decoder.ready;
  try {
    const bytes = new Uint8Array(await source.arrayBuffer());
    const chunks: Int16Array<ArrayBuffer>[] = [];
    let channels = 0;
    let sampleRate = 48000;
    let dataBytes = 0;

    const push = (r: { channelData: Float32Array[]; samplesDecoded: number; sampleRate: number }) => {
      if (!r.samplesDecoded) return;
      channels = r.channelData.length;
      sampleRate = r.sampleRate;
      const out = new Int16Array(r.samplesDecoded * channels);
      for (let c = 0; c < channels; c++) {
        const data = r.channelData[c];
        for (let i = 0; i < r.samplesDecoded; i++) {
          const s = Math.max(-1, Math.min(1, data[i]));
          out[i * channels + c] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
      }
      chunks.push(out);
      dataBytes += out.byteLength;
    };

    push(await decoder.decodeFile(bytes));

    if (!dataBytes) throw new Error("opus: nenhuma amostra decodificada");
    return new Blob([wavHeader(dataBytes, channels, sampleRate), ...chunks], { type: "audio/wav" });
  } finally {
    decoder.free();
  }
}
