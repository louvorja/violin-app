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
});
