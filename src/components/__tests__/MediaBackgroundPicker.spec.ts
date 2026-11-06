import { describe, expect, it, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { mountUi } from "@/components/ui/__tests__/mountUi";
import { DB_TABLE } from "@/constants/DbTables";

const rows = new Map<string, unknown[]>([
  [
    DB_TABLE.MEDIA_LIBRARY,
    [{ id: "m1", name: "Vídeo da biblioteca", path: "/midia/video.mp4", type: "video" }],
  ],
  [
    DB_TABLE.BACKGROUND_PROJECTION_LIBRARY,
    [{ id: "b1", name: "GIF de fundo", path: "/fundo/animado.gif", type: "image" }],
  ],
]);

vi.mock("@/helpers/IndexedDB", () => ({
  default: { getAll: vi.fn(async (table: string) => rows.get(table) ?? []) },
}));
vi.mock("@/helpers/Platform", () => ({ default: { isDesktop: true } }));
vi.mock("@/helpers/Path", () => ({
  default: { local: (path: string) => `louvorja://local${path}` },
}));

describe("MediaBackgroundPicker", () => {
  it("filtra por tipo quando o consumidor só aceita imagem", async () => {
    const Picker = (await import("../MediaBackgroundPicker.vue")).default;
    const w = mountUi(
      Picker,
      {
        props: { modelValue: true, mediaTypes: ["image"] },
        global: {
          stubs: {
            LjDialog: { template: '<div><slot /><slot name="footer" /></div>' },
          },
        },
      },
      "pt"
    );
    await flushPromises();

    expect(w.findAll(".mbp-thumb")).toHaveLength(1);
    expect(w.text()).toContain("GIF de fundo");
    expect(w.text()).not.toContain("Vídeo da biblioteca");
  });

  it("abre em miniaturas e alterna para lista", async () => {
    const Picker = (await import("../MediaBackgroundPicker.vue")).default;
    const w = mountUi(
      Picker,
      {
        props: { modelValue: true },
        global: {
          stubs: {
            LjDialog: { template: '<div><slot /><slot name="footer" /></div>' },
          },
        },
      },
      "pt"
    );
    await flushPromises();

    expect(w.findAll(".mbp-thumb")).toHaveLength(2);
    expect(w.findAll(".mbp-item")).toHaveLength(0);

    await w.findAll(".mbp-view")[1]!.trigger("click");
    expect(w.findAll(".mbp-thumb")).toHaveLength(0);
    expect(w.findAll(".mbp-item")).toHaveLength(2);
  });

  it("lista as duas bibliotecas e devolve o caminho local do item", async () => {
    const Picker = (await import("../MediaBackgroundPicker.vue")).default;
    const w = mountUi(
      Picker,
      {
        props: { modelValue: true },
        global: {
          stubs: {
            LjDialog: { template: '<div><slot /><slot name="footer" /></div>' },
          },
        },
      },
      "pt"
    );
    await flushPromises();

    const items = w.findAll(".mbp-thumb");
    await items[0].trigger("click");
    expect(w.emitted("pick")?.[0]?.[0]).toMatchObject({
      name: "Vídeo da biblioteca",
      type: "video",
      url: "louvorja://local/midia/video.mp4",
    });
  });
});
