import { describe, expect, it } from "vitest";
import { agendaParaPersistir, lerHorario, prepararAgenda } from "../agenda";
import { LiturgyItemTypeEnum } from "@/enums/LiturgyItemTypeEnum";
import type { LiturgyItem } from "@/types/Liturgy";

const item = (id: string, extra: Partial<LiturgyItem> = {}): LiturgyItem => ({
  id,
  tipo: LiturgyItemTypeEnum.ANOTACAO,
  item: id,
  subitem: "",
  subtipo: "",
  duration: 5,
  cor: "#00004F",
  musica: -1,
  dir: "",
  dir_info: "E",
  url: "",
  escolha: false,
  has_instrumental_music: false,
  ...extra,
});

describe("horários da agenda", () => {
  it("preserva âncoras manuais e recalcula a continuação sem gravar a hora calculada", () => {
    const list = [
      item("primeiro", { time: "19:30", time_mode: "manual" }),
      item("automatico", { time_mode: "auto" }),
      item("outra-hora", { time: "20:00", time_mode: "manual" }),
      item("fim", { time_mode: "auto" }),
    ];
    expect(prepararAgenda(list).map((entry) => entry.time)).toEqual([
      "19:30",
      "19:35",
      "20:00",
      "20:05",
    ]);
    const saved = agendaParaPersistir(prepararAgenda(list));
    expect(saved.map((entry) => entry.time)).toEqual(["19:30", "", "20:00", ""]);
    saved[0].duration = 15;
    expect(prepararAgenda(saved).map((entry) => entry.time)).toEqual([
      "19:30",
      "19:45",
      "20:00",
      "20:05",
    ]);
    expect(list[1].time).toBeUndefined();
  });

  it("uma hora manual coincidente com a continuação continua manual", () => {
    const saved = agendaParaPersistir([
      item("inicio", { time: "08:00", time_mode: "manual" }),
      item("ancora", { time: "08:05", time_mode: "manual" }),
      item("automatico", { time_mode: "auto" }),
    ]);
    saved[0].duration = 10;
    expect(prepararAgenda(saved).map((entry) => entry.time)).toEqual(["08:00", "08:05", "08:10"]);
  });

  it("mantém horários legados inequívocos e converte a continuação em automático antes de editar", () => {
    const legacy = [
      item("bloco", { tipo: LiturgyItemTypeEnum.BLOCO, time: "08:00" }),
      item("a", { time: "08:00" }),
      item("b", { time: "08:05" }),
      item("ancora", { time: "09:00" }),
      item("c", { time: "09:05" }),
    ];
    const saved = agendaParaPersistir(legacy);
    expect(saved.map((entry) => entry.time_mode)).toEqual([
      "manual",
      "auto",
      "auto",
      "manual",
      "auto",
    ]);
    saved[1].duration = 15;
    expect(prepararAgenda(saved).map((entry) => entry.time)).toEqual([
      "08:00",
      "08:00",
      "08:15",
      "09:00",
      "09:05",
    ]);
    expect(prepararAgenda(JSON.parse(JSON.stringify(saved))).map((entry) => entry.time)).toEqual([
      "08:00",
      "08:00",
      "08:15",
      "09:00",
      "09:05",
    ]);
    expect(legacy[2].time).toBe("08:05");
  });

  it("preserva o primeiro horário legado solto e recalcula depois de reordenar", () => {
    const saved = agendaParaPersistir([
      item("inicio", { time: "18:00" }),
      item("curto", { time: "18:05", duration: 3 }),
      item("longo", { time: "18:08", duration: 10 }),
    ]);
    expect(prepararAgenda([saved[0], saved[2], saved[1]]).map((entry) => entry.time)).toEqual([
      "18:00",
      "18:05",
      "18:15",
    ]);
  });

  it("ignora hora manual em item vinculado ao bloco e deixa bloco sem hora continuar automaticamente", () => {
    const list = [
      item("bloco", { tipo: LiturgyItemTypeEnum.BLOCO, time: "23:58" }),
      item("filho", { blocoId: "bloco", time: "12:00", time_mode: "manual", duration: 5 }),
      item("bloco-sem-hora", { tipo: LiturgyItemTypeEnum.BLOCO }),
      item("fim", { time_mode: "auto" }),
    ];
    expect(prepararAgenda(list).map((entry) => entry.time)).toEqual([
      "23:58",
      "23:58",
      "00:03",
      "00:03",
    ]);
    const saved = agendaParaPersistir(list);
    expect(saved[1]).toMatchObject({ time: "", time_mode: "auto" });
    expect(saved[2]).toMatchObject({ time: "", time_mode: "auto" });
  });

  it("limpar a hora manual devolve o item à continuação automática", () => {
    const list = [
      item("inicio", { time: "07:00", time_mode: "manual" }),
      item("limpo", { time: "", time_mode: "auto" }),
    ];
    expect(prepararAgenda(list)[1].time).toBe("07:05");
    expect(agendaParaPersistir(list)[1].time).toBe("");
  });

  it("valida o horário recebido de arquivo", () => {
    expect(lerHorario("08:30:00")).toBe("08:30");
    for (const value of [null, {}, "25:00", "08:99", "x", "08:30<script>"]) {
      expect(lerHorario(value)).toBe("");
    }
  });
});
