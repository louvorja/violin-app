import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, type VueWrapper } from "@vue/test-utils";
import { h, nextTick } from "vue";
import { TooltipProvider } from "reka-ui";
import { mountUi } from "@/components/ui/__tests__/mountUi";

const results = [
  { id_music: 1, name: "Castelo Forte" },
  { id_music: 2, name: "Castelo de Glória" },
];

vi.mock("@/helpers/ApiClient", () => ({
  apiFetch: vi.fn(async (url: string) => ({
    ok: true,
    json: async () => (url.includes("music-search") ? { results } : { albums: [] }),
  })),
  postApi: vi.fn(),
}));

const RemoteMusic = (await import("../RemoteMusic.vue")).default;

let wrapper: VueWrapper | null = null;

function campo(): HTMLInputElement {
  return wrapper!.find(".rm-root input").element as HTMLInputElement;
}

async function tecla(key: string) {
  campo().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  await nextTick();
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  // Botões só-ícone ganham tooltip, que só funciona sob o TooltipProvider do App.vue.
  wrapper = mountUi(
    { render: () => h(TooltipProvider, () => h(RemoteMusic, { token: "t" })) },
    { attachTo: document.body }
  );
  await flushPromises();
  campo().value = "castelo";
  campo().dispatchEvent(new Event("input"));
  await vi.advanceTimersByTimeAsync(300);
  await flushPromises();
});
afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  vi.useRealTimers();
});

describe("controle remoto: busca de música pelo teclado", () => {
  it("↓ escolhe o resultado e Enter abre a escolha da versão dele", async () => {
    const active = () => wrapper!.find(".lj-music-row--active .rm-item__title").text();
    expect(active()).toBe("Castelo Forte");
    await tecla("ArrowDown");
    expect(active()).toBe("Castelo de Glória");
    await tecla("Enter");
    await flushPromises();
    expect(document.body.textContent).toContain("Castelo de Glória");
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });
});
