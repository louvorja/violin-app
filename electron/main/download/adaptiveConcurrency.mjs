/**
 * Controlador de concorrência de downloads. Compartilhado entre o main
 * (HttpQueue) e o renderer (WebFileStore): o desktop o carrega por import()
 * dinâmico e a web, direto — uma só implementação, como monitorIdentity.mjs.
 *
 * Sobe um download por vez enquanto a vazão agregada melhora (>= 10%), volta
 * ao último limite bom quando deixa de melhorar, corta 40% quando falhas
 * passam de 25% da janela e reexplora para cima de tempos em tempos para
 * acompanhar uma rede que melhorou. Mede só o que terminou, sem sondar a rede.
 */

const WINDOW_MS = 3000;
const GAIN = 1.1;
const DROP = 0.7;
const FAIL_RATE = 0.25;
const REPROBE_AFTER = 5;

/**
 * @param {{ min?: number, max?: number, start?: number, windowMs?: number, now?: () => number }} [options]
 */
export function createAdaptiveConcurrency({
  min = 2,
  max = 8,
  start = 4,
  windowMs = WINDOW_MS,
  now = Date.now,
} = {}) {
  const lo = Math.max(1, Math.floor(min));
  const hi = Math.max(lo, Math.floor(max));
  let limit = Math.min(hi, Math.max(lo, Math.floor(start)));

  let windowStart = null;
  let weight = 0;
  let done = 0;
  let fails = 0;
  let prevRate = null;
  let prevLimit = null;
  let holdWindows = 0;

  function resetWindow() {
    windowStart = null;
    weight = 0;
    done = 0;
    fails = 0;
  }

  function evaluate(elapsed) {
    const total = done + fails;
    const rate = weight / elapsed;
    const failing = fails >= 2 && fails / total >= FAIL_RATE;
    resetWindow();

    if (failing) {
      limit = Math.max(lo, Math.floor(limit * 0.6));
      prevRate = null;
      prevLimit = null;
      holdWindows = 0;
      return;
    }
    if (prevRate === null) {
      prevRate = rate;
      prevLimit = limit;
      if (limit < hi) limit += 1;
      return;
    }
    if (limit > prevLimit) {
      if (rate >= prevRate * GAIN) {
        prevRate = rate;
        prevLimit = limit;
        if (limit < hi) limit += 1;
      } else {
        limit = prevLimit;
        holdWindows = 0;
      }
      return;
    }
    holdWindows += 1;
    if (rate < prevRate * DROP && limit > lo) {
      limit -= 1;
      prevRate = rate;
      prevLimit = limit;
    } else if (holdWindows >= REPROBE_AFTER && limit < hi) {
      prevRate = rate;
      prevLimit = limit;
      limit += 1;
      holdWindows = 0;
    }
  }

  return {
    /** Quantos downloads podem rodar agora. */
    limit: () => limit,
    /**
     * Registra um arquivo concluído. `bytes` pesa a vazão; sem tamanho
     * conhecido, cada arquivo conta como 1.
     * @param {{ bytes?: number, ok?: boolean }} [sample]
     */
    report({ bytes = 0, ok = true } = {}) {
      const t = now();
      if (windowStart === null) windowStart = t;
      if (ok) {
        done += 1;
        weight += bytes > 0 ? bytes : 1;
      } else {
        fails += 1;
      }
      const elapsed = t - windowStart;
      if (elapsed < windowMs || done + fails < limit) return;
      evaluate(elapsed);
    },
  };
}
