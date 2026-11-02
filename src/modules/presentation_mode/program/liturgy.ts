import { LiturgyItemTypeEnum } from "@/enums/LiturgyItemTypeEnum";
import { AUDIO_EXT, IMAGE_EXT, VIDEO_EXT } from "@/constants/FileTypes";
import type { LiturgyItem } from "@/types/Liturgy";
import type {
  Program,
  ProgramItem,
  ProgramItemKind,
  ProgramSession,
  ProgramSubItem,
} from "@/types/Presentation";
import { prepararAgenda } from "@/modules/liturgy/agenda";
import { formatHHMM, parseHHMM, sessionStarts } from "./time";

/**
 * Ponte entre a liturgia do dia da semana e o programa por data.
 *
 * A importação é uma cópia: depois dela os dois seguem caminhos próprios.
 * O item da liturgia viaja inteiro em `source`, porque é ele que o motor de
 * execução da liturgia sabe tocar.
 */

const PRESENTATION_EXT = ["ppt", "pptx", "odp", "key", "pdf", "slja"];

function extensionOf(path: string): string {
  const clean = path.split(/[?#]/)[0];
  const dot = clean.lastIndexOf(".");
  return dot >= 0 ? clean.slice(dot + 1).toLowerCase() : "";
}

export function kindFromPath(path: string): ProgramItemKind {
  const ext = extensionOf(path);
  if (IMAGE_EXT.includes(ext)) return "image";
  if (VIDEO_EXT.includes(ext)) return "video";
  if (AUDIO_EXT.includes(ext)) return "audio";
  if (PRESENTATION_EXT.includes(ext)) return "presentation";
  return "file";
}

function isYoutube(url: string): boolean {
  return /youtu\.?be/i.test(url);
}

export function kindFromLiturgy(item: LiturgyItem): ProgramItemKind {
  switch (item.tipo) {
    case LiturgyItemTypeEnum.MUSICA:
      return "music";
    case LiturgyItemTypeEnum.ARQUIVO:
      return kindFromPath(item.dir || "");
    case LiturgyItemTypeEnum.SITE:
      return isYoutube(item.url || item.subitem || "") ? "online_video" : "site";
    case LiturgyItemTypeEnum.VIDEO_ONLINE:
      return "online_video";
    case LiturgyItemTypeEnum.MEDIA_LIBRARY:
      if (item.subtipo === "image") return "image";
      if (item.subtipo === "video") return "video";
      if (item.subtipo === "pdf") return "presentation";
      return "file";
    case LiturgyItemTypeEnum.BG_SOUND:
      return "audio";
    case LiturgyItemTypeEnum.ANUNCIOS:
      return "announcements";
    case LiturgyItemTypeEnum.OVERLAY:
      return "overlay";
    case LiturgyItemTypeEnum.ITENS_AGENDADOS:
      return "scheduled";
    default:
      return "note";
  }
}

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

    const kind = kindFromLiturgy(item);
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

const DEFAULT_COLOR = "#4F0000";

/** Item de liturgia completo a partir do essencial — os campos que o tipo exige. */
export function liturgyItem(fields: Partial<LiturgyItem> & Pick<LiturgyItem, "id" | "tipo">): LiturgyItem {
  return {
    subtipo: "",
    item: "",
    subitem: "",
    cor: DEFAULT_COLOR,
    duration: 0,
    musica: -1,
    dir: "",
    dir_info: "E",
    url: "",
    escolha: false,
    has_instrumental_music: false,
    ...fields,
  };
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
      liturgyItem({
        id: blocoId,
        tipo: LiturgyItemTypeEnum.BLOCO,
        item: session.label,
        time: formatHHMM(starts.get(session.id) ?? 0),
      })
    );
    for (const item of session.items) {
      const base = item.source
        ? { ...item.source }
        : liturgyItem({
            id: "",
            tipo: LiturgyItemTypeEnum.ANOTACAO,
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
