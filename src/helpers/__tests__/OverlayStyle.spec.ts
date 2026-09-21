import { describe, expect, it } from "vitest";
import { createOverlaySlot } from "@/types/Overlay";
import {
  STAGE_UNITS,
  overlayImageStyle,
  overlaySlotStyle,
  overlayTextStyle,
  overlayTextAlign,
} from "@/helpers/OverlayStyle";

/**
 * A projeção e a pré-visualização do módulo Sobreposições montam o estilo pelas
 * mesmas funções. Quando cada uma tinha a sua cópia, elas divergiram sem
 * ninguém notar: a prévia media o texto em `vh` da janela do app e a imagem em
 * `%` do próprio elemento, então o operador ajustava a sobreposição olhando um
 * tamanho que não era o da projeção.
 *
 * A única diferença permitida é a unidade que mede "a tela inteira".
 */

describe("estilo de sobreposição", () => {
  it("mede o texto pela altura da tela e o palco pela altura do container", () => {
    const slot = createOverlaySlot();
    slot.style.font_size = 7;
    expect(overlayTextStyle(slot).fontSize).toBe("clamp(14px, 7vh, 80px)");
    expect(overlayTextStyle(slot, STAGE_UNITS).fontSize).toBe("clamp(14px, 7cqh, 80px)");
  });

  it("mede a imagem pela largura e altura da tela, com a escala do slot", () => {
    const slot = createOverlaySlot({ type: "image" });
    slot.style.image_scale = 150;
    expect(overlayImageStyle(slot)).toMatchObject({
      maxWidth: "calc(40vw * 1.5)",
      maxHeight: "calc(30vh * 1.5)",
    });
    expect(overlayImageStyle(slot, STAGE_UNITS)).toMatchObject({
      maxWidth: "calc(40cqw * 1.5)",
      maxHeight: "calc(30cqh * 1.5)",
    });
  });

  it("fundo transparente não pinta nada", () => {
    const slot = createOverlaySlot();
    slot.style.background = "transparent";
    const style = overlaySlotStyle(slot);
    expect(style.background).toBeUndefined();
    expect(style.backgroundColor).toBeUndefined();
  });

  it("fundo com opacidade menor que 100 vira backgroundColor e escurece o conjunto", () => {
    const slot = createOverlaySlot();
    slot.style.background = "#112233";
    slot.style.opacity = 50;
    slot.style.background_opacity = 40;
    const style = overlaySlotStyle(slot);
    expect(style.background).toBeUndefined();
    expect(style.backgroundColor).toBe("#112233");
    expect(Number(style.opacity)).toBeCloseTo(0.2);
  });

  it("alinha o texto pelo lado da âncora", () => {
    const at = (anchor: string) =>
      overlayTextAlign({ ...createOverlaySlot(), position: { anchor, offset_x: 0, offset_y: 0 } } as never);
    expect(at("top-left")).toBe("left");
    expect(at("center")).toBe("center");
    expect(at("bottom-center")).toBe("center");
    expect(at("center-right")).toBe("right");
  });
});
