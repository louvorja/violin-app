import { describe, expect, it } from "vitest";
import { horarioDoTitulo } from "../titleTime";

describe("horário no título da liturgia", () => {
  it.each([
    ["08:30 - Louvor", "08:30"],
    ["8:30 Louvor", "08:30"],
    ["(00:00) Vigília", "00:00"],
    ["23:59 Encerramento", "23:59"],
    ["Louvor às 8:30", "08:30"],
    ["Louvor — horário: 8:30", "08:30"],
    ["Louvor 8h30", "08:30"],
    ["8h Abertura", "08:00"],
    ["Louvor às 8h", "08:00"],
    ["8h00 Abertura", "08:00"],
    ["08:30 Louvor às 8h30", "08:30"],
    ["08:30 Leitura João 3:16", "08:30"],
    ["08:30 Leitura João 3:16 e 4:10", "08:30"],
    ["08:30 Leitura João 3:16-4:10", "08:30"],
  ])("reconhece %s", (title, expected) => {
    expect(horarioDoTitulo(title)).toBe(expected);
  });

  it.each([
    "Leitura João 3:16",
    "João 08:30",
    "119:30 Louvor",
    "25:00 Louvor",
    "08:99 Louvor",
    "8:3 Louvor",
    "8h300 Louvor",
    "25h Louvor",
    "Culto 08/10/2026",
    "30 minutos de louvor",
    "Duração: 8h30",
    "Durante 8h",
    "Louvor em 8h30",
    "Louvor 8h",
    "08:30 Louvor / 09:00 Sermão",
    "08:30 Louvor e 09:00 Sermão",
    "08:30 Louvor às 9h",
    "2026-10-08T08:30",
    "Vídeo ABC08:30",
    "08:30:99 Louvor",
  ])("não adivinha hora em %s", (title) => {
    expect(horarioDoTitulo(title)).toBe("");
  });

  it("valida entradas de fronteira", () => {
    expect(horarioDoTitulo(null)).toBe("");
    expect(horarioDoTitulo(830)).toBe("");
  });
});
