// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  FORWARDABLE_KEYS,
  INPUT_KEY_CODES,
  KEYS_BY_FEATURE,
  resolveKeyTarget,
  toInputKeyCode,
} from "../windowKeys.mjs";

/**
 * O contrato da fronteira do `windows:sendKey`.
 *
 * O IPC entrega um evento numa página que não é nossa — outra origem, outra
 * partição, sem preload. Quem escolhe a tecla é o renderer, mas quem valida é
 * o main, e as duas partes leem o MESMO arquivo: é isso que impede a lista de
 * divergir (o renderer acha que envia, o main recusa, e a tecla some sem
 * ninguém ver).
 */
describe("windowKeys — fronteira do windows:sendKey", () => {
  it("só as duas janelas da URL têm tecla encaminhada", () => {
    expect(Object.keys(KEYS_BY_FEATURE).sort()).toEqual(["site", "site_return"]);
  });

  it("o espelho recebe exatamente as mesmas teclas da projeção", () => {
    // A simetria entre as duas é a única coisa que mantém o mesmo slide nos
    // dois: são instâncias independentes da mesma URL.
    expect(KEYS_BY_FEATURE.site_return).toEqual(FORWARDABLE_KEYS);
    expect(resolveKeyTarget("site_return", "ArrowRight")).toEqual({
      ok: true,
      feature: "site_return",
      key: "ArrowRight",
    });
    expect(resolveKeyTarget("site_return", "a")).toMatchObject({ ok: false, reason: "key" });
    expect(resolveKeyTarget("site_return", "Escape")).toMatchObject({ ok: false, reason: "key" });
  });

  it.each(FORWARDABLE_KEYS)("aceita %s para o Site", (key) => {
    expect(resolveKeyTarget("site", key)).toEqual({ ok: true, feature: "site", key });
  });

  it.each(["ArrowUp", "ArrowDown", "PageUp", "Home", "End"])(
    "todas as teclas esperadas estão na lista: %s",
    (key) => {
      expect(FORWARDABLE_KEYS).toContain(key);
    }
  );

  it("não aceita tecla fora da lista", () => {
    // Uma tecla qualquer não pode virar evento numa página alheia: isso é o
    // que separa "rolar o site" de injetar o que o operador digitou.
    expect(resolveKeyTarget("site", "a")).toMatchObject({ ok: false, reason: "key" });
    expect(resolveKeyTarget("site", "Escape")).toMatchObject({ ok: false, reason: "key" });
    expect(resolveKeyTarget("site", "F5")).toMatchObject({ ok: false, reason: "key" });
  });

  it("não aceita feature desconhecida", () => {
    expect(resolveKeyTarget("musicas", "ArrowRight")).toMatchObject({
      ok: false,
      reason: "feature",
    });
    expect(resolveKeyTarget("", "ArrowRight")).toMatchObject({ ok: false, reason: "feature" });
  });

  it("não aceita entrada malformada", () => {
    expect(resolveKeyTarget(undefined, "ArrowRight")).toMatchObject({ ok: false });
    expect(resolveKeyTarget("site", undefined)).toMatchObject({ ok: false });
    expect(resolveKeyTarget("site", 42)).toMatchObject({ ok: false, reason: "key" });
    expect(resolveKeyTarget({}, "ArrowRight")).toMatchObject({ ok: false });
  });

  it("a lista é fechada: não é um objeto vivo que alguém possa encher", () => {
    expect(Object.isFrozen(KEYS_BY_FEATURE)).toBe(true);
    expect(KEYS_BY_FEATURE.novo).toBeUndefined();
  });
});

describe("toInputKeyCode — DOM → nome do sendInputEvent", () => {
  it.each([
    ["ArrowLeft", "Left"],
    ["ArrowRight", "Right"],
    ["ArrowUp", "Up"],
    ["ArrowDown", "Down"],
    ["PageUp", "PageUp"],
    ["PageDown", "PageDown"],
    ["Home", "Home"],
    ["End", "End"],
  ])("%s vira %s", (dom, esperado) => {
    expect(toInputKeyCode(dom)).toBe(esperado);
  });

  it("toda tecla encaminhável tem equivalente — senão o main recusa em silêncio", () => {
    /*
     * A fronteira deixa passar 8 teclas; se uma delas não traduzir, o IPC
     * devolve `key` e a tecla some sem ninguém ver o motivo.
     */
    for (const tecla of FORWARDABLE_KEYS) {
      expect(toInputKeyCode(tecla), `sem equivalente para ${tecla}`).toBeTruthy();
    }
    expect(Object.keys(INPUT_KEY_CODES).sort()).toEqual([...FORWARDABLE_KEYS].sort());
  });

  it("recusa o que não tem equivalente", () => {
    expect(toInputKeyCode("a")).toBeNull();
    expect(toInputKeyCode("Escape")).toBeNull();
    expect(toInputKeyCode("arrowright")).toBeNull(); // DOM é sensível a caixa
    expect(toInputKeyCode(undefined)).toBeNull();
  });
});
