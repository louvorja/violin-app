import type { LiturgyBinding } from "@/types/LiturgyLibrary";

/**
 * A data do programa ao importar uma liturgia da biblioteca.
 *
 * - `date`: a data exata do vínculo.
 * - `day_of_week`: a próxima ocorrência daquele dia a partir da data atual
 *   (se a data já for o dia, fica nela).
 * - `thirteenth_sabbath`: o próximo 13º sábado (último sábado do trimestre).
 * - sem vínculo: `null` — a data do programa não muda.
 */

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseIso(iso: string): Date | null {
  const match = ISO_RE.exec(iso);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(year, month, day);
  // Rejeita 2026-02-31 e afins (o Date "rola" para o mês seguinte).
  if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) return null;
  return date;
}

function isoOf(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Próxima data com esse dia da semana, contando a própria data. */
export function nextWeekday(fromIso: string, weekday: number): string | null {
  const from = parseIso(fromIso);
  if (!from || !Number.isInteger(weekday) || weekday < 0 || weekday > 6) return null;
  const delta = (weekday - from.getDay() + 7) % 7;
  return isoOf(new Date(from.getFullYear(), from.getMonth(), from.getDate() + delta));
}

/** Último sábado do trimestre que contém o mês (0–11). */
function lastSaturdayOfQuarter(year: number, month: number): Date {
  const quarterEndMonth = Math.floor(month / 3) * 3 + 2;
  const date = new Date(year, quarterEndMonth + 1, 0);
  while (date.getDay() !== 6) date.setDate(date.getDate() - 1);
  return date;
}

/** Próximo 13º sábado, contando a própria data. */
export function nextThirteenthSabbath(fromIso: string): string | null {
  const from = parseIso(fromIso);
  if (!from) return null;
  let candidate = lastSaturdayOfQuarter(from.getFullYear(), from.getMonth());
  if (candidate.getTime() < from.getTime()) {
    candidate = lastSaturdayOfQuarter(from.getFullYear(), from.getMonth() + 3);
  }
  return isoOf(candidate);
}

/** `null`: mantém a data atual do programa. */
export function liturgyTargetDate(
  binding: LiturgyBinding | null | undefined,
  fromIso: string
): string | null {
  if (!binding) return null;
  if (binding.type === "date") return parseIso(binding.value) ? binding.value : null;
  if (binding.type === "day_of_week") return nextWeekday(fromIso, Number(binding.value));
  if (binding.type === "thirteenth_sabbath") return nextThirteenthSabbath(fromIso);
  return null;
}
