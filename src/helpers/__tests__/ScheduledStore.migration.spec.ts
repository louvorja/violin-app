import { beforeEach, describe, expect, it, vi } from "vitest";
import { DB_TABLE } from "@/constants/DbTables";
import { KEYS } from "@/constants/UserDataKeys";

const h = vi.hoisted(() => ({
  tables: new Map<string, Array<{ id: string }>>(),
  preferences: new Map<string, unknown>(),
  getAll: vi.fn(),
  put: vi.fn(),
  putMany: vi.fn(),
  failId: null as string | null,
  del: vi.fn(),
  set: vi.fn(),
  flush: vi.fn(),
}));
vi.mock("@/helpers/DocStore", () => ({
  default: { getAll: h.getAll, put: h.put, putMany: h.putMany, del: h.del },
}));
vi.mock("@/helpers/UserData", () => ({
  default: {
    get: (key: string, fallback: unknown) => h.preferences.get(key) ?? fallback,
    set: h.set,
    flushPendingWebSave: h.flush,
  },
}));

beforeEach(() => {
  vi.resetModules();
  h.tables.clear();
  h.preferences.clear();
  h.failId = null;
  h.preferences.set(KEYS.MODULES.LITURGY.SCHEDULED_CATEGORIES, [{ id: "cat", nome: "Avisos" }]);
  h.preferences.set(KEYS.MODULES.LITURGY.SCHEDULED_ITEMS, [{ id: "item", categoria: "cat" }]);
  h.getAll
    .mockReset()
    .mockImplementation(async (table) => structuredClone(h.tables.get(table) || []));
  h.put.mockReset().mockImplementation(async (table, value) => {
    if (value.id === h.failId) throw new Error("quota");
    const rows = (h.tables.get(table) || []).filter((row) => row.id !== value.id);
    h.tables.set(table, [...rows, structuredClone(value)]);
  });
  h.putMany.mockReset().mockImplementation(async (table, values: Array<{ id: string }>) => {
    if (values.some((value) => value.id === h.failId)) throw new Error("quota");
    const rows = new Map((h.tables.get(table) || []).map((row) => [row.id, row]));
    for (const value of values) rows.set(value.id, structuredClone(value));
    h.tables.set(table, [...rows.values()]);
  });
  h.del.mockReset().mockImplementation(async (table, id) => {
    h.tables.set(
      table,
      (h.tables.get(table) || []).filter((row) => row.id !== id)
    );
  });
  h.set.mockReset().mockImplementation((key, value) => h.preferences.set(key, value));
  h.flush.mockReset();
});

describe("migração de agendados respeita exclusões nos próximos boots", () => {
  it("marca a migração concluída e não ressuscita a última categoria excluída", async () => {
    let { default: scheduled } = await import("../ScheduledStore");
    await scheduled.hydrate();
    expect(scheduled.items()).toHaveLength(1);
    await scheduled.deleteCategory("cat");
    vi.resetModules();
    ({ default: scheduled } = await import("../ScheduledStore"));
    await scheduled.hydrate();
    expect(scheduled.categories()).toEqual([]);
    expect(scheduled.items()).toEqual([]);
    expect(h.preferences.get(KEYS.MODULES.LITURGY.SCHEDULED_ITEMS)).toEqual([
      { id: "item", categoria: "cat" },
    ]);
    expect(h.preferences.get(KEYS.MODULES.LITURGY.SCHEDULED_MIGRATED)).toBe(true);
  });

  it("preserva tabelas vazias quando o marcador já foi salvo", async () => {
    h.preferences.set(KEYS.MODULES.LITURGY.SCHEDULED_MIGRATED, true);
    h.tables.set(DB_TABLE.SCHEDULED_CATEGORIES, []);
    h.tables.set(DB_TABLE.SCHEDULED_ITEMS, []);
    const { default: scheduled } = await import("../ScheduledStore");
    await scheduled.hydrate();
    expect(scheduled.categories()).toEqual([]);
    expect(scheduled.items()).toEqual([]);
    expect(h.put).not.toHaveBeenCalled();
  });

  it("não marca migração parcial e permite repetir a hidratação que falhou", async () => {
    h.failId = "item";
    const { default: scheduled } = await import("../ScheduledStore");
    await expect(scheduled.hydrate()).rejects.toThrow("quota");
    expect(h.preferences.has(KEYS.MODULES.LITURGY.SCHEDULED_MIGRATED)).toBe(false);
    h.failId = null;
    await scheduled.hydrate();
    expect(scheduled.categories()).toHaveLength(1);
    expect(scheduled.items()).toHaveLength(1);
    expect(h.preferences.get(KEYS.MODULES.LITURGY.SCHEDULED_MIGRATED)).toBe(true);
    expect(h.putMany).toHaveBeenCalledTimes(3);
  });

  it("uma falha ao persistir o marcador continua retentável", async () => {
    h.flush.mockImplementationOnce(() => {
      throw new Error("localStorage indisponível");
    });
    const { default: scheduled } = await import("../ScheduledStore");
    await expect(scheduled.hydrate()).rejects.toThrow("localStorage indisponível");
    await scheduled.hydrate();
    expect(h.flush).toHaveBeenCalledTimes(2);
    expect(h.putMany).toHaveBeenCalledTimes(2);
    expect(scheduled.items()).toHaveLength(1);
  });

  it("repete o lote que falhou mesmo se o cache desktop já mostrar o conteúdo", async () => {
    h.putMany
      .mockImplementationOnce(async (table, values) => {
        h.tables.set(table, values);
      })
      .mockImplementationOnce(async (table, values) => {
        h.tables.set(table, values);
        throw new Error("disco indisponível");
      });
    const { default: scheduled } = await import("../ScheduledStore");
    await expect(scheduled.hydrate()).rejects.toThrow("disco indisponível");
    expect(h.preferences.has(KEYS.MODULES.LITURGY.SCHEDULED_MIGRATED)).toBe(false);
    await scheduled.hydrate();
    expect(h.putMany).toHaveBeenCalledTimes(3);
    expect(h.putMany).toHaveBeenLastCalledWith(DB_TABLE.SCHEDULED_ITEMS, [
      { id: "item", categoria: "cat" },
    ]);
  });

  it("não congela uma migração parcial se falhar no segundo item e o app reiniciar", async () => {
    h.preferences.set(KEYS.MODULES.LITURGY.SCHEDULED_ITEMS, [
      { id: "primeiro", categoria: "cat" },
      { id: "segundo", categoria: "cat" },
    ]);
    h.failId = "segundo";
    let { default: scheduled } = await import("../ScheduledStore");
    await expect(scheduled.hydrate()).rejects.toThrow("quota");
    expect(h.preferences.has(KEYS.MODULES.LITURGY.SCHEDULED_MIGRATED)).toBe(false);
    h.failId = null;
    vi.resetModules();
    ({ default: scheduled } = await import("../ScheduledStore"));
    await scheduled.hydrate();
    expect(scheduled.items().map((item) => item.id)).toEqual(["primeiro", "segundo"]);
  });
});
