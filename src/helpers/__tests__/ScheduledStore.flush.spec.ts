import { beforeEach, describe, expect, it, vi } from "vitest";
import { DB_TABLE } from "@/constants/DbTables";

const docs = vi.hoisted(() => ({ getAll: vi.fn(), put: vi.fn(), del: vi.fn() }));
vi.mock("@/helpers/DocStore", () => ({ default: docs }));
vi.mock("@/helpers/UserData", () => ({
  default: { get: () => [], set: vi.fn(), flushPendingWebSave: vi.fn() },
}));

beforeEach(() => {
  vi.resetModules();
  docs.getAll
    .mockReset()
    .mockImplementation(async (table) =>
      table === DB_TABLE.SCHEDULED_CATEGORIES
        ? [{ id: "culto", nome: "Culto" }]
        : [{ id: "aviso", categoria: "culto" }]
    );
  docs.put.mockReset().mockResolvedValue(undefined);
  docs.del.mockReset().mockResolvedValue(undefined);
});

describe("flush dos itens agendados antes da atualização PWA", () => {
  it("aguarda a exclusão dos itens mesmo quando a categoria já terminou de excluir", async () => {
    const { default: scheduled } = await import("../ScheduledStore");
    await scheduled.hydrate();
    let finishCategory!: () => void;
    let finishItem!: () => void;
    docs.del
      .mockImplementationOnce(() => new Promise<void>((resolve) => (finishCategory = resolve)))
      .mockImplementationOnce(() => new Promise<void>((resolve) => (finishItem = resolve)));
    const deleting = scheduled.deleteCategory("culto");
    let flushed = false;
    const flushing = scheduled.flush().then(() => (flushed = true));
    finishCategory();
    await vi.waitFor(() => expect(docs.del).toHaveBeenCalledTimes(2));
    expect(flushed).toBe(false);
    finishItem();
    await Promise.all([deleting, flushing]);
    expect(flushed).toBe(true);
  });

  it("propaga falha ao salvar sem criar outra rejeição não tratada no rastreamento", async () => {
    const { default: scheduled } = await import("../ScheduledStore");
    await scheduled.hydrate();
    let rejectWrite!: (_error: Error) => void;
    docs.put.mockImplementationOnce(
      () => new Promise<void>((_resolve, reject) => (rejectWrite = reject))
    );
    const saved = expect(scheduled.saveCategory({ id: "novo", nome: "Novo" })).rejects.toThrow(
      "quota"
    );
    const flushed = expect(scheduled.flush()).rejects.toThrow("quota");
    rejectWrite(new Error("quota"));
    await Promise.all([saved, flushed]);
  });

  it("retenta uma falha anterior ao flush e continua bloqueando se o armazenamento falhar", async () => {
    const { default: scheduled } = await import("../ScheduledStore");
    await scheduled.hydrate();
    docs.put.mockRejectedValue(new Error("quota"));
    await expect(scheduled.saveItem({ id: "novo", nome: "Aviso" })).rejects.toThrow("quota");
    await expect(scheduled.flush()).rejects.toThrow("quota");
    expect(docs.put).toHaveBeenCalledTimes(2);
    docs.put.mockResolvedValue(undefined);
    await scheduled.flush();
    expect(docs.put).toHaveBeenCalledTimes(3);
    expect(docs.put).toHaveBeenLastCalledWith(DB_TABLE.SCHEDULED_ITEMS, {
      id: "novo",
      nome: "Aviso",
    });
    await scheduled.flush();
    expect(docs.put).toHaveBeenCalledTimes(3);
  });

  it("uma edição mais recente substitui o retry antigo do mesmo documento", async () => {
    const { default: scheduled } = await import("../ScheduledStore");
    await scheduled.hydrate();
    docs.put.mockRejectedValueOnce(new Error("quota"));
    await expect(scheduled.saveItem({ id: "novo", nome: "Primeiro" })).rejects.toThrow("quota");
    await scheduled.saveItem({ id: "novo", nome: "Último" });
    await scheduled.flush();
    expect(docs.put).toHaveBeenCalledTimes(2);
    expect(docs.put).toHaveBeenLastCalledWith(DB_TABLE.SCHEDULED_ITEMS, {
      id: "novo",
      nome: "Último",
    });
  });
});
