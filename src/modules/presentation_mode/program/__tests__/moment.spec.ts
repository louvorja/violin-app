import { describe, expect, it } from "vitest";
import type { ProgramItem } from "@/types/Presentation";
import { acceptsInMoment, stepChild, withFiles } from "../moment";

let n = 0;
const id = () => `c${++n}`;
const moment = (): ProgramItem => ({ id: "m", kind: "moment", title: "Anúncios", plannedMinutes: 5, children: [] });

describe("momento", () => {
  it("aceita foto, vídeo e PDF/apresentação; recusa áudio e o que não é mídia", () => {
    expect(["a.jpg", "b.mp4", "c.pdf", "d.pptx"].every(acceptsInMoment)).toBe(true);
    expect(["e.mp3", "f.txt"].some(acceptsInMoment)).toBe(false);
  });

  it("acrescenta arquivos sem repetir e com o nome como título", () => {
    const item = moment();
    item.children = withFiles(item, ["/Igreja/Anúncios/Batismo.jpg", "/Igreja/Anúncios/Retiro.mp4", "/x/musica.mp3"], id);
    item.children = withFiles(item, ["/Igreja/Anúncios/Batismo.jpg", "/Igreja/Anúncios/Ceia.png"], id);
    expect(item.children.map((c) => [c.title, c.kind])).toEqual([
      ["Batismo", "image"],
      ["Retiro", "video"],
      ["Ceia", "image"],
    ]);
  });

  it("anda entre os filhos, sem passar das pontas", () => {
    const item = moment();
    item.children = withFiles(item, ["/a/1.jpg", "/a/2.jpg", "/a/3.jpg"], id);
    const [a, b, c] = item.children;
    expect(stepChild(item, a.id, "next")?.id).toBe(b.id);
    expect(stepChild(item, c.id, "next")).toBeNull();
    expect(stepChild(item, b.id, "prev")?.id).toBe(a.id);
    expect(stepChild(item, a.id, "last")?.id).toBe(c.id);
    expect(stepChild(item, "x", "next")).toBeNull();
  });
});
