import { describe, it, expect, beforeEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type { Program, ProgramItem } from "@/types/Presentation";

const store = new Map<string, Program>();
vi.mock("@/helpers/DocStore", () => ({
  default: {
    get: vi.fn(async (_table: string, id: string) => store.get(id)),
    put: vi.fn(async (_table: string, value: Program) => {
      store.set(value.id, value);
    }),
  },
}));

const { useProgram } = await import("../useProgram");

function item(id: string, plannedMinutes = 5): ProgramItem {
  return { id, kind: "note", title: id, plannedMinutes };
}

describe("useProgram", () => {
  let program: ReturnType<typeof useProgram>;

  beforeEach(async () => {
    setActivePinia(createPinia());
    store.clear();
    program = useProgram();
    // O singleton guarda o estado ao vivo; passar por outra data o zera.
    await program.setDate("2000-01-01");
    await program.setDate("2026-09-05");
    program.setSessions([
      { id: "s1", label: "Abertura", items: [item("a"), item("b")] },
      { id: "s2", label: "Palavra", items: [item("c")] },
    ]);
  });

  it("grava o programa por data no DocStore", () => {
    expect(store.get("2026-09-05")?.sessions).toHaveLength(2);
  });

  it("o item que sai do ar vira concluído, e voltar a ele o reabre", () => {
    program.goLive("a");
    program.goLive("b");
    expect(program.liveItemId.value).toBe("b");
    expect([...program.doneIds.value]).toEqual(["a"]);
    expect(program.nextItemId.value).toBe("c");

    program.goLive("a");
    expect([...program.doneIds.value]).toEqual(["b"]);
  });

  it("novo item entra logo depois do selecionado", () => {
    program.select("a");
    program.addItem(item("novo"), "s1");
    expect(program.program.value.sessions[0].items.map((i) => i.id)).toEqual(["a", "novo", "b"]);
    expect(program.selectedItemId.value).toBe("novo");
  });

  it("trocar a sessão na edição move o item", () => {
    program.updateItem("a", { title: "Boas-vindas" }, "s2");
    const [s1, s2] = program.program.value.sessions;
    expect(s1.items.map((i) => i.id)).toEqual(["b"]);
    expect(s2.items.map((i) => i.title)).toEqual(["c", "Boas-vindas"]);
  });

  it("duplicar cria cópia com id novo ao lado do original", () => {
    const copy = program.duplicateItem("b");
    const ids = program.program.value.sessions[0].items.map((i) => i.id);
    expect(ids).toEqual(["a", "b", copy!.id]);
    expect(copy!.id).not.toBe("b");
  });

  it("excluir o item ao vivo tira-o do ar", () => {
    program.goLive("c");
    program.removeItem("c");
    expect(program.liveItemId.value).toBeNull();
    expect(program.items.value.map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("A seguir: o primeiro não concluído, depois o seguinte ao que está no ar", () => {
    expect(program.upNextItem.value?.id).toBe("a");
    program.goLive("a");
    expect(program.upNextItem.value?.id).toBe("b");
    program.goLive("c");
    expect(program.upNextItem.value).toBeNull();
  });

  it("com a saída travada, o item na fila passa à frente em A seguir", () => {
    program.setOutputLocked(true);
    expect(program.outputLocked.value).toBe(true);
    program.goLive("a");
    program.prepare("c");
    expect(program.upNextItem.value?.id).toBe("c");
    program.removeItem("c");
    expect(program.preparedItemId.value).toBeNull();
    program.setOutputLocked(false);
  });

  it("trocar de data zera o estado ao vivo e carrega o outro programa", async () => {
    program.goLive("a");
    await program.setDate("2026-09-12");
    expect(program.liveItemId.value).toBeNull();
    expect(program.program.value.sessions).toEqual([]);

    await program.setDate("2026-09-05");
    expect(program.program.value.sessions).toHaveLength(2);
  });
});
