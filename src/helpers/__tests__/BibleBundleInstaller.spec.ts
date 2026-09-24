/**
 * BibleBundleInstaller.spec.ts — a Bíblia é instalada uma vez, sob demanda, e a
 * checagem de "já instalada" olha só o disco: cada requisição a mais na abertura
 * de uma tela bíblica é o que estourou a cota da API.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import JSZip from "jszip";

const { rows, seeded, events, generalBundle, fetchWithTimeout } = vi.hoisted(() => ({
  rows: new Map<string, unknown>(),
  seeded: [] as string[],
  events: [] as string[],
  generalBundle: { installed: false },
  fetchWithTimeout: vi.fn(),
}));

vi.mock("@/helpers/IndexedDB", () => ({
  default: {
    get: vi.fn(async (_table: string, id: string) => rows.get(id)),
    put: vi.fn(async (_table: string, value: { id: string }) => {
      events.push(`put:${value.id}`);
      rows.set(value.id, value);
    }),
  },
}));

vi.mock("@/helpers/Database", () => ({
  default: {
    seed: vi.fn(async (key: string) => {
      events.push(`seed:${key}`);
      seeded.push(key);
    }),
  },
}));

vi.mock("@/helpers/BundleInstaller", () => ({
  default: { hasBundleMarker: vi.fn(async () => generalBundle.installed) },
}));

vi.mock("@/helpers/Http", () => ({
  fetchWithTimeout,
  NET_TIMEOUT: { MEDIA: 60_000 },
}));

vi.mock("@/config/Api", () => ({
  API_URL: "https://api.test",
  API_TOKEN: "t",
  API_URL_FALLBACK: "",
  API_URL_FALLBACK_TOKEN: "",
}));

// A semântica de instalação (um capítulo por vez e marker por último) não
// depende do browser Worker; a ponte Worker é coberta separadamente.
vi.mock("@/helpers/BundleExtraction", async () => {
  const JSZip = (await import("jszip")).default;
  return {
    extractBundleEntries: async (
      buffer: ArrayBuffer,
      options: { onEntry: (entry: { key: string; data: unknown; current: number; total: number }) => unknown }
    ) => {
      const zip = await JSZip.loadAsync(buffer);
      const paths = Object.keys(zip.files).filter(
        (path) => !zip.files[path].dir && /^bible_\d+_\d+_\d+\.json$/.test(path.split("/").at(-1) || "")
      );
      for (let index = 0; index < paths.length; index++) {
        const path = paths[index];
        await options.onEntry({
          key: path.split("/").at(-1)!.replace(/\.json$/, ""),
          data: JSON.parse(await zip.files[path].async("text")),
          current: index + 1,
          total: paths.length,
        });
      }
    },
  };
});

import BibleBundleInstaller from "@/helpers/BibleBundleInstaller";

async function zipOf(files: Record<string, unknown>): Promise<ArrayBuffer> {
  const zip = new JSZip();
  for (const [name, data] of Object.entries(files)) zip.file(name, JSON.stringify(data));
  return zip.generateAsync({ type: "arraybuffer" });
}

function respondWith(buffer: ArrayBuffer) {
  fetchWithTimeout.mockResolvedValue(new Response(buffer, { status: 200 }));
}

beforeEach(() => {
  rows.clear();
  seeded.length = 0;
  events.length = 0;
  generalBundle.installed = false;
  fetchWithTimeout.mockReset();
});

describe("BibleBundleInstaller.isInstalled", () => {
  it("é falso num aparelho sem nada instalado", async () => {
    expect(await BibleBundleInstaller.isInstalled()).toBe(false);
  });

  it("é verdadeiro depois de instalar, sem tocar na rede", async () => {
    respondWith(await zipOf({ "bible_1_1_1.json": { v: 1 } }));
    await BibleBundleInstaller.install();
    fetchWithTimeout.mockClear();

    expect(await BibleBundleInstaller.isInstalled()).toBe(true);
    expect(fetchWithTimeout).not.toHaveBeenCalled();
  });

  it("reconhece o banco completo já instalado, que traz todos os capítulos", async () => {
    generalBundle.installed = true;
    expect(await BibleBundleInstaller.isInstalled()).toBe(true);
  });

  it("ignora um marcador de revisão antiga", async () => {
    rows.set(BibleBundleInstaller.markerKey, {
      id: BibleBundleInstaller.markerKey,
      data: { id: BibleBundleInstaller.markerKey, revision: 0 },
    });
    expect(await BibleBundleInstaller.isInstalled()).toBe(false);
  });
});

describe("BibleBundleInstaller.install", () => {
  it("grava só capítulos bíblicos, um a um, e o marcador por último", async () => {
    respondWith(
      await zipOf({
        "bible_1_1_1.json": { v: 1 },
        "bible_9_24_51.json": { v: 2 },
        "music_1.json": { id_music: 1 },
        "config.json": { version_number: 185 },
      })
    );

    await BibleBundleInstaller.install();

    expect([...seeded].sort()).toEqual(["bible_1_1_1", "bible_9_24_51"]);
    expect(events.at(-1)).toBe(`put:${BibleBundleInstaller.markerKey}`);
    expect(events.filter((e) => e.startsWith("seed:"))).toHaveLength(2);
  });

  it("baixa o ZIP uma única vez, da rota dedicada", async () => {
    respondWith(await zipOf({ "bible_1_1_1.json": { v: 1 } }));
    await BibleBundleInstaller.install();

    expect(fetchWithTimeout).toHaveBeenCalledTimes(1);
    expect(fetchWithTimeout.mock.calls[0][0]).toBe("https://api.test/db/bible-bundle");
  });

  it("recusa um ZIP sem capítulos e não grava o marcador", async () => {
    respondWith(await zipOf({ "music_1.json": { id_music: 1 } }));

    await expect(BibleBundleInstaller.install()).rejects.toThrow(/nenhum capítulo/);
    expect(await BibleBundleInstaller.isInstalled()).toBe(false);
  });

  it("não instala nada quando a rota responde erro", async () => {
    fetchWithTimeout.mockResolvedValue(new Response("nope", { status: 404 }));

    await expect(BibleBundleInstaller.install()).rejects.toThrow(/HTTP 404/);
    expect(seeded).toHaveLength(0);
    expect(await BibleBundleInstaller.isInstalled()).toBe(false);
  });

  it("cancelado no meio, deixa sem marcador para recomeçar na próxima abertura", async () => {
    respondWith(await zipOf({ "bible_1_1_1.json": { v: 1 }, "bible_1_1_2.json": { v: 2 } }));
    const controller = new AbortController();
    const { default: Database } = await import("@/helpers/Database");
    vi.mocked(Database.seed).mockImplementationOnce(async (key: string) => {
      seeded.push(key);
      controller.abort();
    });

    await expect(BibleBundleInstaller.install({ signal: controller.signal })).rejects.toBeDefined();
    expect(seeded).toHaveLength(1);
    expect(await BibleBundleInstaller.isInstalled()).toBe(false);
  });
});
