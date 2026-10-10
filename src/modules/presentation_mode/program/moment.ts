import type { ProgramItem, ProgramSubItem } from "@/types/Presentation";
import { kindFromPath } from "./liturgy";
import { isPowerPoint, POWERPOINT_ENABLED } from "../composables/usePowerPoint";

/**
 * Momento do culto: um item do programa com uma lista de arquivos (anúncios,
 * missionário…). Cada filho vai ao ar sozinho; o passador anda entre eles.
 * Também valem para os anúncios importados da liturgia, cujos filhos apontam
 * para a biblioteca de Anúncios (`ref`) em vez de um arquivo (`path`).
 */

/** Tipos que um momento aceita — o que a tela mostra sem tocar áudio sozinho. */
const MOMENT_KINDS = new Set(["image", "video", "presentation"]);

export function acceptsInMoment(path: string): boolean {
  // PowerPoint está desligado (só PDF): nem entra, em vez de falhar no ar.
  if (isPowerPoint(path) && !POWERPOINT_ENABLED) return false;
  return MOMENT_KINDS.has(kindFromPath(path));
}

const baseName = (path: string) => path.split(/[\\/]/).pop() ?? path;

export function childFromPath(path: string, id: string): ProgramSubItem {
  return { id, title: baseName(path).replace(/\.[^.]+$/, ""), kind: kindFromPath(path), path };
}

/** Acrescenta arquivos ao fim do momento; o mesmo arquivo não entra duas vezes. */
export function withFiles(item: ProgramItem, paths: string[], newId: () => string): ProgramSubItem[] {
  const children = item.children ?? [];
  const known = new Set(children.map((c) => c.path).filter(Boolean));
  const added = paths.filter((p) => acceptsInMoment(p) && !known.has(p) && (known.add(p), true));
  return [...children, ...added.map((p) => childFromPath(p, newId()))];
}

export function childIndex(item: ProgramItem | null, childId: string): number {
  return item?.children?.findIndex((c) => c.id === childId) ?? -1;
}

/** O filho vizinho para Anterior/Próximo; null quando não há para onde ir. */
export function stepChild(item: ProgramItem, childId: string, to: "first" | "prev" | "next" | "last"): ProgramSubItem | null {
  const list = item.children ?? [];
  const i = childIndex(item, childId);
  if (i < 0 || !list.length) return null;
  const target = to === "first" ? 0 : to === "last" ? list.length - 1 : to === "next" ? i + 1 : i - 1;
  return target >= 0 && target < list.length && target !== i ? list[target] : null;
}
