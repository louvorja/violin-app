import { describe, expect, it, vi } from "vitest";
import { readdirSync, existsSync, readFileSync } from "node:fs";
import { createI18n } from "vue-i18n";

vi.mock("@/helpers/AppData", () => ({ default: { get: vi.fn(), set: vi.fn() } }));
vi.mock("@/helpers/UserData", () => ({ default: { get: vi.fn(), set: vi.fn(), setIfNull: vi.fn() } }));
vi.mock("@/helpers/Dev", () => ({ default: { write: vi.fn() } }));
vi.mock("@/helpers/Telemetry", () => ({ default: { captureException: vi.fn(), track: vi.fn() } }));
vi.mock("@/modules/BaseModule", () => ({ default: class {} }));
vi.mock("@/config/modules", () => ({ getAllModules: () => [] }));
vi.mock("@/config/modules/titles", () => ({ moduleTitleFallback: () => "" }));

import ModuleManager from "@/helpers/ModuleManager";

/**
 * As traduções dos módulos entram só quando o módulo abre, por um glob cujas
 * chaves são caminhos relativos ao ModuleManager. Uma busca com outro formato de
 * caminho não achava o carregador e desistia em silêncio: o módulo abria com as
 * chaves cruas (`modules.<id>.title`) na tela, sem erro no console.
 */
const modules = readdirSync("src/modules", { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(`src/modules/${d.name}/lang/pt.json`))
  .map((d) => d.name);

describe("ModuleManager.ensureTranslations", () => {
  it("há módulos com tradução para conferir", () => {
    expect(modules.length).toBeGreaterThan(30);
  });

  it.each(modules)("%s: carrega pt e es sob modules.<id>", async (id) => {
    const i18n = createI18n({
      legacy: false,
      locale: "pt",
      fallbackLocale: "pt",
      messages: { pt: {}, es: {} },
      missingWarn: false,
      fallbackWarn: false,
    });
    ModuleManager.bindI18n(i18n);
    await ModuleManager.ensureTranslations(id);

    for (const locale of ["pt", "es"] as const) {
      const file = `src/modules/${id}/lang/${locale}.json`;
      if (!existsSync(file)) continue;
      const first = Object.keys(JSON.parse(readFileSync(file, "utf8")))[0];
      expect(i18n.global.te(`modules.${id}.${first}`, locale), `${id}/${locale}: ${first}`).toBe(true);
    }
  });
});
