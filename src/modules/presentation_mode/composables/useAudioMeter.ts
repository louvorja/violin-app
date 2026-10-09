import { onUnmounted, ref } from "vue";

/**
 * O nível do som que sai do app, medido como numa mesa: esquerdo e direito,
 * em dB, depois do volume e do mudo de cada player.
 *
 * A medição não passa o som por um AudioContext — o player continua tocando
 * direto na saída, como sempre. Cada elemento entrega uma cópia do seu áudio
 * (`captureStream`), e é a cópia que vai ao analisador. Essa cópia vem antes
 * do volume e do mudo do elemento, e por isso eles entram aqui como ganho. Uma
 * mídia de outra origem (o YouTube embutido, um link sem CORS) não entrega a
 * cópia: o medidor fica parado e o som segue normal.
 */

const FLOOR_DB = -60;
/** Quanto o pico marcado espera antes de cair (frames, ~1 s a 60 fps). */
const PEAK_HOLD_FRAMES = 60;
/** Queda da barra por frame quando o som baixa — sobe na hora, desce suave. */
const FALL = 0.04;

/** Amplitude de pico (0..1) → posição na escala do medidor (0..1, em dB). */
export function levelFromPeak(peak: number): number {
  if (!(peak > 0)) return 0;
  const db = 20 * Math.log10(peak);
  return Math.max(0, Math.min(1, (db - FLOOR_DB) / -FLOOR_DB));
}

interface Tap {
  /** A fonte capturada: o player reaproveita o elemento a cada mídia. */
  src: string;
  stream: MediaStream | null;
  trackId: string;
  node: MediaStreamAudioSourceNode | null;
  gain: GainNode;
}

type Source = () => HTMLMediaElement | null;

export function useAudioMeter(sources: Source[]) {
  const levels = ref([0, 0]);
  const peaks = ref([0, 0]);
  /** Há som tocando que o medidor consegue ouvir. */
  const active = ref(false);

  let ctx: AudioContext | null = null;
  let mix: GainNode | null = null;
  let analysers: AnalyserNode[] = [];
  let buffer = new Float32Array(1024);
  const taps = new Map<HTMLMediaElement, Tap>();
  const held = [0, 0];
  let frame = 0;

  function graph(): AudioContext {
    if (ctx) return ctx;
    ctx = new AudioContext();
    // Mono vira dois canais iguais; estéreo segue separado.
    mix = ctx.createGain();
    mix.channelCount = 2;
    mix.channelCountMode = "explicit";
    mix.channelInterpretation = "speakers";
    const splitter = ctx.createChannelSplitter(2);
    mix.connect(splitter);
    analysers = [0, 1].map((channel) => {
      const analyser = ctx!.createAnalyser();
      analyser.fftSize = 1024;
      splitter.connect(analyser, channel);
      return analyser;
    });
    buffer = new Float32Array(analysers[0].fftSize);
    return ctx;
  }

  function unplug(tap: Tap): void {
    tap.node?.disconnect();
    tap.node = null;
    tap.trackId = "";
  }

  function tapOf(el: HTMLMediaElement): Tap {
    const audio = graph();
    let tap = taps.get(el);
    // Fonte nova no mesmo elemento: a cópia antiga fica com a faixa velha,
    // muda, ao lado da nova. Captura de novo.
    if (tap && tap.src !== el.currentSrc) {
      release(el);
      tap = undefined;
    }
    if (!tap) {
      tap = { src: el.currentSrc, stream: null, trackId: "", node: null, gain: audio.createGain() };
      tap.gain.connect(mix!);
      try {
        tap.stream = (el as HTMLMediaElement & { captureStream(): MediaStream }).captureStream();
      } catch {
        // Mídia de outra origem: sem cópia, sem medição.
      }
      taps.set(el, tap);
    }
    // A faixa só aparece quando a mídia carrega.
    const track = tap.stream?.getAudioTracks().at(-1);
    if (!track) unplug(tap);
    else if (track.id !== tap.trackId) {
      unplug(tap);
      try {
        tap.node = audio.createMediaStreamSource(new MediaStream([track]));
        tap.node.connect(tap.gain);
        tap.trackId = track.id;
      } catch {
        tap.node = null;
      }
    }
    return tap;
  }

  function release(el: HTMLMediaElement): void {
    const tap = taps.get(el);
    if (!tap) return;
    unplug(tap);
    tap.gain.disconnect();
    taps.delete(el);
  }

  function peakOf(analyser: AnalyserNode): number {
    analyser.getFloatTimeDomainData(buffer);
    let max = 0;
    for (const v of buffer) {
      const a = Math.abs(v);
      if (a > max) max = a;
    }
    return max;
  }

  function tick(): void {
    frame = requestAnimationFrame(tick);
    const elements = sources.map((s) => s()).filter((el): el is HTMLMediaElement => !!el);
    for (const el of [...taps.keys()]) if (!elements.includes(el)) release(el);

    const playing = elements.filter((el) => !el.paused);
    let now = [0, 0];
    if (playing.length) {
      const audio = graph();
      if (audio.state === "suspended") void audio.resume();
      let heard = false;
      for (const el of elements) {
        const tap = tapOf(el);
        tap.gain.gain.value = el.muted || el.paused ? 0 : el.volume;
        if (tap.node && !el.paused) heard = true;
      }
      active.value = heard;
      if (heard) now = analysers.map((a) => levelFromPeak(peakOf(a)));
    } else {
      active.value = false;
    }

    // Em silêncio, com tudo já no zero, não há o que redesenhar.
    if (!playing.length && levels.value.every((v) => v === 0) && peaks.value.every((v) => v === 0))
      return;
    levels.value = levels.value.map((old, i) => Math.max(now[i], old - FALL, 0));
    peaks.value = peaks.value.map((old, i) => {
      if (levels.value[i] >= old) {
        held[i] = PEAK_HOLD_FRAMES;
        return levels.value[i];
      }
      if (held[i] > 0) {
        held[i]--;
        return old;
      }
      return Math.max(levels.value[i], old - FALL / 2, 0);
    });
  }

  function start(): void {
    if (!frame) frame = requestAnimationFrame(tick);
  }

  function stop(): void {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    for (const el of [...taps.keys()]) release(el);
    void ctx?.close();
    ctx = null;
    mix = null;
    analysers = [];
    levels.value = [0, 0];
    peaks.value = [0, 0];
    active.value = false;
  }

  onUnmounted(stop);

  return { levels, peaks, active, start, stop };
}
