/**
 * Forma de armazenamento dos dispositivos na tabela `devices`.
 *
 * A tabela guarda UM registro por dispositivo, com a chave sendo o `id`. O
 * banco é a lista de AUTORIZADOS: recusar/remover apaga a linha e pendente não
 * chega a ser gravado — a pendência vive só na memória (renderer + main) até o
 * operador aprovar.
 *
 * Era um registro agregado (`{ id: "authorized_devices", devices: [...] }`) que
 * um `_sync` reescrevia inteiro a cada mudança; este spec fixa o formato novo e
 * a migração do antigo (banco instalado por versão anterior e backup antigo).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Device } from "@/types/Device";

const estado = vi.hoisted(() => ({
  /** A tabela de verdade do teste: chave → linha, como o IndexedDB faria. */
  tabela: new Map<string, Record<string, unknown>>(),
  /** Ordem de inserção preservada pelo Map — não é a ordem de leitura. */
  salvosMain: [] as Device[][],
  ouvintes: {
    changed: [] as Array<(_list: Device[]) => void>,
    pending: [] as Array<(_d: Device) => void>,
  },
}));

vi.mock("@/helpers/Platform", () => ({
  default: {
    devices: {
      list: async () => [],
      save: async (lista: Device[]) => {
        estado.salvosMain.push(lista);
      },
      onChanged: (cb: (_list: Device[]) => void) => {
        if (!estado.ouvintes.changed.length) estado.ouvintes.changed.push(cb);
        return () => {};
      },
      onPending: (cb: (_d: Device) => void) => {
        if (!estado.ouvintes.pending.length) estado.ouvintes.pending.push(cb);
        return () => {};
      },
    },
  },
}));

vi.mock("@/helpers/IndexedDB", () => ({
  default: {
    getAll: async () => [...estado.tabela.values()],
    put: async (_table: string, row: Record<string, unknown>) => {
      estado.tabela.set(String(row.id), structuredClone(row));
    },
    del: async (_table: string, id: string) => {
      estado.tabela.delete(id);
    },
    putMany: async (
      _table: string,
      values: Array<Record<string, unknown>>,
      deleteIds: string[] = []
    ) => {
      for (const id of deleteIds) estado.tabela.delete(id);
      for (const row of values) estado.tabela.set(String(row.id), structuredClone(row));
    },
  },
}));

const { useDevices } = await import("@/composables/useDevices");

/** Põe um device na tabela como o IndexedDB faria (chave = id). */
function semear(dev: Device): void {
  estado.tabela.set(dev.id, { ...dev });
}

function device(extra: Partial<Device> = {}): Device {
  return {
    id: "d1",
    token: "t1",
    name: "iPhone",
    platform: "ios",
    registeredAt: "2026-01-01T00:00:00.000Z",
    permissions: ["music"],
    status: "approved",
    ...extra,
  };
}

/** Recria o composable lendo a tabela do teste (simula um boot do app). */
async function boot() {
  estado.salvosMain.length = 0;
  const d = useDevices();
  await d.loadDevices();
  return d;
}

/** Linhas da tabela, só com o que interessa para a asserção. */
const idsNaTabela = () => [...estado.tabela.keys()].sort();

beforeEach(() => {
  estado.tabela.clear();
  estado.salvosMain.length = 0;
});

describe("tabela devices — um registro por dispositivo", () => {
  it("lê as linhas e ordena do mais antigo para o mais novo", async () => {
    /* Inseridos fora de ordem de propósito: a leitura é por chave. */
    semear(device({ id: "novo", registeredAt: "2026-03-01T00:00:00.000Z" }));
    semear(device({ id: "velho", registeredAt: "2026-01-01T00:00:00.000Z" }));
    semear(device({ id: "meio", registeredAt: "2026-02-01T00:00:00.000Z" }));

    const d = await boot();

    expect(d.devices.value.map((x) => x.id)).toEqual(["velho", "meio", "novo"]);
  });

  it("envia a lista completa (pendentes incluídos) para o main", async () => {
    semear(device({ id: "d1" }));

    const d = await boot();
    d.pendingDevice.value = device({ id: "d2", status: "pending" });
    await d.updateDevice("d1", { name: "Sala" });

    /* O auth do main precisa reconhecer o par id+token de quem ainda não tem
       permissões para liberar `/api/ping`. */
    expect(estado.salvosMain.at(-1)?.map((x) => x.id)).toEqual(["d1"]);
  });
});

