import type { LiturgyItem } from "@/types/Liturgy";

/** O que um item projeta. Decide o ícone e, nas próximas fases, o palco. */
export type ProgramItemKind =
  | "music"
  | "video"
  | "online_video"
  | "image"
  | "audio"
  | "file"
  | "presentation"
  | "bible"
  | "announcements"
  /** Momento do culto com uma lista de fotos, vídeos e PDFs (anúncios, missionário…). */
  | "moment"
  | "note"
  | "site"
  | "overlay"
  | "scheduled";

/** Versículo escolhido pelo BibleSpotlight — a liturgia não tem tipo Bíblia. */
export interface ProgramBibleRef {
  reference: string;
  text: string;
  book_id: number;
  chapter: number;
  verses: number[];
  version_id?: number;
}

export interface ProgramSubItem {
  id: string;
  title: string;
  kind: ProgramItemKind;
  seconds?: number;
  /** Id do anúncio (announcements.library) que este sub-item projeta. */
  ref?: string;
  /** Arquivo da biblioteca (foto, vídeo, PDF) que este sub-item projeta. */
  path?: string;
}

export interface ProgramItem {
  id: string;
  kind: ProgramItemKind;
  title: string;
  subtitle?: string;
  /** Duração prevista, em minutos. */
  plannedMinutes: number;
  /**
   * Item da liturgia que sabe se executar. Guardar o item inteiro, e não só
   * a referência, mantém o que a liturgia sabe fazer (versão da música,
   * overlay vinculado, arquivo agendado) sem o programa reimplementar.
   */
  source?: LiturgyItem;
  bible?: ProgramBibleRef;
  children?: ProgramSubItem[];
  notes?: string;
}

export interface ProgramSession {
  id: string;
  label: string;
  items: ProgramItem[];
}

/** Um documento por data, na coleção `presentation_mode.programs`. */
export interface Program {
  /** O próprio dia (`YYYY-MM-DD`): um programa por data. */
  id: string;
  date: string;
  /** Início planejado, `HH:MM`. */
  plannedStart: string;
  sessions: ProgramSession[];
  createdAt: string;
  updatedAt: string;
}
