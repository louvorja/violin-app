import { describe, expect, it, vi } from "vitest";
import { backgroundTaskLabel } from "../BackgroundTaskDetail";

describe("backgroundTaskLabel", () => {
  const messages: Record<string, string> = { "shell.background_tasks.app_update": "Atualização do app" };
  const te = (key: string) => key in messages;
  const t = vi.fn((key: string) => messages[key] ?? key);

  it("traduz o rótulo quando ele é uma chave de tradução", () => {
    expect(backgroundTaskLabel("shell.background_tasks.app_update", t, te)).toBe("Atualização do app");
  });

  it("mostra como está o que não é chave, como o título de um vídeo, sem passar por t()", () => {
    t.mockClear();
    const title = "TREINANDO os CANDIDATOS à PRESIDÊNCIA: Julio Balestrin é 100% SINCERO no Flow";
    expect(backgroundTaskLabel(title, t, te)).toBe(title);
    expect(t).not.toHaveBeenCalled();
  });

  it("um rótulo já traduzido também segue como texto", () => {
    t.mockClear();
    expect(backgroundTaskLabel("Atualização do app", t, te)).toBe("Atualização do app");
    expect(t).not.toHaveBeenCalled();
  });
});
