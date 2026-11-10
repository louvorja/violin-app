export const COUNTER_START = 0;

/** O que o Contador projeta antes do primeiro toque. */
export function counterIdleText(): string {
  return String(COUNTER_START);
}
