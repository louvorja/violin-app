import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";

const mocks = vi.hoisted(() => ({
  translateText: vi.fn<(text: string) => Promise<string>>(),
  findCachedByText: vi.fn(async () => null),
  setCached: vi.fn(async () => undefined),
  postMessage: vi.fn(),
}));

vi.mock("@/components/ui", () => ({ LjProgress: { template: "<div />" } }));
vi.mock("@/helpers/Broadcast", () => ({
  default: { listen: vi.fn(() => vi.fn()), send: vi.fn() },
}));
vi.mock("@/helpers/UserData", () => ({
  default: {
    get: (key: string, fallback: unknown) => (key === "modules.libras.show_text" ? true : fallback),
  },
}));
vi.mock("@/helpers/Libras", () => ({
  default: {
    stripHtml: (text: string) => text.replace(/<[^>]*>/g, " ").trim(),
    formatGloss: (gloss: string) => gloss,
    findCachedByText: mocks.findCachedByText,
    translateText: mocks.translateText,
    uniqueTokens: (gloss: string) => gloss.split(" "),
    setCached: mocks.setCached,
  },
}));
vi.mock("@/modules/libras/composables/useLibrasState", () => ({
  useLibrasState: () => ({ scopeEnabled: () => true }),
}));

import LibrasOverlay from "@/views/LibrasOverlay.vue";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe("LibrasOverlay async translation", () => {
  let wrapper: VueWrapper | null = null;

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    mocks.translateText.mockReset();
    mocks.findCachedByText.mockReset().mockResolvedValue(null);
    mocks.setCached.mockReset().mockResolvedValue(undefined);
    mocks.postMessage.mockReset();
  });

  it("ignores an older verse translation that resolves after the current verse", async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
    const first = deferred<string>();
    const second = deferred<string>();
    mocks.translateText.mockImplementation((text) =>
      text === "Primeiro verso" ? first.promise : second.promise
    );

    wrapper = mount(LibrasOverlay, {
      attachTo: document.body,
      props: { type: "bible", verseText: "" },
    });
    const iframe = document.querySelector("iframe.libras-unity-iframe") as HTMLIFrameElement;
    vi.spyOn(iframe.contentWindow!, "postMessage").mockImplementation(mocks.postMessage);
    await wrapper.setProps({ verseText: "Primeiro verso" });
    await vi.waitFor(() => expect(mocks.translateText).toHaveBeenCalledWith("Primeiro verso"));
    await wrapper.setProps({ verseText: "Segundo verso" });
    await vi.waitFor(() => expect(mocks.translateText).toHaveBeenCalledWith("Segundo verso"));
    iframe.dispatchEvent(new Event("load"));
    window.dispatchEvent(
      new MessageEvent("message", {
        source: iframe.contentWindow,
        data: { type: "unity_event", event: "on_load_player" },
      })
    );

    second.resolve("GLOSS SEGUNDO");
    await vi.waitFor(() => expect(document.body.textContent).toContain("GLOSS SEGUNDO"));
    await flushPromises();
    first.resolve("GLOSS PRIMEIRO");
    await flushPromises();
    await nextTick();

    expect(mocks.translateText).toHaveBeenCalledTimes(2);
    expect(mocks.setCached).toHaveBeenCalledOnce();
    expect(mocks.setCached).toHaveBeenCalledWith(
      expect.objectContaining({ gloss: "GLOSS SEGUNDO" })
    );
    expect(document.body.textContent).toContain("GLOSS SEGUNDO");
    expect(document.body.textContent).not.toContain("GLOSS PRIMEIRO");
    const playedGlosses = mocks.postMessage.mock.calls
      .map(([message]) => message as { method?: string; params?: string })
      .filter((message) => message.method === "playNow")
      .map((message) => message.params);
    expect(playedGlosses).toEqual(["GLOSS SEGUNDO"]);
  });
});
