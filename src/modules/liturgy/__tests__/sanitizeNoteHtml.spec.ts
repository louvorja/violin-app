import { describe, expect, it } from "vitest";
import { applySafeNoteHtml, sanitizeNoteHtml } from "../sanitizeNoteHtml";
import { calcularHorarioFim, formatarDuracao, parseSubitem } from "../agenda";
import { LiturgyItemTypeEnum } from "@/enums/LiturgyItemTypeEnum";
import type { LiturgyItem } from "@/types/Liturgy";

describe("sanitizeNoteHtml", () => {
  it("remove scripts, iframes e manipuladores de evento inline", () => {
    const dirty =
      '<p onclick="alert(1)">Olá</p><script>alert("xss")</script><img src=x onerror=alert(1)><iframe src="https://evil.test"></iframe>';
    const clean = sanitizeNoteHtml(dirty);
    expect(clean).not.toContain("<script");
    expect(clean).not.toContain("<iframe");
    expect(clean).not.toContain("onclick");
    expect(clean).not.toContain("onerror");
    expect(clean).toContain("Olá");
  });

  it("preserva formatação rica segura e filtra estilos CSS perigosos", () => {
    const html =
      '<div><b>Negrito</b> <span style="font-size: 16px; color: #ff0000; background-image: url(javascript:alert(1))">Texto</span></div>';
    const container = document.createElement("div");
    applySafeNoteHtml(container, html);

    expect(container.querySelector("b")?.textContent).toBe("Negrito");
    const span = container.querySelector("span") as HTMLElement;
    expect(span.style.fontSize).toBe("16px");
    expect(span.getAttribute("style")).not.toContain("url(");
    expect(span.getAttribute("style")).not.toContain("javascript:");
  });
});

describe("agenda helpers (horário fim, duração, subitem)", () => {
  it("calcula o horário real de término somando a duração do último item", () => {
    const items = [
      { id: "1", tipo: LiturgyItemTypeEnum.ANOTACAO, time: "09:00", duration: 15 },
      { id: "2", tipo: LiturgyItemTypeEnum.ANOTACAO, time: "09:15", duration: 45 },
    ] as LiturgyItem[];
    expect(calcularHorarioFim(items)).toBe("10:00");
  });

  it("formata duração em horas e minutos", () => {
    expect(formatarDuracao(0)).toBe("");
    expect(formatarDuracao(45)).toBe("45min");
    expect(formatarDuracao(60)).toBe("1h");
    expect(formatarDuracao(95)).toBe("1h 35min");
  });

  it("separa ícone e texto de subtítulos no formato icon|||texto", () => {
    expect(parseSubitem("video|||abertura.mp4")).toEqual({
      icon: "video",
      text: "abertura.mp4",
    });
    expect(parseSubitem("Apenas texto")).toEqual({ icon: "", text: "Apenas texto" });
  });
});
