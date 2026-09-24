import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  tables: new Map<string, Map<string, { id: string; value?: string }>>(),
  failOnPut: 0,
  putCount: 0,
}));

vi.mock("idb", () => ({
  openDB: vi.fn(async () => ({
    transaction(names: string[]) {
      const draft = new Map(names.map((name) => [name, new Map(state.tables.get(name) ?? [])]));
      let aborted = false;
      return {
        objectStore(name: string) {
          const rows = draft.get(name)!;
          return {
            async getAllKeys(range: { lower: string; upper: string }) {
              return [...rows.keys()].filter((key) => key >= range.lower && key <= range.upper);
            },
            async delete(id: string) {
              rows.delete(id);
            },
            async put(row: { id: string; value?: string }) {
              state.putCount++;
              if (state.putCount === state.failOnPut) throw new Error("quota exceeded");
              rows.set(row.id, row);
            },
          };
        },
        abort() {
          aborted = true;
        },
        get done() {
          if (aborted) return Promise.reject(new Error("transaction aborted"));
          for (const [name, rows] of draft) state.tables.set(name, rows);
          return Promise.resolve();
        },
      };
    },
  })),
}));

beforeEach(() => {
  state.tables.clear();
  state.tables.set("cache", new Map([["marker", { id: "marker", value: "old" }]]));
  state.tables.set("musics", new Map([["pt_musics:1", { id: "pt_musics:1", value: "old" }]]));
  state.failOnPut = 0;
  state.putCount = 0;
  vi.stubGlobal("IDBKeyRange", { bound: (lower: string, upper: string) => ({ lower, upper }) });
  vi.resetModules();
});

const changes = [
  {
    key: "pt_musics",
    writes: [
      {
        table: "musics",
        replacePrefix: "pt_musics:",
        rows: [{ id: "pt_musics:2", value: "new" }],
      },
    ],
  },
  { key: "config", writes: [{ table: "cache", rows: [{ id: "config", value: "new" }] }] },
];

describe("IndexedDB.applyCatalogBatch", () => {
  it("publica datasets e marcador juntos, preservando chaves não relacionadas", async () => {
    state.tables.get("cache")!.set("unrelated", { id: "unrelated", value: "keep" });
    const idb = (await import("@/helpers/IndexedDB")).default;
    const onApplied = vi.fn();
    const marker = { id: "marker", value: "new" };

    await idb.applyCatalogBatch(changes, marker, { onApplied });

    expect([...state.tables.get("musics")!.keys()]).toEqual(["pt_musics:2"]);
    expect(state.tables.get("cache")!.get("marker")?.value).toBe("new");
    expect(state.tables.get("cache")!.get("unrelated")?.value).toBe("keep");
    expect(onApplied).toHaveBeenCalledTimes(2);
  });

  it("reverte a troca se uma escrita falhar depois da primeira alteração", async () => {
    state.failOnPut = 2;
    const idb = (await import("@/helpers/IndexedDB")).default;
    const marker = { id: "marker", value: "new" };

    await expect(idb.applyCatalogBatch(changes, marker)).rejects.toThrow("quota exceeded");

    expect([...state.tables.get("musics")!.keys()]).toEqual(["pt_musics:1"]);
    expect(state.tables.get("cache")!.get("marker")?.value).toBe("old");
    expect(state.tables.get("cache")!.has("config")).toBe(false);
  });

  it("reverte também se a escrita final do marcador falhar", async () => {
    state.failOnPut = 3;
    const idb = (await import("@/helpers/IndexedDB")).default;
    const marker = { id: "marker", value: "new" };

    await expect(idb.applyCatalogBatch(changes, marker)).rejects.toThrow("quota exceeded");

    expect([...state.tables.get("musics")!.keys()]).toEqual(["pt_musics:1"]);
    expect(state.tables.get("cache")!.get("marker")?.value).toBe("old");
    expect(state.tables.get("cache")!.has("config")).toBe(false);
  });

  it("aborta uma transação em andamento sem perder o catálogo anterior", async () => {
    const idb = (await import("@/helpers/IndexedDB")).default;
    const controller = new AbortController();
    const marker = { id: "marker", value: "new" };

    await expect(
      idb.applyCatalogBatch(changes, marker, {
        signal: controller.signal,
        onApplied: () => controller.abort(new Error("cancelado")),
      })
    ).rejects.toThrow("cancelado");

    expect([...state.tables.get("musics")!.keys()]).toEqual(["pt_musics:1"]);
    expect(state.tables.get("cache")!.get("marker")?.value).toBe("old");
  });
});
