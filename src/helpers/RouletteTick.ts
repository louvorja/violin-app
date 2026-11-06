/**
 * Tick curto da roleta do Sorteio.
 *
 * Usa Web Audio para não depender de arquivo de áudio nem do player de mídia.
 * O som é um clique mecânico curto (ruído filtrado + corpo grave), mais próximo
 * de uma roleta passando pelos pinos do que um bip eletrônico.
 * O contexto é criado/retomado dentro do gesto que inicia o sorteio, porque
 * navegadores bloqueiam áudio criado fora de uma interação do usuário.
 */

let context: AudioContext | null = null;
let noiseBuffer: AudioBuffer | null = null;

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (context?.state === "closed") context = null;
  if (!context) {
    const Ctor =
      window.AudioContext ||
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    context = new Ctor();
  }
  if (context.state === "suspended") void context.resume();
  return context;
}

/** Ruído curto reaproveitado: barato e suficiente para o transiente do clique. */
function getNoiseBuffer(audio: AudioContext): AudioBuffer {
  if (noiseBuffer) return noiseBuffer;
  const length = Math.max(1, Math.floor(audio.sampleRate * 0.03));
  noiseBuffer = audio.createBuffer(1, length, audio.sampleRate);
  const samples = noiseBuffer.getChannelData(0);
  for (let index = 0; index < samples.length; index++) {
    samples[index] = Math.random() * 2 - 1;
  }
  return noiseBuffer;
}

/** Prepara o áudio durante o clique; sem isso o primeiro tick pode ser bloqueado. */
export function primeRouletteAudio(): void {
  getContext();
}

/** Clique de roleta: transiente de ruído + corpo ressonante bem curto. */
export function playRouletteTick(): void {
  const audio = getContext();
  if (!audio || audio.state !== "running") return;

  const now = audio.currentTime;
  const variation = 0.94 + Math.random() * 0.12;

  const transient = audio.createBufferSource();
  const filter = audio.createBiquadFilter();
  const click = audio.createGain();
  transient.buffer = getNoiseBuffer(audio);
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(1500 * variation, now);
  filter.Q.setValueAtTime(4.5, now);
  click.gain.setValueAtTime(0.0001, now);
  click.gain.exponentialRampToValueAtTime(0.18, now + 0.0015);
  click.gain.exponentialRampToValueAtTime(0.0001, now + 0.028);
  transient.connect(filter);
  filter.connect(click);
  click.connect(audio.destination);
  transient.start(now);
  transient.stop(now + 0.03);

  const body = audio.createOscillator();
  const bodyGain = audio.createGain();
  const bodyFrequency = 250 * variation;
  body.type = "sine";
  body.frequency.setValueAtTime(bodyFrequency, now);
  body.frequency.exponentialRampToValueAtTime(bodyFrequency * 0.55, now + 0.04);
  bodyGain.gain.setValueAtTime(0.0001, now);
  bodyGain.gain.exponentialRampToValueAtTime(0.095, now + 0.0025);
  bodyGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.045);
  body.connect(bodyGain);
  bodyGain.connect(audio.destination);
  body.start(now);
  body.stop(now + 0.05);
}
