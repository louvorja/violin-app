/**
 * BundleInstaller.marker.spec.ts — "o banco completo foi instalado?" só se
 * responde pelo marcador gravado ao fim da instalação. O dataset `config` em
 * cache não serve de prova: a web o guarda em toda sessão sem nunca instalar
 * bundle, e tratá-lo como instalação fazia a Bíblia nunca ser baixada.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { rows } = vi.hoisted(() => ({ rows: new Map<string, unknown>() }));

vi.mock("@/helpers/IndexedDB", () => ({
  default: { get: vi.fn(async (_table: string, id: string) => rows.get(id)) },
}));
vi.mock("@/helpers/Database", () => ({ default: {} }));
vi.mock("@/helpers/Dev", () => ({ default: { log: vi.fn() } }));
vi.mock("@/helpers/Telemetry", () => ({ default: { track: vi.fn() } }));
vi.mock("@/helpers/Http", () => ({ fetchWithTimeout: vi.fn(), NET_TIMEOUT: { MEDIA: 60_000 } }));
vi.mock("@/config/Api", () => ({
  API_URL: "https://api.test",
  API_TOKEN: "",
  API_URL_FALLBACK: "",
  API_URL_FALLBACK_TOKEN: "",
  API_URL_DB: "https://api.test/json_db",
  API_URL_DB_FALLBACK: "",
}));

import BundleInstaller from "@/helpers/BundleInstaller";

beforeEach(() => rows.clear());

describe("BundleInstaller.hasBundleMarker", () => {
  it("é falso num aparelho que só tem o config em cache", async () => {
    rows.set("config", { id: "config", data: { version_number: 185 } });

    expect(await BundleInstaller.hasBundleMarker()).toBe(false);
    // O acessor antigo aceita o config como instalação: é a razão deste teste.
    expect(await BundleInstaller.getInstalledBundleVersion()).toBe(185);
  });

  it("é verdadeiro quando o marcador de instalação concluída existe", async () => {
    rows.set("__bundle_marker__", { id: "__bundle_marker__", data: { version_number: 185 } });

    expect(await BundleInstaller.hasBundleMarker()).toBe(true);
  });

  it("é falso sem nada gravado", async () => {
    expect(await BundleInstaller.hasBundleMarker()).toBe(false);
  });
});
