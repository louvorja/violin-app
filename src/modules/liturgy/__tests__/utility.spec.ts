import { describe, expect, it } from "vitest";
import {
  cleanUtilityConfig,
  defaultUtilityConfig,
  utilitySpec,
  utilitySummary,
  visibleUtilityFields,
} from "../utility";
import {
  launchBoolean,
  launchNumber,
  launchString,
  pendingModuleLaunches,
  requestModuleLaunch,
  takeModuleLaunch,
} from "@/helpers/ModuleLaunch";

const t = (key: string) =>
  ({
    "utility.until": "até",
    "utility.mode_up": "Progressiva",
    "utility.auto_start_short": "inicia sozinho",
    "utility.summary_no_opening": "sem abertura",
    "utility.summary_names": "nomes",
    "utility.summary_counter_start": "começa em",
  })[key] ?? key;

const keys = (moduleId: string, config: Record<string, unknown>) =>
  visibleUtilityFields(moduleId, config).map((f) => f.key);

describe("Utilitário da liturgia — campos", () => {
  it("Temporizador de Culto: hora ou duração, e o áudio só com o aviso ligado", () => {
    const base = defaultUtilityConfig("timer_worship");
    expect(keys("timer_worship", base)).toEqual([
      "mode",
      "define_by",
      "target",
      "second_line",
      "warning",
      "overtime",
      "sound_start",
      "sound_start_file",
      "sound_five",
      "sound_five_file",
      "sound_one",
      "sound_one_file",
    ]);
    const custom = { ...base, define_by: "duration", sound_start: false };
    const visible = keys("timer_worship", custom);
    expect(visible).toContain("minutes");
    expect(visible).not.toContain("target");
    expect(visible).toContain("sound_start");
    expect(visible).not.toContain("sound_start_file");
  });

  it("Sorteio mostra faixa ou nomes conforme o modo", () => {
    expect(keys("draw", { draw_mode: "number" })).toEqual([
      "draw_mode",
      "range_min",
      "range_max",
      "clear_history",
    ]);
    expect(keys("draw", { draw_mode: "names" })).toEqual(["draw_mode", "names", "clear_history"]);
  });

  it("Cronômetro progressivo não pede tempo", () => {
    expect(keys("stopwatch", { mode: "up" })).not.toContain("minutes");
    expect(keys("stopwatch", { mode: "down" })).toContain("minutes");
  });
});

describe("Utilitário da liturgia — limpeza", () => {
  it("guarda só o que vale, com cada valor conferido", () => {
    expect(
      cleanUtilityConfig("timer_worship", {
        mode: "down",
        define_by: "duration",
        target: "10:45",
        minutes: 15.4,
        warning: "120",
        overtime: false,
        sound_start: false,
        sound_start_file: { libraryId: "x", name: "X" },
        sound_five: true,
        sound_five_file: { libraryId: "lit-5", name: "5 min" },
        sound_one: true,
        sound_one_file: null,
        lixo: 1,
      })
    ).toEqual({
      mode: "down",
      define_by: "duration",
      minutes: 15,
      warning: "120",
      overtime: false,
      sound_start: false,
      sound_five: true,
      sound_five_file: { libraryId: "lit-5", name: "5 min" },
      sound_one: true,
      sound_one_file: null,
    });
  });

  it("opção que não existe, hora mal escrita e número fora do limite", () => {
    expect(cleanUtilityConfig("timer", { mode: "lado", target: "9:5", warning: "7" })).toEqual({});
    expect(cleanUtilityConfig("stopwatch", { mode: "down", minutes: 99999 })).toEqual({
      mode: "down",
      minutes: 1440,
    });
  });

  it("nomes: um por linha, sem vazios", () => {
    expect(
      cleanUtilityConfig("draw", { draw_mode: "names", names: [" Ana ", "", "João"] })
    ).toEqual({ draw_mode: "names", names: ["Ana", "João"] });
  });
});

describe("Utilitário da liturgia — resumo", () => {
  it("diz o que muda em relação ao normal", () => {
    expect(
      utilitySummary(
        "timer_worship",
        { define_by: "end", target: "10:45", sound_start: false },
        true,
        t
      )
    ).toBe("até 10:45 · sem abertura · inicia sozinho");
    expect(utilitySummary("stopwatch", { mode: "down", minutes: 5 }, false, t)).toBe("5 min");
    expect(
      utilitySummary("draw", { draw_mode: "number", range_min: 1, range_max: 50 }, false, t)
    ).toBe("1–50");
    expect(utilitySummary("draw", { draw_mode: "names", names: ["a", "b"] }, false, t)).toBe(
      "2 nomes"
    );
    expect(utilitySummary("counter", { start: 10 }, false, t)).toBe("começa em 10");
    expect(utilitySummary("clock", { hour_cycle: "12h" }, true, t)).toBe("12 h");
  });

  it("módulo desconhecido não existe", () => {
    expect(utilitySpec("desconhecido")).toBeUndefined();
    expect(defaultUtilityConfig("desconhecido")).toEqual({});
  });
});

describe("ModuleLaunch", () => {
  it("vale o pedido mais recente de cada módulo e cada um é consumido uma vez", () => {
    pendingModuleLaunches.value = [];
    requestModuleLaunch({ module: "timer", config: { target: "10:00" }, autoStart: false });
    requestModuleLaunch({ module: "stopwatch", config: {}, autoStart: true });
    requestModuleLaunch({ module: "timer", config: { target: "11:00" }, autoStart: true });
    expect(takeModuleLaunch("timer")).toEqual({
      module: "timer",
      config: { target: "11:00" },
      autoStart: true,
    });
    expect(takeModuleLaunch("timer")).toBeUndefined();
    expect(takeModuleLaunch("stopwatch")?.autoStart).toBe(true);
    expect(pendingModuleLaunches.value).toEqual([]);
  });

  it("leitores tolerantes devolvem undefined para valor do tipo errado", () => {
    const c = { a: "x", b: "", n: "12", z: "abc", y: true, w: 0 };
    expect(launchString(c, "a")).toBe("x");
    expect(launchString(c, "b")).toBeUndefined();
    expect(launchNumber(c, "n")).toBe(12);
    expect(launchNumber(c, "z")).toBeUndefined();
    expect(launchNumber(c, "w")).toBe(0);
    expect(launchBoolean(c, "y")).toBe(true);
    expect(launchBoolean(c, "a")).toBeUndefined();
  });
});
