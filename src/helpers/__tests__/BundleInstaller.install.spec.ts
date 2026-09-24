/**
 * BundleInstaller.install.spec.ts — instalar o banco completo custa um único
 * GET. A versão que vai no marcador sai do `config` que já está dentro do ZIP:
 * perguntar de novo à API era uma segunda requisição a cada instalação.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import JSZip from "jszip";

const { rows, fetchWithTimeout, seedBundleAtomic } = vi.hoisted(() => ({
  rows: new Map<string, { data?: Record<string, unknown> }>(),
  fetchWithTimeout: vi.fn(),
  seedBundleAtomic: vi.fn(),
}));

vi.mock("@/helpers/IndexedDB", () => ({
  default: {
    get: vi.fn(async (_table: string, id: string) => rows.get(id)),
    put: vi.fn(async (_table: string, value: { id: string; data?: Record<string, unknown> }) => {
      rows.set(value.id, value);
    }),
    clear: vi.fn(async () => {}),
  },
}));
vi.mock("@/helpers/Database", () => ({ default: { seedBundleAtomic, get: vi.fn() } }));
vi.mock("@/helpers/Dev", () => ({ default: { write: vi.fn(), log: vi.fn() } }));
vi.mock("@/helpers/Telemetry", () => ({
  default: { track: vi.fn(), histogram: vi.fn(), captureException: vi.fn() },
}));
vi.mock("@/helpers/Http", () => ({ fetchWithTimeout, NET_TIMEOUT: { MEDIA: 60_000 } }));
vi.mock("@/config/Api", () => ({
  API_URL: "https://api.test",
  API_TOKEN: "",
  API_URL_FALLBACK: "",
  API_URL_FALLBACK_TOKEN: "",
  API_URL_DB: "https://api.test/json_db",
  API_URL_DB_FALLBACK: "",
}));

// O contrato do instalador é testado sem Worker real; a ponte Worker tem sua
// própria suíte. Aqui o ZIP ainda é interpretado para preservar as variantes
// de config usadas pelos cenários abaixo.
vi.mock("@/helpers/BundleExtraction", async () => {
  const JSZip = (await import("jszip")).default;
  return {
    extractBundleEntries: async (
      buffer: ArrayBuffer,
      options: { onEntry: (entry: { key: string; data: unknown; current: number; total: number }) => unknown }
    ) => {
      const zip = await JSZip.loadAsync(buffer);
      const paths = Object.keys(zip.files).filter(
        (path) => !zip.files[path].dir && path.endsWith(".json") && !path.endsWith("_manifest.json")
      );
      for (let index = 0; index < paths.length; index++) {
        const path = paths[index];
        const parts = path.split("/");
        const base = parts.at(-1)!.replace(/\.json$/, "");
        const lang = parts.indexOf("lang");
        await options.onEntry({
          key: lang >= 0 && parts[lang + 1] ? `${parts[lang + 1]}_${base}` : base,
          data: JSON.parse(await zip.files[path].async("text")),
          current: index + 1,
          total: paths.length,
        });
      }
    },
  };
});

import BundleInstaller from "@/helpers/BundleInstaller";

async function bundleWith(config: unknown): Promise<ArrayBuffer> {
  const zip = new JSZip();
  if (config !== undefined) zip.file("config.json", JSON.stringify(config));
  zip.file("music_1.json", JSON.stringify({ id_music: 1 }));
  return zip.generateAsync({ type: "arraybuffer" });
}

beforeEach(() => {
  rows.clear();
  fetchWithTimeout.mockReset();
  seedBundleAtomic.mockReset();
  seedBundleAtomic.mockImplementation(async (datasets, marker, options) => {
    options?.signal?.throwIfAborted();
    rows.set(marker.id, marker);
    options?.onProgress?.(datasets.size, datasets.size, [...datasets.keys()].at(-1));
  });
});

describe("BundleInstaller.install", () => {
  it("faz uma única requisição e grava a versão que veio no próprio ZIP", async () => {
    fetchWithTimeout.mockResolvedValue(
      new Response(await bundleWith({ version_number: 190 }), { status: 200 })
    );

    await BundleInstaller.install({});

    expect(fetchWithTimeout).toHaveBeenCalledTimes(1);
    expect(fetchWithTimeout.mock.calls[0][0]).toBe("https://api.test/db/bundle");
    expect(rows.get("__bundle_marker__")?.data).toMatchObject({ version_number: 190 });
    expect(await BundleInstaller.hasBundleMarker()).toBe(true);
  });

  it("só pergunta à API quando o ZIP não traz versão legível", async () => {
    fetchWithTimeout
      .mockResolvedValueOnce(
        new Response(await bundleWith({ note: "sem versão" }), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ version_number: 191 }), { status: 200 })
      );

    await BundleInstaller.install({});

    expect(fetchWithTimeout).toHaveBeenCalledTimes(2);
    expect(rows.get("__bundle_marker__")?.data).toMatchObject({ version_number: 191 });
  });

  it("usa a versão informada e não consulta nada além do ZIP", async () => {
    fetchWithTimeout.mockResolvedValue(
      new Response(await bundleWith({ version_number: 190 }), { status: 200 })
    );

    await BundleInstaller.install({ version: 200 });

    expect(fetchWithTimeout).toHaveBeenCalledTimes(1);
    expect(rows.get("__bundle_marker__")?.data).toMatchObject({ version_number: 200 });
  });

  it("recusa um ZIP sem config e não grava o marcador", async () => {
    fetchWithTimeout.mockResolvedValue(new Response(await bundleWith(undefined), { status: 200 }));

    await expect(BundleInstaller.install({})).rejects.toThrow(/configuração do banco ausente/);
    expect(await BundleInstaller.hasBundleMarker()).toBe(false);
    expect(seedBundleAtomic).not.toHaveBeenCalled();
  });

  it("mantém o marcador anterior se a publicação falha", async () => {
    rows.set("__bundle_marker__", { data: { version_number: 180 } });
    fetchWithTimeout.mockResolvedValue(
      new Response(await bundleWith({ version_number: 190 }), { status: 200 })
    );
    seedBundleAtomic.mockRejectedValueOnce(new Error("disk full"));

    await expect(BundleInstaller.install({})).rejects.toThrow("disk full");
    expect(rows.get("__bundle_marker__")?.data).toMatchObject({ version_number: 180 });
  });

  it("aborta antes de publicar e mantém o marcador anterior", async () => {
    const controller = new AbortController();
    rows.set("__bundle_marker__", { data: { version_number: 180 } });
    fetchWithTimeout.mockResolvedValue(
      new Response(await bundleWith({ version_number: 190 }), { status: 200 })
    );
    controller.abort(new Error("cancelado"));

    await expect(BundleInstaller.install({ signal: controller.signal })).rejects.toThrow(
      "cancelado"
    );
    expect(seedBundleAtomic).not.toHaveBeenCalled();
    expect(rows.get("__bundle_marker__")?.data).toMatchObject({ version_number: 180 });
  });

  it("emite o último progresso após publicar", async () => {
    fetchWithTimeout.mockResolvedValue(
      new Response(await bundleWith({ version_number: 190 }), { status: 200 })
    );
    const progress = vi.fn();

    await BundleInstaller.install({ onProgress: progress });

    expect(progress).toHaveBeenCalledWith(
      expect.objectContaining({ phase: "inject", current: 2, total: 2 })
    );
    expect(rows.get("__bundle_marker__")?.data).toMatchObject({ version_number: 190 });
  });
});
