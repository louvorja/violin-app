import { describe, expect, it } from "vitest";
import type { ProgramItem, ProgramSession } from "@/types/Presentation";
import {
  contentLabel,
  isPending,
  modelFromProgram,
  pendingItems,
  sessionsFromModel,
  slugOf,
} from "../models";

const hymn = (fill: boolean, withSong = true): ProgramItem => ({
  id: "m1",
  kind: "music",
  title: "Música 1 – em pé",
  subtitle: "Ancião",
  plannedMinutes: 4,
  ...(fill ? { fill: true } : {}),
  ...(withSong
    ? { source: { id: "src", tipo: 1, id_music: 466, item: "Um Pouco Mais" } as never }
    : {}),
});

const program = (): { plannedStart: string; sessions: ProgramSession[] } => ({
  plannedStart: "08:55",
  sessions: [
    {
      id: "s1",
      label: "Escola Sabatina",
      items: [
        hymn(true),
        {
          id: "f",
          kind: "folder",
          title: "Minuto da Saúde",
          plannedMinutes: 1,
          folder: "igreja:Sábado/Minuto Saúde",
        },
        { id: "n", kind: "note", title: "Lição nas classes", plannedMinutes: 40 },
      ],
    },
  ],
});

let n = 0;
const id = () => `id${++n}`;

describe("modelos de culto", () => {
  it("pendente é o que muda toda semana e ainda não tem conteúdo", () => {
    expect(isPending(hymn(true, false))).toBe(true);
    expect(isPending(hymn(true))).toBe(false);
    expect(isPending(hymn(false, false))).toBe(false);
  });

  it("o modelo leva a estrutura; os itens da semana vão vazios", () => {
    const model = modelFromProgram(program(), "Sábado", new Date("2026-10-09T21:42:00Z"));
    expect(model).toMatchObject({ id: "sabado", name: "Sábado", plannedStart: "08:55" });
    const [first, folder, note] = model.sessions[0].items;
    expect(first).toEqual({
      id: "m1",
      kind: "music",
      title: "Música 1 – em pé",
      subtitle: "Ancião",
      plannedMinutes: 4,
      fill: true,
    });
    expect(folder.folder).toBe("igreja:Sábado/Minuto Saúde");
    expect(note.title).toBe("Lição nas classes");
    expect(pendingItems(model).map((i) => i.title)).toEqual(["Música 1 – em pé"]);
  });

  it("o programa novo nasce com ids próprios e com as pendências", () => {
    const model = modelFromProgram(program(), "Sábado");
    const a = sessionsFromModel(model, id);
    const b = sessionsFromModel(model, id);
    const ids = (s: ProgramSession[]) => [s[0].id, ...s[0].items.map((i) => i.id)];
    expect(ids(a).some((x) => ids(b).includes(x))).toBe(false);
    expect(ids(a)).not.toContain("m1");
    expect(pendingItems({ sessions: a })).toHaveLength(1);
    expect(a[0].items[1].folder).toBe("igreja:Sábado/Minuto Saúde");
  });

  it("mostra o que foi escolhido ao lado do título", () => {
    expect(contentLabel(hymn(true))).toBe("Um Pouco Mais");
    expect(contentLabel(hymn(false))).toBe("");
    expect(
      contentLabel({ ...hymn(true, false), kind: "folder", folder: "/x/Música Especial" })
    ).toBe("Música Especial");
  });

  it("nome do arquivo do modelo sem acento nem espaço", () => {
    expect(slugOf("Sábado manhã")).toBe("sabado-manha");
    expect(slugOf("  ")).toBe("modelo");
  });
});
