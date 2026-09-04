/**
 * Escala de tamanho única do design system. Não existe outro valor.
 *
 * `touch` é exceção deliberada, não um quarto tamanho livre: vale só para
 * superfícies operadas com o dedo — hoje, o controle remoto que o operador abre
 * no celular. Na shell, use sm/md/lg.
 */
export type UiSize = "sm" | "md" | "lg" | "touch";

/** Tamanho de ícone correspondente a cada tamanho de controle. */
export const ICON_SIZE: Record<UiSize, number> = {
  sm: 13,
  md: 15,
  lg: 17,
  touch: 20,
};
