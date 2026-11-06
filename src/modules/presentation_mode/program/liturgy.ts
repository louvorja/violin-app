import { LiturgyItemTypeEnum } from "@/enums/LiturgyItemTypeEnum";
import type { LiturgyItem } from "@/types/Liturgy";
import type {
  Program,
  ProgramItem,
  ProgramSession,
  ProgramSubItem,
} from "@/types/Presentation";
import { prepararAgenda } from "@/modules/liturgy/agenda";
import { kindOf, newItem } from "@/modules/liturgy/item";
import { formatHHMM, parseHHMM, sessionStarts } from "./time";

/**
 * Ponte entre a liturgia do dia da semana e o programa por data.
 *
 * A importação é uma cópia: depois dela os dois seguem caminhos próprios.
 * O item da liturgia viaja inteiro em `source`, porque é ele que o motor de
 * execução da liturgia sabe tocar.
 */

export interface ImportOptions {
  newId: () => string;
  /** Rótulo da sessão que recebe os itens anteriores ao primeiro bloco. */
  defaultSessionLabel: string;
  /** Anúncios em ordem de projeção, para virar sub-itens. */
  announcements?: ReadonlyArray<{ id: string; title: string }>;
}

export interface ImportedProgram {
  /** Hora do primeiro bloco com horário; `null` se a liturgia não tem nenhuma. */
  plannedStart: string | null;
  sessions: ProgramSession[];
}

function announcementChildren(item: LiturgyItem, opts: ImportOptions): ProgramSubItem[] {
  const all = opts.announcements ?? [];
  const ids = item.anuncios_ids ?? [];
  // Sem seleção, a liturgia projeta todos — o programa mostra todos.
  const chosen = ids.length ? all.filter((a) => ids.includes(a.id)) : all;
  return chosen.map((a) => ({ id: opts.newId(), title: a.title, kind: "image", ref: a.id }));
}

export function importLiturgy(items: LiturgyItem[], opts: ImportOptions): ImportedProgram {
  const sessions: ProgramSession[] = [];
  let plannedStart: string | null = null;
  let current: ProgramSession | null = null;

  for (const item of prepararAgenda(items)) {
    if (item.tipo === LiturgyItemTypeEnum.BLOCO) {
      if (plannedStart === null && parseHHMM(item.time) !== null) plannedStart = item.time!;
      current = { id: opts.newId(), label: item.item || opts.defaultSessionLabel, items: [] };
      sessions.push(current);
      continue;
    }
    if (!current) {
      current = { id: opts.newId(), label: opts.defaultSessionLabel, items: [] };
      sessions.push(current);
    }

    const kind = kindOf(item);
    const programItem: ProgramItem = {
      id: opts.newId(),
      kind,
      title: item.item || "",
      subtitle: item.subitem || undefined,
      plannedMinutes: Math.max(0, Number(item.duration) || 0),
      source: { ...item, time: undefined },
    };
    if (kind === "announcements") programItem.children = announcementChildren(item, opts);
    current.items.push(programItem);
  }

  return { plannedStart, sessions };
}

/**
 * O programa como liturgia, para a biblioteca: cada sessão vira um bloco com
 * o horário em que começa, e cada item volta a ser o item de liturgia que ele
 * carrega. Versículo não tem tipo na liturgia e vira anotação com o texto.
 */
export function programToLiturgy(program: Program, newId: () => string): LiturgyItem[] {
  const starts = sessionStarts(program);
  const result: LiturgyItem[] = [];

  for (const session of program.sessions) {
    const blocoId = newId();
    result.push(
      newItem(LiturgyItemTypeEnum.BLOCO, {
        id: blocoId,
        item: session.label,
        time: formatHHMM(starts.get(session.id) ?? 0),
      })
    );
    for (const item of session.items) {
      const base = item.source
        ? { ...item.source }
        : newItem(LiturgyItemTypeEnum.ANOTACAO, {
            id: "",
            subitem: item.bible?.text ?? item.notes ?? "",
          });
      result.push({
        ...base,
        id: newId(),
        blocoId,
        item: item.title,
        subitem: item.bible ? base.subitem : (item.subtitle ?? base.subitem),
        duration: item.plannedMinutes,
        time: undefined,
        checked: undefined,
      });
    }
  }
  return result;
}
