import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createOverlaySlot, type OverlaySlot } from "@/types/Overlay";

const { getImage, resolveImageUrl } = vi.hoisted(() => ({
  getImage: vi.fn(async (): Promise<unknown> => null),
  resolveImageUrl: vi.fn((): string => ""),
}));

vi.mock("@/helpers/Overlay", () => ({ getImage, resolveImageUrl }));

import OverlaySlotPreview from "../OverlaySlotPreview.vue";

function mountPreview(props: {
  overlay: OverlaySlot;
  mirrorText?: string;
  mirrorColor?: string;
  placeholder?: string;
}) {
  return mount(OverlaySlotPreview, {
    props,
    global: { stubs: { LjIcon: true } },
  });
}

describe("OverlaySlotPreview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("desenha o texto com as unidades do palco", () => {
    const slot = createOverlaySlot({ id: "t1", type: "text", content: "Bem-vindos" });
    const wrapper = mountPreview({ overlay: slot });

    const text = wrapper.get(".ovl-slot__text").element as HTMLElement;
    expect(text.textContent?.trim()).toBe("Bem-vindos");
    expect(text.style.fontSize).toBe("5cqh");
  });

  it("usa o texto do espelho de módulo recebido", () => {
    const slot = createOverlaySlot({
      id: "m1",
      type: "module_mirror",
      source_module: "timer_worship",
      content: "",
    });
    const wrapper = mountPreview({
      overlay: slot,
      mirrorText: "00:05:00",
      mirrorColor: "#f59e0b",
    });

    const text = wrapper.get(".ovl-slot__text").element as HTMLElement;
    expect(text.textContent?.trim()).toBe("00:05:00");
    expect(text.style.color).toBe("rgb(245, 158, 11)");
  });

  it("carrega a imagem do slot", async () => {
    getImage.mockResolvedValue({ id: "img", name: "logo", path: "", mime: "image/png" });
    resolveImageUrl.mockReturnValue("blob:logo");
    const slot = createOverlaySlot({ id: "i1", type: "image", file_id: "img", content: "" });

    const wrapper = mountPreview({ overlay: slot });
    await flushPromises();

    expect(getImage).toHaveBeenCalledWith("img");
    expect(wrapper.get(".ovl-slot__img").attributes("src")).toBe("blob:logo");
    expect(wrapper.find(".ovl-slot__placeholder").exists()).toBe(false);
  });

  it("mostra um marcador quando a imagem ainda não está disponível", () => {
    const slot = createOverlaySlot({ id: "i2", type: "image", file_id: "", content: "" });
    const wrapper = mountPreview({ overlay: slot, placeholder: "Imagem" });

    expect(wrapper.find(".ovl-slot__img").exists()).toBe(false);
    expect(wrapper.find(".ovl-slot__placeholder").exists()).toBe(true);
  });
});
