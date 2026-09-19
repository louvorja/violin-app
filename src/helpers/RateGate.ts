export type RateGate = (force?: boolean) => boolean;

export function createRateGate(intervalMs: number, now: () => number = Date.now): RateGate {
  let last = -Infinity;
  return (force = false) => {
    const t = now();
    if (!force && t - last < intervalMs) return false;
    last = t;
    return true;
  };
}
