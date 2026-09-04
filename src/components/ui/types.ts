/** Escala de tamanho única do design system. Não existe outro valor. */
export type UiSize = "sm" | "md" | "lg";

/** Tamanho de ícone correspondente a cada tamanho de controle. */
export const ICON_SIZE: Record<UiSize, number> = {
  sm: 13,
  md: 15,
  lg: 17,
};
