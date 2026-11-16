/**
 * Meta do Cronômetro: parser/formatter usados pelo controle remoto.
 *
 * O contrato do desktop aceita de `0` (limpar a meta) até `99 * 3600`
 * segundos. A tela só envia metas positivas, sempre inteiras, e o mesmo teto
 * da API — antes o parser aceitava `99:59:59` e o `set-target` respondia 400.
 */
export const MAX_TARGET_SECONDS = 99 * 3600;

/** Campo de meta: sempre hh:mm:ss. */
export function formatStopwatchTarget(seconds: number): string {
  const total = Math.max(0, Math.trunc(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * Aceita `mm:ss` ou `hh:mm:ss`, apenas dígitos, com meta entre 1 s e 99 h.
 * Devolve `null` para entrada inválida (o chamador mostra o snack).
 */
export function parseStopwatchTarget(value: string): number | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const parts = raw.split(":").map((part) => part.trim());
  if (parts.some((part) => part === "" || !/^\d+$/.test(part))) return null;
  if (parts.length !== 2 && parts.length !== 3) return null;

  let h: number;
  let m: number;
  let s: number;
  if (parts.length === 2) {
    h = 0;
    m = Number(parts[0]);
    s = Number(parts[1]);
  } else {
    h = Number(parts[0]);
    m = Number(parts[1]);
    s = Number(parts[2]);
  }
  if (h < 0 || h > 99 || m < 0 || m > 59 || s < 0 || s > 59) return null;
  const total = h * 3600 + m * 60 + s;
  return total > 0 && total <= MAX_TARGET_SECONDS ? total : null;
}
