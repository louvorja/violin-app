import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  documents: [] as Array<{ id: string; name?: string }>,
  read: vi.fn(),
  write: vi.fn(),
  list: vi.fn(),
  legacy: vi.fn(),
  exists: false,
}));
vi.mock("@/helpers/Platform", () => ({
  default: { isDesktop: true, docs: { read: state.read, write: state.write, list: state.list } },
}));
vi.mock("@/helpers/IndexedDB", () => ({ default: { getAll: state.legacy } }));

beforeEach(() => {
  vi.resetModules();
  state.documents = [];
  state.exists = false;
  state.list.mockReset().mockImplementation(async () => (state.exists ? ["liturgies"] : []));
  state.legacy.mockReset().mockResolvedValue([{ id: "legado" }]);
  state.read.mockReset().mockImplementation(async () => structuredClone(state.documents));
  state.write.mockReset().mockImplementation(async (_collection, documents) => {
    state.exists = true;
    state.documents = structuredClone(documents);
  });
});

describe("migração desktop preserva exclusões", () => {
  it("não reimporta a coleção apagada no boot seguinte e conserva o backup", async () => {
    let { default: docs } = await import("../DocStore");
    expect(await docs.migrarDoIndexedDB(["liturgies"])).toBe(1);
    await docs.del("liturgies", "legado");
    expect(state.documents).toEqual([]);
    vi.resetModules();
    ({ default: docs } = await import("../DocStore"));
    expect(await docs.migrarDoIndexedDB(["liturgies"])).toBe(0);
    expect(state.documents).toEqual([]);
    expect(state.legacy).toHaveBeenCalledOnce();
  });

  it("preserva arquivo já existente vazio sem tentar importar legado", async () => {
    state.exists = true;
    const { default: docs } = await import("../DocStore");
    expect(await docs.migrarDoIndexedDB(["liturgies"])).toBe(0);
    expect(state.legacy).not.toHaveBeenCalled();
    expect(state.write).not.toHaveBeenCalled();
  });

  it("falha na listagem adia a migração e permite outra tentativa", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    state.list.mockRejectedValueOnce(new Error("IPC indisponível"));
    const { default: docs } = await import("../DocStore");
    expect(await docs.migrarDoIndexedDB(["liturgies"])).toBe(0);
    expect(state.legacy).not.toHaveBeenCalled();
    expect(await docs.migrarDoIndexedDB(["liturgies"])).toBe(1);
    expect(state.documents).toEqual([{ id: "legado" }]);
    warn.mockRestore();
  });

  it("uma limpeza enquanto lê o legado também impede reimportar a coleção", async () => {
    let finishLegacy!: (_rows: Array<{ id: string }>) => void;
    state.legacy.mockImplementationOnce(() => new Promise((resolve) => (finishLegacy = resolve)));
    const { default: docs } = await import("../DocStore");
    const migrating = docs.migrarDoIndexedDB(["liturgies"]);
    await vi.waitFor(() => expect(state.legacy).toHaveBeenCalledOnce());
    await docs.clear("liturgies");
    finishLegacy([{ id: "legado" }]);
    expect(await migrating).toBe(0);
    expect(state.documents).toEqual([]);
  });
});

describe("documentos desktop concorrentes", () => {
  it("envia migração em um único snapshot sem estados parcialmente preenchidos", async () => {
    const { default: docs } = await import("../DocStore");
    await docs.putMany("liturgies", [{ id: "primeiro" }, { id: "segundo" }]);
    expect(state.write).toHaveBeenCalledOnce();
    expect(state.documents).toEqual([{ id: "primeiro" }, { id: "segundo" }]);
  });
  it.each([false, true])("preserva duas criações simultâneas (cache=%s)", async (warm) => {
    const { default: docs } = await import("../DocStore");
    if (warm) await docs.getAll("liturgies");

    await Promise.all([
      docs.put("liturgies", { id: "culto-a" }),
      docs.put("liturgies", { id: "culto-b" }),
    ]);

    expect(state.documents).toEqual([{ id: "culto-a" }, { id: "culto-b" }]);
    expect(await docs.getAll("liturgies")).toEqual(state.documents);
  });

  it("não ressuscita documento excluído quando outro é salvo ao mesmo tempo", async () => {
    state.documents = [{ id: "antigo" }];
    const { default: docs } = await import("../DocStore");
    await docs.getAll("liturgies");

    await Promise.all([docs.del("liturgies", "antigo"), docs.put("liturgies", { id: "novo" })]);

    expect(state.documents).toEqual([{ id: "novo" }]);
  });

  it("envia a revisão seguinte ao main sem esperar o disco da anterior", async () => {
    const { default: docs } = await import("../DocStore");
    let finishFirst!: () => void;
    state.write.mockImplementationOnce(
      () => new Promise<void>((resolve) => (finishFirst = resolve))
    );
    const first = docs.put("liturgies", { id: "primeiro" });
    await vi.waitFor(() => expect(state.write).toHaveBeenCalledOnce());
    await docs.put("liturgies", { id: "segundo" });
    expect(state.documents).toEqual([{ id: "primeiro" }, { id: "segundo" }]);
    finishFirst();
    await first;
    expect(await docs.getAll("liturgies")).toEqual(state.documents);
  });

  it("não restaura cache antigo se limpar enquanto a primeira leitura está pendente", async () => {
    const { default: docs } = await import("../DocStore");
    let finishRead!: (_docs: Array<{ id: string }>) => void;
    state.read.mockImplementationOnce(() => new Promise((resolve) => (finishRead = resolve)));
    const reading = docs.getAll("liturgies");
    const clearing = docs.clear("liturgies");
    finishRead([{ id: "antigo" }]);
    await Promise.all([reading, clearing]);
    expect(await docs.getAll("liturgies")).toEqual([]);
    expect(state.documents).toEqual([]);
    expect(state.read).toHaveBeenCalledOnce();
  });
});
