import { beforeEach, describe, expect, it, vi } from "vitest";
import { DB_TABLE } from "@/constants/DbTables";

const ALL = Object.values(DB_TABLE);

// Simula a regra do IndexedDB: pedir versão menor que a do disco é VersionError,
// pedir maior roda o upgrade, e abrir sem versão usa a do disco (1 se não existe).
const disk = vi.hoisted(() => ({
  version: 0,
  stores: new Set<string>(),
  opened: [] as Array<number | undefined>,
  beforeOpen: null as null | (() => void),
}));

vi.mock("idb", () => ({
  openDB: vi.fn(
    async (
      _name: string,
      version: number | undefined,
      opts: { upgrade: (_db: unknown) => void }
    ) => {
      disk.opened.push(version);
      const hook = disk.beforeOpen;
      disk.beforeOpen = null;
      hook?.();
      if (version !== undefined && version < disk.version) {
        throw new DOMException("requested version is less than the existing", "VersionError");
      }
      const target = version ?? Math.max(disk.version, 1);
      const db = {
        version: target,
        objectStoreNames: { contains: (name: string) => disk.stores.has(name) },
        createObjectStore: (name: string) => disk.stores.add(name),
        close: vi.fn(),
        addEventListener: vi.fn(),
      };
      if (target > disk.version) {
        opts.upgrade(db);
        disk.version = target;
      }
      return db;
    }
  ),
}));

beforeEach(() => {
  disk.version = 0;
  disk.stores = new Set();
  disk.opened = [];
  disk.beforeOpen = null;
  vi.resetModules();
});

async function init(): Promise<void> {
  const idb = (await import("@/helpers/IndexedDB")).default;
  await idb.init();
}

describe("IndexedDB: abertura do banco", () => {
  it("abre um banco gravado numa versão mais nova sem pedir para apagá-lo", async () => {
    disk.version = 6;
    disk.stores = new Set(ALL);

    await init();

    expect(disk.opened).toEqual([undefined]);
    expect(disk.version).toBe(6);
  });

  it("cria a tabela que falta subindo uma versão a partir da do disco", async () => {
    disk.version = 6;
    disk.stores = new Set(ALL.filter((name) => name !== DB_TABLE.DEVICES));

    await init();

    expect(disk.opened).toEqual([undefined, 7]);
    expect(disk.version).toBe(7);
    expect(ALL.every((name) => disk.stores.has(name))).toBe(true);
  });

  it("cria todas as tabelas num banco novo", async () => {
    await init();

    expect(disk.version).toBe(1);
    expect(ALL.every((name) => disk.stores.has(name))).toBe(true);
  });

  it("reabre na versão do disco quando outra janela a subiu no meio", async () => {
    disk.version = 6;
    disk.stores = new Set(ALL.slice(1));
    disk.beforeOpen = () => {
      disk.beforeOpen = () => {
        disk.version = 8;
        disk.stores = new Set(ALL);
      };
    };

    await init();

    expect(disk.opened).toEqual([undefined, 7, undefined]);
    expect(disk.version).toBe(8);
  });
});
