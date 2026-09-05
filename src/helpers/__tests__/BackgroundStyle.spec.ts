import { describe, it, expect } from "vitest";
import { estiloDeFundo } from "@/helpers/BackgroundStyle";

describe("estiloDeFundo", () => {
  it("sem imagem devolve só a cor", () => {
    expect(estiloDeFundo({ color: "#000033" })).toEqual({ background: "#000033" });
  });

  it("traduz cada ajuste para o par tamanho/repetição", () => {
    const de = (position: string) => estiloDeFundo({ color: "#000", imageUrl: "u", position });
    expect(de("cover").backgroundSize).toBe("cover");
    expect(de("contain").backgroundSize).toBe("contain");
    expect(de("stretch").backgroundSize).toBe("100% 100%");
    expect(de("center").backgroundSize).toBe("auto");
    expect(de("tile").backgroundSize).toBe("auto");
    expect(de("tile").backgroundRepeat).toBe("repeat");
    expect(de("cover").backgroundRepeat).toBe("no-repeat");
    expect(de("tile").backgroundPosition).toBe("0 0");
    expect(de("cover").backgroundPosition).toBe("center");
  });

  it("cai em cover quando o ajuste é desconhecido ou ausente", () => {
    expect(estiloDeFundo({ color: "#000", imageUrl: "u" }).backgroundSize).toBe("cover");
    expect(estiloDeFundo({ color: "#000", imageUrl: "u", position: "xyz" }).backgroundSize).toBe("cover");
  });

  it("escala só os ajustes que desenham em tamanho natural", () => {
    const p = { color: "#000", imageUrl: "u", escala: 0.25, larguraNatural: 1920 };
    // 1920 × 0.25 — numa miniatura, o natural apareceria gigante e cortado
    expect(estiloDeFundo({ ...p, position: "center" }).backgroundSize).toBe("480px auto");
    expect(estiloDeFundo({ ...p, position: "tile" }).backgroundSize).toBe("480px auto");
    // estes independem do tamanho da caixa e não podem ser mexidos
    expect(estiloDeFundo({ ...p, position: "cover" }).backgroundSize).toBe("cover");
    expect(estiloDeFundo({ ...p, position: "stretch" }).backgroundSize).toBe("100% 100%");
  });

  it("ignora a escala quando falta a largura natural", () => {
    expect(estiloDeFundo({ color: "#000", imageUrl: "u", position: "center", escala: 0.25 })
      .backgroundSize).toBe("auto");
  });
});
