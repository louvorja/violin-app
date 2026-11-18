import type { LiturgyItem } from "@/types/Liturgy";

export interface LiturgyBinding {
  type: "day_of_week" | "date" | "thirteenth_sabbath";
  value: string;
}

export interface LiturgyLibraryItem {
  id: string;
  name: string;
  color: string;
  items: LiturgyItem[];
  binding: LiturgyBinding | null;
  updatedAt: string;
  createdAt: string;
}

/** O que o seletor devolve: uma liturgia da biblioteca ou a do dia (não salva). */
export interface LiturgyPick {
  /** `null`: a liturgia do dia da semana, que não está na biblioteca. */
  id: string | null;
  name: string;
  items: LiturgyItem[];
  binding: LiturgyBinding | null;
}

/** Opção extra mostrada acima da biblioteca (a liturgia do dia ainda não salva). */
export interface LiturgyOptionExtra {
  name: string;
  subtitle?: string;
  items: LiturgyItem[];
}
