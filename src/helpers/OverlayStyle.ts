import { OVERLAY_STYLE_DEFAULTS, buildAnchorStyle, type OverlaySlot } from "@/types/Overlay";
import { FONT, resolveFont } from "@/config/Fonts";

/**
 * Unidades que medem "a tela inteira". Na projeção é a janela; na
 * pré-visualização do módulo é o palco 16:9 reduzido, medido em unidades de
 * container. É a única diferença permitida entre as duas: o resto do estilo
 * vem daqui, para o que o operador vê no módulo ser o que sai na projeção.
 */
export interface OverlayUnits {
  w: string;
  h: string;
}

export const VIEWPORT_UNITS: OverlayUnits = { w: "vw", h: "vh" };
export const STAGE_UNITS: OverlayUnits = { w: "cqw", h: "cqh" };

export function overlayTextAlign(slot: OverlaySlot): string {
  const anchor = slot.position?.anchor || "bottom-center";
  if (anchor.endsWith("right")) return "right";
  if (anchor === "center" || anchor.endsWith("center")) return "center";
  return "left";
}

export function overlaySlotStyle(slot: OverlaySlot): Record<string, string> {
  const s = slot.style;

  const dur = `${(s.animation_duration || 300) / 1000}s`;
  const out: Record<string, string> = {
    position: "absolute",
    ...buildAnchorStyle(slot.position),
    pointerEvents: "none",
    zIndex: String(slot.order + 1),
    opacity: String((s.opacity ?? 100) / 100),
    transition: `opacity ${dur} ease, transform ${dur} ease`,
    padding: s.padding || "8px 16px",
    animationDuration: dur,
    borderRadius: s.border_radius || "4px",
    border: s.border || "",
    width: s.width || "auto",
    height: s.height || "auto",
    textAlign: overlayTextAlign(slot),
  };

  if (s.background && s.background !== "transparent") {
    if (s.background_opacity !== undefined && s.background_opacity < 100) {
      out.backgroundColor = s.background;
      out.opacity = String(((s.opacity ?? 100) / 100) * ((s.background_opacity ?? 100) / 100));
    } else {
      out.background = s.background;
    }
  }

  if (s.box_shadow) {
    out.boxShadow = "0 4px 16px rgba(0,0,0,0.45)";
  }

  return out;
}

export function overlayImageStyle(
  slot: OverlaySlot,
  units: OverlayUnits = VIEWPORT_UNITS
): Record<string, string> {
  const s = slot.style;
  const scale = (s.image_scale ?? 100) / 100;
  return {
    width: "auto",
    height: "auto",
    maxWidth: `calc(40${units.w} * ${scale})`,
    maxHeight: `calc(30${units.h} * ${scale})`,
    objectFit: s.object_fit || "contain",
    display: "inline-block",
  };
}

export function overlayTextStyle(
  slot: OverlaySlot,
  units: OverlayUnits = VIEWPORT_UNITS
): Record<string, string> {
  const s = slot.style;
  return {
    fontFamily: resolveFont(s.font, FONT.PROJECTION.FALLBACK),
    fontSize: `clamp(14px, ${s.font_size || OVERLAY_STYLE_DEFAULTS.font_size}${units.h}, 80px)`,
    color: s.color || "#FFFFFF",
    textAlign: s.text_align || "center",
    lineHeight: "1.3",
    fontWeight: "600",
    letterSpacing: "0.02em",
    ...(s.text_shadow ? { textShadow: "0 2px 8px rgba(0,0,0,0.8)" } : {}),
  };
}
