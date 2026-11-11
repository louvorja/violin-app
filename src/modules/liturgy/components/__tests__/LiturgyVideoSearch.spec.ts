import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";

vi.mock("../../i18n", () => ({
  useLiturgyI18n: () => ({
    t: (key: string) =>
      (
        ({
          "video_search.title": "Busca de Vídeos",
          "video_search.source_online": "On-line",
          "video_search.source_custom": "Meus vídeos",
          "video_search.uncategorized": "Sem categoria",
          "video_search.view": "Visualização",
          "video_search.thumbnails": "Miniaturas",
          "video_search.list": "Lista",
          "video_search.channels": "Canais",
          "video_search.all_channels": "Todos os canais",
          "video_search.categories": "Categorias",
          "video_search.all_categories": "Todas as categorias",
          "video_search.without_channel": "Sem canal",
          "video_search.program_section": "Vídeos do programa",
          "video_search.custom_section": "Meus vídeos",
          "video_search.empty": "Nenhum vídeo disponível.",
          "video_search.empty_search": "Nenhum vídeo encontrado para esta busca.",
          "video_search.find_label": "Localizar vídeo:",
          "library_search.all_categories": "Todas",
          "library_search.uncategorized": "Sem categoria",
          "library_search.empty": "Nenhum item",
          "library_search.empty_search": "Nada encontrado",
          "library_search.keyboard_hint": "Setas e Enter",
          "library_search.view_label": "Visualização",
          "library_search.view_thumbnails": "Miniaturas",
          "library_search.view_list": "Lista",
          "actions.cancel": "Cancelar",
        }) as Record<string, string>
      )[key] ?? key,
  }),
}));

import LiturgyVideoSearch from "../LiturgyVideoSearch.vue";

const videosList = [
  {
    id: "v1",
    name: "Louvor do canal",
    url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    source: "online" as const,
    channelId: "ch1",
    channelName: "Canal A",
    playlistId: "pl1",
    playlistName: "Playlist 1",
  },
  {
    id: "custom-1",
    name: "Vídeo salvo",
    url: "https://www.youtube.com/watch?v=5xVSUAo7bhU",
    source: "custom" as const,
    categoryId: "cat-1",
    categoryName: "Culto",
  },
];

const stubs = {
  LjDialog: {
    props: ["modelValue"],
    template: '<div><slot /><slot name="footer" /></div>',
  },
  LjInput: {
    props: ["modelValue", "placeholder"],
    emits: ["update:modelValue"],
    methods: { focus() {} },
    template:
      '<input :value="modelValue" :placeholder="placeholder" @input="$emit(\'update:modelValue\', $event.target.value)" />',
  },
  LjButton: { template: "<button><slot /></button>" },
  LjIcon: true,
};

describe("LiturgyVideoSearch", () => {
  it("separa programa por canal e custom por categoria", async () => {
    const wrapper = mount(LiturgyVideoSearch, {
      props: { modelValue: true, videosList },
      global: { stubs },
    });
    await nextTick();

    const chips = wrapper.findAll(".vls-chip").map((chip) => chip.text());
    expect(chips).toContain("Canal A");
    expect(chips).toContain("Culto");
    expect(chips).toContain("Sem categoria");
    expect(chips.join(" | ")).not.toContain("Playlist 1");
    expect(wrapper.findAll(".vls-card")).toHaveLength(2);
    // As miniaturas vêm do ID do YouTube, não da miniatura do canal.
    expect(wrapper.findAll(".vls-card img")[0].attributes("src")).toContain("dQw4w9WgXcQ");
  });

  it("alterna lista/miniaturas e emite o vídeo escolhido", async () => {
    const wrapper = mount(LiturgyVideoSearch, {
      props: { modelValue: true, videosList },
      global: { stubs },
    });
    await nextTick();

    await wrapper.findAll(".vls-view")[1].trigger("click");
    expect(wrapper.find(".lgv-items--list").exists()).toBe(true);
    await wrapper.findAll(".vls-row")[1].trigger("click");

    expect(wrapper.emitted("pick")?.[0]?.[0]).toMatchObject({
      id: "custom-1",
      url: "https://www.youtube.com/watch?v=5xVSUAo7bhU",
    });
  });
});
