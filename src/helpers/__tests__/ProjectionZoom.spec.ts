import { describe, expect, it } from "vitest";
import { clampZoom, zoomFromPayload, zoomStyle } from "../ProjectionZoom";

const z = (scale: number, cx = 0.5, cy = 0.5) => ({ key: "a", page: 1, scale, cx, cy });

describe("ProjectionZoom", () => {
  it("o recorte não sai da imagem", () => {
    expect(clampZoom(z(2, 0, 1))).toMatchObject({ cx: 0.25, cy: 0.75 });
    expect(clampZoom(z(50)).scale).toBe(8);
    expect(clampZoom(z(0.2)).scale).toBe(1);
  });

  it("leva o centro do recorte ao meio da tela, ampliado", () => {
    expect(zoomStyle(z(2, 0.25, 0.75), "a")?.transform).toBe("translate(50%, -50%) scale(2)");
  });

  it("outra mídia, outra página ou 100%: tela inteira", () => {
    expect(zoomStyle(z(2), "b")).toBeUndefined();
    expect(zoomStyle(z(2), "a", 2)).toBeUndefined();
    expect(zoomStyle(z(1), "a")).toBeUndefined();
  });

  it("payload inválido não vira recorte", () => {
    expect(zoomFromPayload({ key: "" })).toBeNull();
    expect(zoomFromPayload(null)).toBeNull();
    expect(zoomFromPayload({ key: "a", page: 3, scale: 2, cx: 0.5, cy: 0.5 })?.page).toBe(3);
  });
});
