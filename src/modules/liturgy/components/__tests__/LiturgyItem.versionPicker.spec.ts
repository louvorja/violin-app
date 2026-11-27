import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { LITURGY_VERSION_ACTION } from "@/config/MusicAction";
import { LiturgyItemTypeEnum } from "@/enums/LiturgyItemTypeEnum";
import type { LiturgyItem } from "@/types/Liturgy";
import LiturgyItemCard from "../LiturgyItem.vue";

vi.mock("@/modules/liturgy/i18n", () => ({
  useLiturgyI18n: () => ({ t: (key: string) => key }),
}));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("@/helpers/Liturgy", () => ({
  default: {
    iconForItem: () => "",
    findScheduledForToday: () => null,
    getActiveDate: () => new Date(),
  },
}));
vi.mock("@/helpers/UserData", () => ({ default: { get: () => false, set: vi.fn() } }));
vi.mock("@/helpers/Platform", () => ({ default: { isDesktop: false } }));

const DialogStub = { props: ["modelValue"], template: '<div v-if="modelValue"><slot /></div>' };
const TooltipStub = { template: "<div><slot /></div>" };

// Item vindo do menu ⋮ ou de uma liturgia do clássico: sem versão gravada.
function mountCard() {
  return mount(LiturgyItemCard, {
    props: {
      element: {
        id: "m1",
        tipo: LiturgyItemTypeEnum.MUSICA,
        subtipo: "ja",
        item: "Confiei no Meu Senhor",
        subitem: "",
        musica: 42,
        id_music: 42,
        escolha: false,
        has_instrumental_music: true,
        cor: "#4F0000",
        duration: 5,
      } as LiturgyItem,
      index: 0,
      subtitleFor: () => "",
    },
    global: { stubs: { LjDialog: DialogStub, LjTooltip: TooltipStub } },
  });
}

async function pick(label: string) {
  const wrapper = mountCard();
  await wrapper.find(".lit-card-text").trigger("click");
  expect(wrapper.emitted("play-music")).toBeUndefined();
  const option = wrapper.findAll(".lit-version").find((b) => b.text() === label);
  expect(option, label).toBeTruthy();
  await option!.trigger("click");
  return wrapper.emitted("play-music")?.[0]?.[1];
}

describe("LiturgyItem — seletor de versão", () => {
  it.each([
    ["inputs.music_version_sung", "sung"],
    ["inputs.music_version_pb", "pb"],
    ["inputs.music_version_lyric", "lyric"],
    ["inputs.music_version_audio-only", "audio"],
    ["inputs.music_version_playback-only", "audio_pb"],
  ])("%s toca a versão %s da liturgia (#49)", async (label, mode) => {
    expect(await pick(label)).toBe(mode);
  });

  it("toda opção é uma versão que o playMusic da liturgia entende", async () => {
    const wrapper = mountCard();
    for (let i = 0; i < 5; i++) {
      await wrapper.find(".lit-card-text").trigger("click");
      const options = wrapper.findAll(".lit-version");
      expect(options).toHaveLength(5);
      await options[i].trigger("click");
    }
    const modes = (wrapper.emitted("play-music") ?? []).map((args) => args[1]);
    expect(modes).toHaveLength(5);
    for (const mode of modes) expect(Object.keys(LITURGY_VERSION_ACTION)).toContain(mode);
  });

  it("oculta opções de playback quando a música não tem instrumental", async () => {
    const wrapper = mount(LiturgyItemCard, {
      props: {
        element: {
          id: "m2",
          tipo: LiturgyItemTypeEnum.MUSICA,
          subtipo: "div",
          item: "Hino sem playback",
          subitem: "",
          musica: 43,
          id_music: 43,
          escolha: false,
          has_instrumental_music: false,
          cor: "#00004F",
          duration: 0,
        } as LiturgyItem,
        index: 0,
        subtitleFor: () => "",
      },
      global: { stubs: { LjDialog: DialogStub, LjTooltip: TooltipStub } },
    });

    // Duração 0 não renderiza o chip de tempo
    expect(wrapper.find(".lit-card-duration").exists()).toBe(false);

    await wrapper.find(".lit-card-text").trigger("click");
    const labels = wrapper.findAll(".lit-version").map((b) => b.text());
    expect(labels).toEqual([
      "inputs.music_version_sung",
      "inputs.music_version_lyric",
      "inputs.music_version_audio-only",
    ]);
  });

  it("exibe o chip de sobreposição vinculada mesmo quando o item não tem subtítulo", () => {
    const wrapper = mount(LiturgyItemCard, {
      props: {
        element: {
          id: "bg1",
          tipo: LiturgyItemTypeEnum.BG_PROJECTION,
          subtipo: "image",
          item: "Fundo",
          subitem: "",
          ref_id: "bg-rec-1",
          linked_overlay_id: "slot-1",
          cor: "#00004F",
          duration: 0,
        } as LiturgyItem,
        index: 0,
        subtitleFor: () => "",
        overlaySlots: [{ id: "slot-1", name: "Letreiro" } as never],
      },
      global: { stubs: { LjDialog: DialogStub, LjTooltip: TooltipStub } },
    });

    expect(wrapper.text()).toContain("Letreiro");
  });
});
