import { LiturgyItemTypeEnum } from "@/enums/LiturgyItemTypeEnum";
import type { AlbumItem } from "@/types/Album";

export interface LiturgyItem {
  id: string;
  tipo: LiturgyItemTypeEnum;
  subtipo: string;
  id_music?: number;
  musica: number;
  item: string;
  subitem: string;
  cor: string;
  duration: number;
  time?: string;
  /** Distingue a hora escolhida pelo operador da continuação calculada da agenda. */
  time_mode?: "manual" | "auto";
  dir: string;
  dir_info: string;
  url: string;
  escolha: boolean;
  has_instrumental_music: boolean;
  checked?: string;
  blocoId?: string;
  /** Id de origem em módulos externos ou do arquivo web em liturgy.files (tipo arquivo). */
  ref_id?: string;
  /** Ids dos anúncios selecionados (tipo anuncios), na ordem de projeção. */
  anuncios_ids?: string[];
  /** Slot do overlay a ativar/desativar (tipo overlay). */
  overlay_id?: string;
  /** Ação do overlay: ativar ou desativar (tipo overlay). */
  overlay_action?: "activate" | "deactivate";
  /** Overlay vinculado — ativado automaticamente ao executar o item. */
  linked_overlay_id?: string;
}

export interface LiturgyMusicItem {
  id_music: number | string;
  name: string;
  /** UUID de música personalizada (custom_collections). Presente apenas para músicas fora do catálogo principal. */
  custom_song_id?: string;
  albums?: AlbumItem[];
  albums_names?: string;
  [key: string]: unknown;
}

export interface ScheduledCategory {
  id: string | number;
  nome: string;
  cor?: string;
  auto_folder?: string;
  [key: string]: unknown;
}

export interface ScheduledItem {
  id: string | number;
  duracao?: number;
  arquivo_jpeg?: ArrayBuffer;
  [key: string]: unknown;
}

export interface ChooseLaterItem {
  id: string;
}
