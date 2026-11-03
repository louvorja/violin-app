import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Hotkeys from "../Hotkeys";

/**
 * Valida o mecanismo usado pelo `POST /api/keyboard`: um `KeyboardEvent`
 * sintético disparado em `window` precisa cair no listener global do Hotkeys.
 */
describe("Hotkeys — KeyboardEvent sintético (POST /api/keyboard)", () => {
  beforeEach(() => {
    Hotkeys.init();
  });

  afterEach(() => {
    Hotkeys.destroy();
  });

  it("dispara o handler de ArrowRight", () => {
    let fired = 0;
    const handler = () => {
      fired += 1;
    };
    Hotkeys.register("ArrowRight", handler, {
      context: "media",
      preventDefault: false,
      allowInForm: true,
    });

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true })
    );

    expect(fired).toBe(1);
    Hotkeys.unregister("ArrowRight", handler);
  });

  it("dispara o handler de Ctrl+O com os modificadores do evento", () => {
    let fired = 0;
    const handler = () => {
      fired += 1;
    };
    Hotkeys.register("Ctrl+O", handler, { preventDefault: false });

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "o", ctrlKey: true, bubbles: true, cancelable: true })
    );

    expect(fired).toBe(1);
    Hotkeys.unregister("Ctrl+O", handler);
  });

  it("dispara Space enviado como 'Space' (app) igual ao ' ' real", () => {
    let fired = 0;
    const handler = () => {
      fired += 1;
    };
    Hotkeys.register("Space", handler, { preventDefault: false });

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Space", bubbles: true, cancelable: true })
    );

    expect(fired).toBe(1);
    Hotkeys.unregister("Space", handler);
  });

  it("Escape com allowInForm dispara mesmo com um campo de busca focado", () => {
    const input = document.createElement("input");
    document.body.append(input);
    input.focus();

    let fired = 0;
    const handler = () => {
      fired += 1;
    };
    Hotkeys.register("Escape", handler, { allowInForm: true });

    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })
    );

    expect(fired).toBe(1);
    Hotkeys.unregister("Escape", handler);
    input.remove();
  });

  it("allowInForm como função decide pelo campo focado e não cancela a tecla recusada", () => {
    const input = document.createElement("input");
    document.body.append(input);
    input.focus();

    let fired = 0;
    const handler = () => {
      fired += 1;
    };
    Hotkeys.register("Escape", handler, { allowInForm: () => !document.activeElement?.value });
    const press = () => {
      const event = new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      });
      input.dispatchEvent(event);
      return event;
    };

    input.value = "santo";
    expect(press().defaultPrevented).toBe(false);
    expect(fired).toBe(0);

    input.value = "";
    expect(press().defaultPrevented).toBe(true);
    expect(fired).toBe(1);
    Hotkeys.unregister("Escape", handler);
    input.remove();
  });

  it("preserva Space para ativar o botão focado", () => {
    const button = document.createElement("button");
    document.body.append(button);
    button.focus();

    let fired = 0;
    const handler = () => fired++;
    Hotkeys.register("Space", handler);

    const event = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });
    button.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(fired).toBe(0);

    button.blur();
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true })
    );
    expect(fired).toBe(1);

    Hotkeys.unregister("Space", handler);
    button.remove();
  });

  it("mantém atalhos no diálogo de módulo e os bloqueia no menu aberto", () => {
    const layer = document.createElement("div");
    layer.className = "lj-dialog--module";
    layer.setAttribute("data-dismissable-layer", "");
    layer.tabIndex = 0;
    document.body.append(layer);

    let fired = 0;
    const handler = () => fired++;
    Hotkeys.register("Ctrl+K", handler);
    layer.focus();
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true, cancelable: true })
    );
    expect(fired).toBe(1);

    const menu = document.createElement("div");
    menu.setAttribute("data-dismissable-layer", "");
    menu.tabIndex = 0;
    document.body.append(menu);
    menu.focus();
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true, cancelable: true })
    );
    expect(fired).toBe(1);

    Hotkeys.unregister("Ctrl+K", handler);
    menu.remove();
    layer.remove();
  });
});
