import { describe, expect, it, vi } from "vitest";
import { ModuleEnum } from "@/enums/ModuleEnum";
import { contextualPages } from "../manifest";
import {
  RIBBON_ACTION,
  runRibbonAction,
  type RibbonAction,
  type RibbonActionHandlers,
} from "../ribbonActions";

/**
 * Todo botão da guia contextual tem de chegar a uma ação que a tela trata.
 *
 * "Tocar aleatório" saía do manifesto como `background_sound_play_random` e a
 * tela esperava `random`: o clique não fazia nada, sem erro no console.
 */
function handlers(): RibbonActionHandlers {
  return Object.fromEntries(
    Object.values(RIBBON_ACTION).map((action) => [action, vi.fn()])
  ) as unknown as RibbonActionHandlers;
}

/** O que a RibbonBar entrega ao módulo: o `action` do botão sem o prefixo `<módulo>_`. */
function sentByRibbon(action: string): string {
  const prefix = `${ModuleEnum.BACKGROUND_SOUND}_`;
  expect(action.startsWith(prefix)).toBe(true);
  return action.slice(prefix.length);
}

const buttonActions = contextualPages
  .flatMap((page) => page.groups ?? [])
  .flatMap((group) => group.buttons ?? [])
  .map((button) => button.action)
  .filter((action): action is string => typeof action === "string");

describe("guia contextual do Som de Fundo", () => {
  it("tem os botões de tocar, parar, parar imediatamente e tocar aleatório", () => {
    expect(buttonActions.map(sentByRibbon)).toEqual(
      expect.arrayContaining(["play", "stop", "stop_immediately", "play_random"])
    );
  });

  it.each(buttonActions)("o botão %s chega a um tratador da tela", (action) => {
    const h = handlers();
    const sent = sentByRibbon(action);

    expect(runRibbonAction(sent, h)).toBe(true);

    expect(h[sent as RibbonAction]).toHaveBeenCalledTimes(1);
    const called = Object.values(h).filter((fn) => vi.mocked(fn).mock.calls.length > 0);
    expect(called).toHaveLength(1);
  });

  it("ignora ação que não é do módulo, inclusive nome herdado de Object", () => {
    const h = handlers();

    expect(runRibbonAction("random", h)).toBe(false);
    expect(runRibbonAction("toString", h)).toBe(false);
    expect(runRibbonAction(undefined, h)).toBe(false);

    for (const fn of Object.values(h)) expect(fn).not.toHaveBeenCalled();
  });
});
