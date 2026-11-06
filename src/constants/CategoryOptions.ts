import { ICONS } from "@/config/Icons";

/**
 * Paleta e ícones únicos do gerenciador de categorias.
 *
 * Os módulos não devem manter cópias locais: uma cor criada numa Biblioteca
 * precisa ser a mesma oferecida no Som, na Projeção e nos Vídeos. A paleta é
 * a união das opções que já existiam, começando pelas oito originais.
 */
export const CATEGORY_COLOR_PRESETS: string[] = [
  "#4CAF50",
  "#2196F3",
  "#9C27B0",
  "#FF9800",
  "#F44336",
  "#00BCD4",
  "#3F51B5",
  "#E91E63",
  "#8BC34A",
  "#FF5722",
  "#607D8B",
  "#795548",
  "#9E9E9E",
  "#CDDC39",
  "#03A9F4",
];

export const CATEGORY_ICON_OPTIONS: { value: string }[] = Object.values(ICONS.CATEGORY).map(
  (value) => ({ value })
);
