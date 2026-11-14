/**
 * Plano do "vai e vem" final do sorteio.
 *
 * O plano é determinístico a partir do `run_id`: a janela principal calcula o
 * tempo total para o timer e a projeção usa exatamente a mesma sequência,
 * mesmo em outra janela. A quantidade de bounces (0 a 3), as amplitudes e a
 * duração de cada trecho variam a cada sorteio.
 */

export interface DrawBoomerangPlan {
  /** Posições relativas ao centro final; a primeira é onde o giro termina. */
  positions: number[];
  /** Duração de cada trecho `positions[i] -> positions[i + 1]`. */
  durations: number[];
  /** Soma de `durations`, usada pelo timer do módulo. */
  totalMs: number;
}

/** Cada bounce precisa de tempo para ser percebido, sem acelerar demais. */
const BOUNCE_MIN_MS = 860;
const BOUNCE_MAX_MS = 1200;

function seedValue(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index++) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function randomGenerator(seed: string): () => number {
  let state = seedValue(seed || "draw");
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const bounceDuration = (random: () => number): number =>
  Math.round(BOUNCE_MIN_MS + random() * (BOUNCE_MAX_MS - BOUNCE_MIN_MS));

export function createBoomerangPlan(seed: string, enabled = true): DrawBoomerangPlan {
  if (!enabled) return { positions: [0], durations: [], totalMs: 0 };
  const random = randomGenerator(seed);

  // 0 a 3 bounces. Com zero, o giro principal já termina no alvo: não há
  // bumerangue. O caso 3 é o máximo de vai e vem depois do giro.
  const bounceCount = Math.floor(random() * 4);
  if (bounceCount === 0) {
    return { positions: [0], durations: [], totalMs: 0 };
  }

  const positions = [-(0.68 + random() * 0.32)];
  const durations: number[] = [];
  let amplitude = 0.42 + random() * 0.22;

  for (let bounce = 0; bounce < bounceCount; bounce++) {
    const isLast = bounce === bounceCount - 1;
    if (isLast) {
      positions.push(0);
    } else {
      const side = bounce % 2 === 0 ? 1 : -1;
      positions.push(side * amplitude * (0.85 + random() * 0.3));
      amplitude *= 0.58 + random() * 0.16;
    }
    durations.push(bounceDuration(random));
  }

  return {
    positions,
    durations,
    totalMs: durations.reduce((total, duration) => total + duration, 0),
  };
}
