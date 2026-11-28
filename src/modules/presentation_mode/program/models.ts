import type { ProgramItem, ProgramModel, ProgramSession } from "@/types/Presentation";

/**
 * Modelo de culto: a estrutura de um programa sem data. Um programa vira
 * modelo ("Salvar como modelo") e um modelo vira o programa de uma data
 * ("Novo programa"). Os itens que mudam toda semana (`fill`) vão vazios para o
 * modelo e nascem pendentes no programa; o resto viaja inteiro.
 */

/** O item já aponta para o que vai tocar/mostrar? */
export function hasContent(item: ProgramItem): boolean {
  return !!(item.source || item.bible || item.folder || item.children?.length);
}

/** Muda toda semana e ainda ninguém escolheu. */
export function isPending(item: ProgramItem): boolean {
  return !!item.fill && !hasContent(item);
}

export function pendingItems(doc: { sessions: ProgramSession[] }): ProgramItem[] {
  return doc.sessions.flatMap((s) => s.items).filter(isPending);
}

const baseName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;

/** O que foi escolhido para um item `fill`, para aparecer ao lado do título. */
export function contentLabel(item: ProgramItem): string {
  if (!item.fill || !hasContent(item)) return "";
  if (item.bible) return item.bible.reference;
  if (item.folder) return baseName(item.folder);
  const source = item.source;
  if (!source) return "";
  if (source.dir) return baseName(source.dir).replace(/\.[^.]+$/, "");
  return source.item ?? "";
}

/** O item sem o conteúdo da semana: só título, tempo e responsável. */
function emptied(item: ProgramItem): ProgramItem {
  const rest = { ...item };
  delete rest.source;
  delete rest.bible;
  delete rest.folder;
  delete rest.children;
  return rest;
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** `Sábado manhã` → `sabado-manha`: o nome do arquivo do modelo. */
export function slugOf(name: string): string {
  return (
    name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "modelo"
  );
}

export function modelFromProgram(
  program: { plannedStart: string; sessions: ProgramSession[] },
  name: string,
  now = new Date()
): ProgramModel {
  return {
    id: slugOf(name),
    name: name.trim(),
    plannedStart: program.plannedStart,
    sessions: clone(program.sessions).map((s) => ({
      ...s,
      items: s.items.map((i) => (i.fill ? emptied(i) : i)),
    })),
    updatedAt: now.toISOString(),
  };
}

/** As sessões do programa novo, com ids próprios: dois programas do mesmo modelo não se cruzam. */
export function sessionsFromModel(model: ProgramModel, newId: () => string): ProgramSession[] {
  return clone(model.sessions).map((s) => ({
    ...s,
    id: newId(),
    items: s.items.map((i) => ({
      ...(i.fill ? emptied(i) : i),
      id: newId(),
      ...(i.children && !i.fill
        ? { children: i.children.map((c) => ({ ...c, id: newId() })) }
        : {}),
      ...(i.source && !i.fill ? { source: { ...i.source, id: newId() } } : {}),
    })),
  }));
}
