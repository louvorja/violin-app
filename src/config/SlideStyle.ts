import { FONT } from "@/config/Fonts";

/**
 * Defaults que replicam o visual original do Delphi/Projection atual.
 * Aplicados quando o usuário ainda não configurou em "Formatação".
 */
export const SLIDE_STYLE_DEFAULT = Object.freeze({
  font: FONT.PROJECTION.INHERIT,
  font_size_cover: 18, // % da viewport height (vh)
  font_size_lyric: 10,
  font_size_aux: 8,
  font_size_next: 5, // ProjectionReturn — próximo slide
  color_cover: "#EFB400", // gold (cor da capa Delphi)
  color_lyric: "#FFFFFF",
  color_repeat: "#EFB400", // refrão/repetição (gold por default)
  color_next: "#FFFFFF",
  color_aux: "#EFB400",
  background_color: "#000000",
  background_image: "",
  background_position: "center center",
  progress_color: "#EFB400",
  show_progress_bar: true,
  show_title_first_slide: true,
  text_align: "center" as "top" | "center" | "bottom",
  transition_speed_ms: 120, // fade-in da tela inteira (rápido — antes 256ms)
  text_bg_transparent: false, // caixa de texto atrás da letra (translúcida quando false)
  text_bg_blur_enabled: false,
  text_bg_blur: 12,
  text_border_enabled: false,
  text_border_color: "#FFFFFF",
  text_border_width: 2,
  affect_external_slides: true, // formatação personalizada vence formatação do slide externo
  custom_background_active: false, // toggle "Fundo personalizado" ligado pelo usuário
  shadow_enabled: false,
  shadow_color: "#000000",
  shadow_blur: 12,
  shadow_offset_x: 0,
  shadow_offset_y: 2,

  // Fundo da tela de retorno (independente do fundo dos slides)
  custom_return_background_active: false,
  return_bg_top_color: "#1a201a", // verde escuro atual (hardcoded)
  return_bg_top_image: "",
  return_bg_top_position: "center center",
  return_bg_bottom_color: "#1d251d", // topo do gradiente atual
  return_bg_bottom_image: "",
  return_bg_bottom_position: "center center",

  // Formatação de texto do retorno
  return_height_bottom: 18, // vh — painel inferior
  return_font_size_cover: 14, // vh — capa no retorno
  return_font_size_lyric: 11, // vh — letra no retorno
  return_top_text_case: "uppercase",
  return_top_text_align: "center",
  return_bottom_text_case: "uppercase",
  return_bottom_text_align: "center",
  custom_return_text_format_active: false,
});
