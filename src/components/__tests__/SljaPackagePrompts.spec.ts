import { afterEach, describe, expect, it } from "vitest";
import { flushPromises } from "@vue/test-utils";
import SljaPackagePrompts from "../SljaPackagePrompts.vue";
import { expectKeyExists, mountUi } from "@/components/ui/__tests__/mountUi";

const wrappers: { unmount: () => void }[] = [];

function mountPrompts() {
  const wrapper = mountUi(SljaPackagePrompts);
  wrappers.push(wrapper);
  return wrapper;
}

describe("SljaPackagePrompts (#62)", () => {
  afterEach(() => {
    while (wrappers.length) wrappers.pop()?.unmount();
    document.body.innerHTML = "";
  });

  it("tem todas as chaves shell.slja em pt.json e es.json", () => {
    for (const key of [
      "shell.slja.track_title",
      "shell.slja.track_description",
      "shell.slja.track_description_multi",
      "shell.slja.all_sung",
      "shell.slja.all_playback",
      "shell.slja.track_sung",
      "shell.slja.track_playback",
      "shell.slja.import_confirm",
      "shell.slja.export_title",
      "shell.slja.export_description",
      "shell.slja.export_unified_title",
      "shell.slja.export_unified_hint",
      "shell.slja.export_classic_title",
      "shell.slja.export_classic_hint",
      "shell.slja.cancel",
    ]) {
      expectKeyExists(key);
    }
  });

  it("permite classificar músicas legadas individualmente como cantado ou playback", async () => {
    const wrapper = mountPrompts();
    const vm = wrapper.vm as unknown as {
      classifyLegacyTracks: (
        _items: { key: string; songName: string; fileName: string }[]
      ) => Promise<Record<string, "cantado" | "playback"> | null>;
    };

    const promise = vm.classifyLegacyTracks([
      { key: "a", songName: "Louvor A", fileName: "a.slja" },
      { key: "b", songName: "Louvor B", fileName: "b.slja" },
    ]);
    await flushPromises();

    const pbButtons = document.body.querySelectorAll<HTMLButtonElement>(
      '[data-testid="slja-choice-playback"]'
    );
    expect(pbButtons).toHaveLength(2);
    pbButtons[1].click();
    await flushPromises();

    document.body.querySelector<HTMLButtonElement>('[data-testid="slja-confirm-import"]')?.click();
    await expect(promise).resolves.toEqual({ a: "cantado", b: "playback" });
  });

  it("cancela a classificação unitária e resolve null sem travar", async () => {
    const wrapper = mountPrompts();
    const vm = wrapper.vm as unknown as {
      classifyLegacyTrack: (_item: {
        key: string;
        songName: string;
        fileName: string;
      }) => Promise<"cantado" | "playback" | null>;
    };

    const promise = vm.classifyLegacyTrack({
      key: "single",
      songName: "Única",
      fileName: "unica.slja",
    });
    await flushPromises();

    const cancelBtn = Array.from(document.body.querySelectorAll<HTMLButtonElement>("button")).find(
      (btn) => btn.textContent?.includes("cancel") || btn.classList.contains("lj-dialog__close")
    );
    cancelBtn?.click();
    await expect(promise).resolves.toBeNull();
  });

  it("permite escolher modo unificado ou clássico na exportação", async () => {
    const wrapper = mountPrompts();
    const vm = wrapper.vm as unknown as {
      chooseExportMode: () => Promise<"unified" | "classic" | null>;
    };

    const first = vm.chooseExportMode();
    await flushPromises();
    document.body.querySelector<HTMLButtonElement>('[data-testid="slja-export-unified"]')?.click();
    await expect(first).resolves.toBe("unified");

    const second = vm.chooseExportMode();
    await flushPromises();
    document.body.querySelector<HTMLButtonElement>('[data-testid="slja-export-classic"]')?.click();
    await expect(second).resolves.toBe("classic");
  });
});