describe("tabela devices — o banco é a lista de autorizados", () => {
  it("adicionar grava só aquela linha, sem reescrever a tabela", async () => {
    semear(device({ id: "d1" }));
    const d = await boot();

    await d.addDevice({
      token: "t2",
      name: "Novo",
      platform: "android",
      permissions: ["chat"],
    });

    expect(idsNaTabela()).toHaveLength(2);
    expect(idsNaTabela()).toContain("d1");
    /* A linha nova é o próprio device, não um agregado. */
    const linhas = [...estado.tabela.values()];
    expect(linhas.every((row) => typeof row.token === "string")).toBe(true);
  });

  it("atualizar grava a linha do dispositivo editado", async () => {
    semear(device({ id: "d1", name: "Antigo" }));
    const d = await boot();

    await d.updateDevice("d1", { name: "Sala" });

    expect(estado.tabela.get("d1")).toMatchObject({ name: "Sala", status: "approved" });
  });

  it("remover apaga a linha", async () => {
    semear(device({ id: "d1" }));
    semear(device({ id: "d2" }));
    const d = await boot();

    await d.removeDevice("d1");

    expect(idsNaTabela()).toEqual(["d2"]);
  });

  it("pendente novo não é gravado em lugar nenhum", async () => {
    const d = await boot();

    /* É assim que um pendente entra na lista: pelo evento do main, não pelo IDB. */
    estado.ouvintes.pending[0]?.(device({ id: "d9", permissions: [], status: "pending" }));
    expect(d.pendingDevice.value?.id).toBe("d9");

    expect(estado.tabela.size).toBe(0);
  });

  it("aprovar o pendente é o que cria a linha", async () => {
    const d = await boot();
    estado.ouvintes.pending[0]?.(device({ id: "d9", permissions: [], status: "pending" }));

    await d.acceptPendingDevice("Recepção", ["music"]);

    expect(estado.tabela.get("d9")).toMatchObject({
      name: "Recepção",
      permissions: ["music"],
      status: "approved",
    });
  });

  it("recusar o pendente não deixa linha", async () => {
    const d = await boot();
    estado.ouvintes.pending[0]?.(device({ id: "d9", permissions: [], status: "pending" }));

    await d.rejectPendingDevice();

    expect(estado.tabela.size).toBe(0);
  });
});

describe("migração do formato antigo (registro agregado)", () => {
  /** O que uma versão anterior (ou um backup antigo) grava. */
  function gravaAgregado(devices: Device[]) {
    estado.tabela.set("authorized_devices", {
      id: "authorized_devices",
      devices: structuredClone(devices),
    });
  }

  it("expande o agregado em uma linha por dispositivo e apaga o registro antigo", async () => {
    gravaAgregado([
      device({ id: "d1", registeredAt: "2026-01-01T00:00:00.000Z" }),
      device({ id: "d2", registeredAt: "2026-02-01T00:00:00.000Z" }),
    ]);

    const d = await boot();

    expect(d.devices.value.map((x) => x.id)).toEqual(["d1", "d2"]);
    expect(idsNaTabela()).toEqual(["d1", "d2"]);
    expect(estado.tabela.has("authorized_devices")).toBe(false);
  });

  it("aparelho aprovado antes da permissão de atalhos a herda; o novo não", async () => {
    gravaAgregado([
      device({ id: "d1", permissions: ["music"] }),
      device({ id: "d2", permissions: ["liturgy", "chat"], registeredAt: "2026-01-02T00:00:00.000Z" }),
      device({ id: "d3", permissions: ["root"], registeredAt: "2026-01-03T00:00:00.000Z" }),
    ]);
    semear(device({ id: "d5", permissions: ["music"], registeredAt: "2026-01-05T00:00:00.000Z" }));

    const d = await boot();
    const perms = Object.fromEntries(d.devices.value.map((x) => [x.id, x.permissions]));

    expect(perms).toEqual({
      d1: ["music", "keyboard"],
      d2: ["liturgy", "chat", "keyboard"],
      d3: ["root"],
      d5: ["music"],
    });
    expect(estado.tabela.get("d1")?.permissions).toEqual(["music", "keyboard"]);
    expect(estado.salvosMain.at(-1)?.find((x) => x.id === "d2")?.permissions).toContain("keyboard");
  });

  it("não roda de novo na próxima leitura (idempotente)", async () => {
    gravaAgregado([device({ id: "d1" })]);
    await boot();
    const depoisDaPrimeira = idsNaTabela();

    const d = await boot();

    expect(d.devices.value.map((x) => x.id)).toEqual(["d1"]);
    expect(idsNaTabela()).toEqual(depoisDaPrimeira);
  });

  it("pendente que ficou no banco sai da tabela mas continua na memória", async () => {
    gravaAgregado([
      device({ id: "ok", permissions: ["music"] }),
      device({ id: "fila", permissions: [], status: "pending" }),
    ]);

    const d = await boot();

    /* A tabela fica só com autorizado; a memória mantém o pendente para a tela
       de aprovação abrir uma última vez. */
    expect(idsNaTabela()).toEqual(["ok"]);
    expect(d.devices.value.map((x) => x.id).sort()).toEqual(["fila", "ok"]);
    expect(d.pendingDevice.value?.id).toBe("fila");
  });

  it("agregado vazio (backup sem dispositivos) não deixa lixo na tabela", async () => {
    gravaAgregado([]);

    const d = await boot();

    expect(d.devices.value).toEqual([]);
    expect(estado.tabela.size).toBe(0);
  });
});
