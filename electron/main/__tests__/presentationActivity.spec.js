// @vitest-environment node
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { createPresentationActivity } = require("../presentationActivity.js");

describe("presentationActivity", () => {
  it("mantém o estado ativo enquanto qualquer fonte de apresentação existe", () => {
    const activity = createPresentationActivity();
    activity.setSource("projection_window", true);
    activity.setSource("media_playback", true);
    activity.setSource("projection_window", false);

    expect(activity.isActive()).toBe(true);
    expect(activity.snapshot()).toEqual({ active: true, sources: ["media_playback"] });

    activity.setSource("media_playback", false);
    expect(activity.snapshot()).toEqual({ active: false, sources: [] });
  });

  it("permite atualização idempotente sem acumular fontes", () => {
    const activity = createPresentationActivity();
    activity.setSource("projection_window", true);
    activity.setSource("projection_window", true);
    expect(activity.snapshot()).toEqual({ active: true, sources: ["projection_window"] });
    activity.setSource("projection_window", false);
    expect(activity.isActive()).toBe(false);
  });

  it("rejeita nomes de fonte dinâmicos ou inseguros", () => {
    const activity = createPresentationActivity();
    expect(() => activity.setSource("../../projection", true)).toThrow(TypeError);
  });

  it("notifica apenas transições de atividade e permite unsubscribe", () => {
    const activity = createPresentationActivity();
    const transitions = [];
    const unsubscribe = activity.subscribe((active) => transitions.push(active));
    activity.setSource("projection_window", true);
    activity.setSource("media_playback", true);
    activity.setSource("projection_window", false);
    activity.setSource("media_playback", false);
    unsubscribe();
    activity.setSource("projection_window", true);
    expect(transitions).toEqual([true, false]);
  });

  it("não deixa observer com falha interromper a apresentação", () => {
    const activity = createPresentationActivity();
    activity.subscribe(() => { throw new Error("observer falhou"); });
    expect(activity.setSource("projection_window", true)).toBe(true);
    expect(activity.isActive()).toBe(true);
  });
});
