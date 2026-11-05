import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { nextTick } from "vue";
import { mountUi } from "@/components/ui/__tests__/mountUi";
import StartupTipDialog from "../StartupTipDialog.vue";
import type { StartupTip } from "@/helpers/StartupTips";
import { KEYS } from "@/constants/UserDataKeys";

const h = vi.hoisted(() => ({
  set: vi.fn(),
}));

vi.mock("@/helpers/UserData", () => ({
  default: { get: (_key: string, fallback: unknown) => fallback, set: h.set },
}));

const tip: StartupTip = {
  kind: "shortcut",
  id: "shortcut:hotkeys.ctrl_k",
  combo: "Ctrl+k",
  parts: ["Ctrl", "K"],
  descriptionKey: "hotkeys.ctrl_k",
  detailKey: "startup_tips.shortcut_details.ctrl_k",
};

const dialogs: { unmount: () => void }[] = [];

beforeEach(() => {
  h.set.mockClear();
});

afterEach(() => {
  for (const dialog of dialogs.splice(0)) dialog.unmount();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

async function mountDialog(extra: Record<string, unknown> = {}) {
  const dialog = mountUi(StartupTipDialog, {
    attachTo: document.body,
    props: { modelValue: true, tip, ...extra },
  });
  dialogs.push(dialog);
  await flushPromises();
  await nextTick();
  return dialog;
}

describe("StartupTipDialog", () => {
  it("mostra o atalho e não grava nada ao fechar sem marcar", async () => {
    const dialog = await mountDialog();

    expect(document.body.textContent).toContain("Ctrl");
    expect(document.body.textContent).toContain("Abrir paleta de comandos");
    expect(document.body.textContent).toContain("Abre a paleta de comandos");
    expect(document.body.textContent).not.toContain("Dica anterior");

    const close = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === "Fechar"
    );
    expect(close).toBeDefined();
    close!.click();
    await nextTick();

    expect(h.set).not.toHaveBeenCalled();
    expect(dialog.emitted("update:modelValue")?.[0]).toEqual([false]);
  });

  it("renderiza uma dica de configuração com título e texto próprios", async () => {
    await mountDialog({
      tip: {
        kind: "feature",
        id: "feature:canva",
        titleKey: "startup_tips.features.canva.title",
        bodyKey: "startup_tips.features.canva.body",
        icon: "photo",
      },
    });

    expect(document.body.textContent).toContain("Dica de configuração");
    expect(document.body.textContent).toContain("Canva");
    expect(document.body.textContent).toContain("guarda uma cópia");
  });

  it("navega para a dica anterior e a próxima sem fechar", async () => {
    const dialog = await mountDialog({ showPrevious: true, previousDisabled: false });
    const buttons = [...document.querySelectorAll<HTMLButtonElement>("button")];

    buttons.find((button) => button.textContent?.trim() === "Dica anterior")!.click();
    buttons.find((button) => button.textContent?.trim() === "Próxima dica")!.click();
    await nextTick();

    expect(dialog.emitted("previous")).toHaveLength(1);
    expect(dialog.emitted("next")).toHaveLength(1);
    expect(dialog.emitted("update:modelValue")).toBeUndefined();
  });

  it("grava a preferência ao fechar com o checkbox marcado", async () => {
    await mountDialog();
    document.querySelector<HTMLInputElement>(".lj-check__input")!.click();
    await nextTick();

    const close = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === "Fechar"
    );
    close!.click();
    await nextTick();

    expect(h.set).toHaveBeenCalledWith(KEYS.OPTIONS.SHOW_STARTUP_TIPS, false);
  });
});
