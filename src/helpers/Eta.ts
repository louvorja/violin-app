/**
 * Tempo restante de uma tarefa que informa só a porcentagem.
 *
 * Mistura a velocidade dos últimos segundos (reage a uma rede que melhora ou
 * piora) com a média desde o começo (evita o número pular a cada arquivo). Sem
 * amostras suficientes ou com a tarefa parada, devolve `null` em vez de chutar.
 */
export interface EtaEstimator {
  push(timeMs: number, percent: number): void;
  /** Segundos que faltam, ou `null` quando ainda não dá para estimar. */
  eta(nowMs: number): number | null;
}

interface Sample {
  t: number;
  p: number;
}

export function createEtaEstimator({
  windowMs = 20_000,
  minElapsedMs = 4_000,
  minPercent = 1,
  staleMs = 20_000,
}: { windowMs?: number; minElapsedMs?: number; minPercent?: number; staleMs?: number } = {}): EtaEstimator {
  let samples: Sample[] = [];
  let first: Sample | null = null;

  return {
    push(timeMs, percent) {
      // Progresso que recua é uma tarefa que recomeçou: estimativa nova.
      if (first && percent < samples[samples.length - 1].p) {
        samples = [];
        first = null;
      }
      const sample = { t: timeMs, p: percent };
      if (!first) first = sample;
      samples.push(sample);
      while (samples.length > 2 && timeMs - samples[0].t > windowMs) samples.shift();
    },

    eta(nowMs) {
      const last = samples[samples.length - 1];
      if (!first || !last) return null;
      const remaining = 100 - last.p;
      if (remaining <= 0) return 0;
      if (nowMs - last.t > staleMs) return null;
      const elapsed = last.t - first.t;
      if (elapsed < minElapsedMs || last.p - first.p < minPercent) return null;

      const overall = (last.p - first.p) / elapsed;
      const oldest = samples[0];
      const span = last.t - oldest.t;
      const recent = span >= 2_000 && last.p > oldest.p ? (last.p - oldest.p) / span : overall;
      const rate = 0.6 * recent + 0.4 * overall;
      if (!(rate > 0)) return null;
      return Math.round(remaining / rate / 1000);
    },
  };
}

/** "menos de 10 s", "45 s", "3 min 20 s", "12 min", "1 h 05 min". */
export function formatEta(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  if (total < 10) return "< 10 s";
  if (total < 60) return `${total} s`;
  if (total < 600) {
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m} min ${String(s).padStart(2, "0")} s`;
  }
  if (total < 3600) return `${Math.round(total / 60)} min`;
  const h = Math.floor(total / 3600);
  const m = Math.round((total % 3600) / 60);
  return `${h} h ${String(m).padStart(2, "0")} min`;
}
