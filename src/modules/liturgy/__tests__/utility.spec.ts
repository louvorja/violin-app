import { describe, expect, it } from "vitest";
import {
  cleanUtilityConfig,
  defaultUtilityConfig,
  utilitySpec,
  utilitySummary,
  visibleUtilityFields,
} from "../utility";
import {
  pendingModuleLaunches,
  requestModuleLaunch,
  takeModuleLaunch,
} from "@/helpers/ModuleLaunch";

const t = (key: string) =>
  ({
    "utility.until": "até",
    "utility.mode_up": "Progressiva",
    "utility.auto_start_short": "inicia sozinho",
  })[key] ?? key;

describe("Utilitário da liturgia", () => {
  it("Temporizador de Culto mostra hora ou duração conforme o 'Definir por'", () => {
    expect(visibleUtilityFields("timer_worship", { define_by: "end" })).toEqual([
      "mode",
      "define_by",
      "target",
    ]);
    expect(visibleUtilityFields("timer_worship", { define_by: "duration" })).toEqual([
      "mode",
      "define_by",
      "minutes",
    ]);
  });

  it("Cronômetro progressivo não pede tempo", () => {
    expect(visibleUtilityFields("stopwatch", { mode: "up" })).toEqual(["mode"]);
    expect(visibleUtilityFields("stopwatch", { mode: "down" })).toEqual(["mode", "minutes"]);
  });

  it("guarda só o que vale para a escolha atual", () => {
    expect(
      cleanUtilityConfig("timer_worship", {
        mode: "down",
        define_by: "duration",
        target: "10:45",
        minutes: 15.4,
      })
    ).toEqual({ mode: "down", define_by: "duration", minutes: 15 });
    expect(cleanUtilityConfig("timer", { mode: "down", target: "9:5" })).toEqual({ mode: "down" });
    expect(cleanUtilityConfig("clock", { mode: "down", target: "10:00" })).toEqual({});
    expect(cleanUtilityConfig("stopwatch", { mode: "down", minutes: 0 })).toEqual({ mode: "down" });
  });

  it("resumo da segunda linha", () => {
    expect(utilitySummary("timer_worship", { define_by: "end", target: "10:45" }, true, t)).toBe(
      "até 10:45 · inicia sozinho"
    );
    expect(utilitySummary("stopwatch", { mode: "down", minutes: 5 }, false, t)).toBe("5 min");
    // Relógio não conta tempo: o "inicia sozinho" não faz sentido nele.
    expect(utilitySummary("clock", {}, true, t)).toBe("");
  });

  it("padrões ao escolher o módulo", () => {
    expect(defaultUtilityConfig("timer_worship")).toEqual({
      mode: "down",
      define_by: "end",
      minutes: 30,
    });
    expect(defaultUtilityConfig("stopwatch")).toEqual({ mode: "down", minutes: 5 });
    expect(defaultUtilityConfig("draw")).toEqual({});
    expect(utilitySpec("desconhecido")).toBeUndefined();
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
});
