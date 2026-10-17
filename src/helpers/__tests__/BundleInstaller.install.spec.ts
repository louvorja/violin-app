/**
 * BundleInstaller.install.spec.ts — instalar o banco completo custa um único
 * GET. A versão que vai no marcador sai do `config` que já está dentro do ZIP:
 * perguntar de novo à API era uma segunda requisição a cada instalação.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { catalogFiles, zipWithManifest, useTestBundleWorker } from "./fixtures/bundle";

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
  apiTokenHeaders: (token: string) => (token ? { "Api-Token": token } : {}),
}));

// O contrato do instalador é testado sem Worker real; a ponte Worker tem sua
// própria suíte. Aqui o ZIP ainda é interpretado para preservar as variantes
// de config usadas pelos cenários abaixo.

import BundleInstaller from "@/helpers/BundleInstaller";

async function bundleWith(config: unknown): Promise<ArrayBuffer> {
  const files: Record<string, unknown> = {
    ...catalogFiles(),
    "music_1.json": { id_music: 1 },
    "bible_1_1_1.json": { 1: "Texto" },
  };
  if (config !== undefined) files["config.json"] = config;
  return zipWithManifest(files, "full");
}

afterEach(() => vi.unstubAllGlobals());

beforeEach(() => {
  useTestBundleWorker();
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

  it("recusa versão ilegível sem rotular dados com uma versão obtida depois", async () => {
    fetchWithTimeout
      .mockResolvedValueOnce(
        new Response(await bundleWith({ note: "sem versão" }), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ version_number: 191 }), { status: 200 })
      );

    await expect(BundleInstaller.install({})).rejects.toThrow(/versão ausente/);
    expect(fetchWithTimeout).toHaveBeenCalledTimes(1);
    expect(seedBundleAtomic).not.toHaveBeenCalled();
  });

  it("recusa versão informada que não corresponde ao conteúdo do ZIP", async () => {
    fetchWithTimeout.mockResolvedValue(
      new Response(await bundleWith({ version_number: 190 }), { status: 200 })
    );

    await expect(BundleInstaller.install({ version: 200 })).rejects.toThrow(/versão diferente/);
    expect(fetchWithTimeout).toHaveBeenCalledTimes(1);
    expect(seedBundleAtomic).not.toHaveBeenCalled();
  });

  it("recusa um ZIP sem config e não grava o marcador", async () => {
    fetchWithTimeout.mockResolvedValue(new Response(await bundleWith(undefined), { status: 200 }));

    await expect(BundleInstaller.install({})).rejects.toThrow(/incompleto/);
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
      expect.objectContaining({ phase: "inject", current: 13, total: 13 })
    );
    expect(rows.get("__bundle_marker__")?.data).toMatchObject({ version_number: 190 });
  });
});

it("instala o catálogo menor com cache revalidado e marcador independente", async () => {
  fetchWithTimeout.mockResolvedValue(
    new Response(
      await zipWithManifest(
        { ...catalogFiles(), "config.json": { version_number: 185 } },
        "catalog"
      )
    )
  );
  await BundleInstaller.install({ catalogOnly: true });
  expect(fetchWithTimeout).toHaveBeenCalledWith(
    "https://api.test/db/catalog-bundle",
    expect.objectContaining({ cache: "no-store" })
  );
  expect(await BundleInstaller.hasBundleMarker()).toBe(true);
  expect(await BundleInstaller.hasBundleMarker("full")).toBe(false);
});

it("atualizar só catálogo preserva o reconhecimento de capítulos completos já validados", async () => {
  rows.set("__bundle_marker__", {
    data: { kind: "full", validation_revision: 1, version_number: 185 },
  });
  fetchWithTimeout.mockResolvedValue(
    new Response(
      await zipWithManifest(
        { ...catalogFiles(), "config.json": { version_number: 186 } },
        "catalog"
      )
    )
  );
  await BundleInstaller.install({ catalogOnly: true });
  expect(await BundleInstaller.hasBundleMarker("full")).toBe(true);
});
