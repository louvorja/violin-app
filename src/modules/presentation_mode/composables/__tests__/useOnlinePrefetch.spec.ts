import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick, ref } from "vue";
import { mount } from "@vue/test-utils";

const prefetch = vi.fn();
vi.mock("@/helpers/OnlineVideo", () => ({ prefetch: (id: string) => prefetch(id) }));

import { useOnlinePrefetch } from "../useOnlinePrefetch";

describe("useOnlinePrefetch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    prefetch.mockClear();
  });
  afterEach(() => vi.useRealTimers());

  it("espera o operador parar de clicar e prepara cada vídeo uma vez", async () => {
    const ids = ref<(string | null)[]>([]);
    const wrapper = mount(defineComponent({ setup: () => (useOnlinePrefetch(() => ids.value), () => h("div")) }));

    ids.value = ["aaaaaaaaaaa", null];
    await nextTick();
    ids.value = ["bbbbbbbbbbb", "bbbbbbbbbbb", "ccccccccccc"];
    await nextTick();
    vi.advanceTimersByTime(499);
    expect(prefetch).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(prefetch.mock.calls.map((c) => c[0])).toEqual(["bbbbbbbbbbb", "ccccccccccc"]);

    wrapper.unmount();
    ids.value = ["ddddddddddd"];
    await nextTick();
    vi.advanceTimersByTime(1000);
    expect(prefetch).toHaveBeenCalledTimes(2);
  });
});
