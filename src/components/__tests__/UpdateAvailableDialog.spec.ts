import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { nextTick } from "vue";
import { mountUi } from "@/components/ui/__tests__/mountUi";
import UpdateAvailableDialog from "@/components/UpdateAvailableDialog.vue";

const h = vi.hoisted(() => {
  let listener: ((state: Record<string, unknown>) => void) | null = null;
  const api = {
    status: vi.fn(async () => ({ status: "available", progress: 0, newVersion: "2.0.0-beta.13" })),
    getReleaseNotes: vi.fn(async () => null),
    onStateChange: vi.fn((callback: (state: Record<string, unknown>) => void) => {
      listener = callback;
      return () => {
        listener = null;
      };
    }),
    emit: (state: Record<string, unknown>) => listener?.(state),
  };
  return { api };
});

vi.mock("@/helpers/Platform", () => ({ default: { updater: h.api } }));

const openDialogs: { unmount: () => void }[] = [];

afterEach(() => {
  for (const dialog of openDialogs.splice(0)) dialog.unmount();
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("UpdateAvailableDialog", () => {
  it("observa o download desde a primeira abertura e libera a inscrição ao fechar", async () => {
    const dialog = mountUi(UpdateAvailableDialog, {
      attachTo: document.body,
      props: { modelValue: true, version: "2.0.0-beta.13" },
      global: { stubs: { DontShowAgainCheckbox: true } },
    });
    openDialogs.push(dialog);
    await flushPromises();

    expect(h.api.onStateChange).toHaveBeenCalledOnce();
    expect(document.body.textContent).toContain("Atualizar");

    h.api.emit({ status: "downloading", progress: 30, newVersion: "2.0.0-beta.13" });
    await nextTick();
    expect(document.body.textContent).toContain("30%");

    await dialog.setProps({ modelValue: false });
    h.api.emit({ status: "downloaded", progress: 100 });
    await nextTick();
    expect(document.body.textContent).not.toContain("Instalar");
  });

  it("mostra as notas formatadas, sem os marcadores do texto cru", async () => {
    h.api.getReleaseNotes.mockResolvedValueOnce({
      version: "2.0.0-beta.13",
      name: "beta.13",
      body: "## Novidades\n\n- Use **Recarregar**.",
      bodyHtml: "<h2>Novidades</h2><ul><li>Use <strong>Recarregar</strong>.</li></ul>",
      url: "https://example.invalid",
    } as never);
    const dialog = mountUi(UpdateAvailableDialog, {
      attachTo: document.body,
      props: { modelValue: true, version: "2.0.0-beta.13" },
      global: { stubs: { DontShowAgainCheckbox: true } },
    });
    openDialogs.push(dialog);
    await flushPromises();

    expect(h.api.getReleaseNotes).toHaveBeenCalledWith("2.0.0-beta.13");
    expect(document.body.querySelector(".ua-notes strong")?.textContent).toBe("Recarregar");
    expect(document.body.textContent).not.toContain("**");
  });

  it("sem o HTML, cai no texto das notas", async () => {
    h.api.getReleaseNotes.mockResolvedValueOnce({
      version: "2.0.0-beta.13",
      name: "beta.13",
      body: "- Correções",
      bodyHtml: null,
      url: "https://example.invalid",
    } as never);
    const dialog = mountUi(UpdateAvailableDialog, {
      attachTo: document.body,
      props: { modelValue: true, version: "2.0.0-beta.13" },
      global: { stubs: { DontShowAgainCheckbox: true } },
    });
    openDialogs.push(dialog);
    await flushPromises();

    expect(document.body.querySelector(".ua-notes__raw")?.textContent).toBe("- Correções");
  });
});
