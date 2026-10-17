import { describe, expect, it } from "vitest";
import type { ProgramSession } from "@/types/Presentation";
import { allPaths, fromPortable, isInside, mapPaths, toPortable } from "../portable";

const MAC = "/Users/operador/Library/CloudStorage/OneDrive-Pessoal/Igreja";
const WIN = "C:\\Users\\Igreja\\OneDrive\\Igreja";

describe("caminhos portáveis", () => {
  it("o que está dentro da pasta da igreja vira relativo, e volta no outro computador", () => {
    const portable = toPortable(`${MAC}/Sábado/Anúncios`, MAC);
    expect(portable).toBe("igreja:Sábado/Anúncios");
    expect(fromPortable(portable, WIN)).toBe(
      "C:\\Users\\Igreja\\OneDrive\\Igreja\\Sábado\\Anúncios"
    );
    expect(fromPortable(toPortable(`${WIN}\\Sábado\\relogio-da-licao.mp4`, WIN), MAC)).toBe(
      `${MAC}/Sábado/relogio-da-licao.mp4`
    );
  });

  it("fora da pasta, URL e sem pasta configurada: fica como está", () => {
    expect(toPortable("/Users/operador/Desktop/video.mp4", MAC)).toBe(
      "/Users/operador/Desktop/video.mp4"
    );
    expect(toPortable(`${MAC}-antiga/x.mp4`, MAC)).toBe(`${MAC}-antiga/x.mp4`);
    expect(toPortable("https://youtu.be/abc", MAC)).toBe("https://youtu.be/abc");
    expect(toPortable(`${MAC}/x.mp4`, null)).toBe(`${MAC}/x.mp4`);
    expect(fromPortable("igreja:x.mp4", null)).toBe("igreja:x.mp4");
  });

  it("no Windows a comparação ignora maiúsculas e barras", () => {
    expect(isInside("c:/users/igreja/onedrive/igreja/Sábado", WIN)).toBe(true);
    expect(isInside(WIN, WIN)).toBe(true);
    expect(toPortable(WIN, WIN)).toBe("igreja:");
    expect(fromPortable("igreja:", MAC)).toBe(MAC);
  });

  it("converte pasta, arquivo e filhos de momento do programa", () => {
    const sessions: ProgramSession[] = [
      {
        id: "s",
        label: "Culto",
        items: [
          {
            id: "a",
            kind: "folder",
            title: "Anúncios",
            plannedMinutes: 6,
            folder: `${MAC}/Sábado/Anúncios`,
          },
          {
            id: "b",
            kind: "video",
            title: "Relógio",
            plannedMinutes: 0,
            source: {
              id: "x",
              tipo: 6,
              dir: `${MAC}/Sábado/relogio.mp4`,
              item: "Relógio",
            } as never,
          },
          {
            id: "c",
            kind: "moment",
            title: "Família",
            plannedMinutes: 5,
            children: [
              { id: "c1", title: "f", kind: "image", path: `${MAC}/Sábado/Momento Família/f.jpg` },
            ],
          },
          { id: "d", kind: "note", title: "Oração", plannedMinutes: 1 },
        ],
      },
    ];
    const portable = mapPaths({ sessions }, (p) => toPortable(p, MAC));
    expect(allPaths(portable)).toEqual([
      "igreja:Sábado/Anúncios",
      "igreja:Sábado/relogio.mp4",
      "igreja:Sábado/Momento Família/f.jpg",
    ]);
    expect(portable.sessions[0].items[3]).toEqual(sessions[0].items[3]);
    const back = mapPaths(portable, (p) => fromPortable(p, MAC));
    expect(back).toEqual({ sessions });
  });
});
