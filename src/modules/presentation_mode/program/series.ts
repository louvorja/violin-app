import type { SeriesDoc, SeriesPlay } from "@/types/Series";

/**
 * Leitura de uma série de vídeos: o que já passou no ciclo atual e qual é o
 * próximo. Mudar o histórico é com o main, que aplica cada operação sobre o
 * que está no disco (ver electron/main/seriesFile.js).
 */

/** A última exibição de cada vídeo no ciclo atual, sem as desmarcadas. */
export function playedInCycle(doc: SeriesDoc): Map<string, SeriesPlay> {
  const played = new Map<string, SeriesPlay>();
  for (const p of doc.plays) {
    if (p.undone || p.cycle !== doc.cycle) continue;
    const known = played.get(p.file);
    if (!known || known.at < p.at) played.set(p.file, p);
  }
  return played;
}

export interface SeriesProgress {
  /** O primeiro vídeo (na ordem da pasta) que ainda não passou neste ciclo. */
  next: string | null;
  played: number;
  total: number;
  /** Todos passaram (série que não recomeça sozinha): sugerir outra série. */
  completed: boolean;
}

export function progressOf(doc: SeriesDoc, files: string[]): SeriesProgress {
  const played = playedInCycle(doc);
  const count = files.filter((f) => played.has(f)).length;
  const next = files.find((f) => !played.has(f)) ?? null;
  return { next, played: count, total: files.length, completed: files.length > 0 && next === null };
}

/** Pasta e nome do arquivo, em qualquer sistema. */
export function splitPath(path: string): { dir: string; file: string } {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return { dir: path.slice(0, i), file: path.slice(i + 1) };
}

/** Quanto precisa tocar para contar como "passou": um clique errado, logo trocado, não gasta o vídeo. */
export const PLAYED_AFTER_SECONDS = 15;

/** 15 s de reprodução — ou 80% de um vídeo mais curto que isso. */
export function playedThreshold(duration: number): number {
  return duration > 0 ? Math.min(PLAYED_AFTER_SECONDS, duration * 0.8) : PLAYED_AFTER_SECONDS;
}

/** Entre duas leituras da posição, mais que isto é pulo na barra, não reprodução. */
const MAX_STEP_SECONDS = 2;

/**
 * Soma o tempo que o arquivo no ar de fato tocou. Só conta o avanço normal da
 * posição: pausado não soma, pular na barra não soma, e a posição que sobrou
 * do vídeo anterior, ao trocar de arquivo, não vira tempo do novo.
 */
export class PlayedTime {
  private path: string | null = null;
  private last: number | null = null;
  private total = 0;
  private counted = false;

  /** Uma leitura da posição; `true` na vez em que o arquivo passa a contar como "passou". */
  feed(path: string | null, time: number, duration: number): boolean {
    if (path !== this.path) {
      this.path = path;
      this.last = null;
      this.total = 0;
      this.counted = false;
    }
    if (!path || this.counted || !Number.isFinite(time)) return false;
    if (this.last !== null) {
      const step = time - this.last;
      if (step > 0 && step < MAX_STEP_SECONDS) this.total += step;
    }
    this.last = time;
    if (this.total < playedThreshold(Number.isFinite(duration) ? duration : 0)) return false;
    this.counted = true;
    return true;
  }
}
