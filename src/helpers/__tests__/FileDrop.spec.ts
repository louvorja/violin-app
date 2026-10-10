import { beforeEach, describe, expect, it, vi } from "vitest";

const openSlja = vi.fn();
const warning = vi.fn();
vi.mock("@/helpers/SljaPlayer", () => ({ openSlja: (...a: unknown[]) => openSlja(...a) }));
vi.mock("@/helpers/Snackbar", () => ({ default: { warning: (...a: unknown[]) => warning(...a) } }));
vi.mock("@/i18n", () => ({ i18nAtual: () => null }));

function dropEvent(type: string, files: File[], withFiles = true): DragEvent {
  const event = new Event(type, { bubbles: true, cancelable: true }) as DragEvent;
  Object.defineProperty(event, "dataTransfer", {
    value: { types: withFiles ? ["Files"] : ["text/plain"], files },
  });
  return event;
}

describe("installFileDrop", () => {
  beforeEach(async () => {
    openSlja.mockReset();
    warning.mockReset();
    document.body.innerHTML = "";
    vi.resetModules();
    (await import("../FileDrop")).installFileDrop();
  });

  it("abre o último .slja solto e mostra o aviso só durante o arrasto", () => {
    window.dispatchEvent(dropEvent("dragenter", []));
    expect(document.getElementById("lj-file-drop-hint")).not.toBeNull();

    const a = new File(["x"], "a.slja");
    const b = new File(["x"], "B.SLJA");
    window.dispatchEvent(dropEvent("drop", [a, b]));

    expect(openSlja).toHaveBeenCalledTimes(1);
    expect(openSlja).toHaveBeenCalledWith(b, { origin: "drop" });
    expect(document.getElementById("lj-file-drop-hint")).toBeNull();
  });

  it("avisa e não abre nada quando o arquivo não é .slja, e impede o navegador de abri-lo", () => {
    const event = dropEvent("drop", [new File(["x"], "foto.png")]);
    window.dispatchEvent(event);
    expect(openSlja).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it("deixa em paz um drop que um módulo já tratou", () => {
    const zone = document.createElement("div");
    zone.addEventListener("drop", (e) => e.preventDefault());
    document.body.appendChild(zone);
    zone.dispatchEvent(dropEvent("drop", [new File(["x"], "a.slja")]));
    expect(openSlja).not.toHaveBeenCalled();
    expect(warning).not.toHaveBeenCalled();
  });

  it("ignora arrastos que não trazem arquivos", () => {
    window.dispatchEvent(dropEvent("dragenter", [], false));
    expect(document.getElementById("lj-file-drop-hint")).toBeNull();
    window.dispatchEvent(dropEvent("drop", [new File(["x"], "a.slja")], false));
    expect(openSlja).not.toHaveBeenCalled();
  });
});
