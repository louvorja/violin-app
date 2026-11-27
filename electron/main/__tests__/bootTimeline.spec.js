// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createBootTimeline } = require("../bootTimeline.js");

const osInfo = { uptime: () => 5400.4, freemem: () => 3 * 1_073_741_824 };

function timeline(processInfo, start = 1_000_000) {
  let clock = start;
  const boot = createBootTimeline({ processInfo, osInfo, now: () => clock });
  return { boot, advance: (ms) => (clock += ms) };
}

describe("marcos da abertura do processo principal", () => {
  it("conta desde a criação do processo, não desde o início do script", () => {
    const { boot, advance } = timeline({ getCreationTime: () => 1_000_000 - 2500.6 });
    boot.mark("script_start");
    advance(700);
    boot.mark("app_ready");
    expect(boot.take()).toEqual({
      origin: 997_499,
      origin_source: "process",
      marks: { script_start: 2501, app_ready: 3201 },
      system_uptime_s: 5400,
      system_free_memory_mb: 3072,
    });
  });

  it("recriar a janela não reescreve o marco da abertura", () => {
    const { boot, advance } = timeline({ getCreationTime: () => 999_000 });
    advance(100);
    boot.mark("window_created");
    advance(60_000);
    boot.mark("window_created");
    expect(boot.take().marks).toEqual({ window_created: 1100 });
  });

  it("entrega uma vez só: recarregar a janela não repete a medição", () => {
    const { boot } = timeline({ getCreationTime: () => 999_000 });
    expect(boot.take()).not.toBeNull();
    expect(boot.take()).toBeNull();
  });

  it.each([
    ["ausente", {}],
    ["nula", { getCreationTime: () => null }],
    ["no futuro", { getCreationTime: () => 1_000_500 }],
    ["de antes de o relógio ser acertado", { getCreationTime: () => 1_000_000 - 3_600_000 }],
    ["com erro", { getCreationTime: () => { throw new Error("unsupported"); } }],
  ])("sem criação do processo confiável (%s) conta do início do script", (_caso, processInfo) => {
    const { boot, advance } = timeline(processInfo);
    advance(40);
    boot.mark("script_start");
    expect(boot.take()).toMatchObject({
      origin: 1_000_000,
      origin_source: "script",
      marks: { script_start: 40 },
    });
  });
});
