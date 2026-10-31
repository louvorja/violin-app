import { describe, expect, it } from "vitest";
import { LiturgyItemTypeEnum } from "@/enums/LiturgyItemTypeEnum";
import type { Program } from "@/types/Presentation";
import { isUrl, programFilePaths } from "../paths";

describe("programFilePaths", () => {
  it("junta os arquivos dos itens e dos momentos, sem URLs nem repetidos", () => {
    const program = {
      sessions: [
        {
          id: "s",
          items: [
            { id: "a", kind: "file", title: "A", source: { tipo: LiturgyItemTypeEnum.ARQUIVO, dir: "/igreja/a.mp4" } },
            { id: "b", kind: "online_video", title: "B", source: { tipo: LiturgyItemTypeEnum.ARQUIVO, dir: "https://youtu.be/x" } },
            {
              id: "m",
              kind: "moment",
              title: "M",
              children: [
                { id: "1", title: "1", path: "/igreja/a.mp4" },
                { id: "2", title: "2", path: "/igreja/b.png" },
                { id: "3", title: "anúncio" },
              ],
            },
            { id: "c", kind: "music", title: "C", source: { tipo: LiturgyItemTypeEnum.MUSICA, dir: "/nao/conta.mp3" } },
          ],
        },
      ],
    } as unknown as Program;
    expect(programFilePaths(program)).toEqual(["/igreja/a.mp4", "/igreja/b.png"]);
  });

  it("isUrl separa endereço de caminho do disco", () => {
    expect(isUrl("https://www.youtube.com/watch?v=x")).toBe(true);
    expect(isUrl("louvorja://local/x")).toBe(true);
    expect(isUrl("/Users/x/a.mp4")).toBe(false);
    expect(isUrl("C:\\Igreja\\a.mp4")).toBe(false);
  });
});
