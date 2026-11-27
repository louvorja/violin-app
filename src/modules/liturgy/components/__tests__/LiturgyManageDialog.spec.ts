import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import type { LiturgyLibraryItem } from "@/types/LiturgyLibrary";
import { LiturgyItemTypeEnum } from "@/enums/LiturgyItemTypeEnum";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  getByName: vi.fn(),
  save: vi.fn(),
  currentId: "lit-1" as string | null,
  setCurrentId: vi.fn(),
  alertInfo: vi.fn(),
}));

vi.mock("@/modules/liturgy/i18n", () => ({
  useLiturgyI18n: () => ({ t: (key: string) => key }),
}));
vi.mock("@/helpers/Alert", () => ({
  default: { info: mocks.alertInfo },
  escapeHtml: (s: string) => s,
}));
vi.mock("@/helpers/Liturgy", () => ({
  default: {
    getCurrentLiturgyId: () => mocks.currentId,
    setCurrentLiturgyId: mocks.setCurrentId,
  },
}));
vi.mock("../../composables/useLiturgyLibrary", () => ({
  useLiturgyLibrary: () => ({
    get: mocks.get,
    getByName: mocks.getByName,
    save: mocks.save,
  }),
}));

import LiturgyManageDialog from "../LiturgyManageDialog.vue";

const SAVED_LITURGY: LiturgyLibraryItem = {
  id: "lit-1",
  name: "Culto de Sábado",
  color: "#00004F",
  items: [
    {
      id: "i1",
      tipo: LiturgyItemTypeEnum.ANOTACAO,
      subtipo: "",
      item: "Boas-vindas",
      subitem: "Saudação",
      cor: "#00004F",
      duration: 5,
      musica: -1,
      dir: "",
      dir_info: "E",
      url: "",
      escolha: false,
      has_instrumental_music: false,
    },
  ],
  binding: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const stubs = {
  LjDialog: {
    props: ["modelValue"],
    template: '<div v-if="modelValue"><slot /><slot name="footer" /></div>',
  },
  LjField: {
    props: ["error"],
    template: '<div><slot /><span v-if="error" class="err">{{ error }}</span></div>',
  },
  LjInput: {
    props: ["modelValue"],
    emits: ["update:modelValue"],
    template:
      '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
  },
  LjButton: {
    props: ["disabled"],
    emits: ["click"],
    template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
  },
  LjPopover: { template: '<div><slot name="trigger" /><slot /></div>' },
  LjColorPicker: true,
  LjDivider: true,
  LjSelect: true,
  LjIcon: true,
};

describe("LiturgyManageDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.currentId = "lit-1";
    mocks.get.mockResolvedValue(SAVED_LITURGY);
    mocks.getByName.mockResolvedValue(undefined);
    mocks.save.mockImplementation(async (data) => ({ ...SAVED_LITURGY, ...data }));
  });

  it("preserva todos os itens ao renomear a liturgia", async () => {
    const wrapper = mount(LiturgyManageDialog, {
      props: { modelValue: false },
      global: { stubs },
    });
    await wrapper.setProps({ modelValue: true });
    await flushPromises();

    const input = wrapper.find("input");
    await input.setValue("Culto Jovem");

    const saveBtn = wrapper.findAll("button").find((b) => b.text() === "actions.save");
    expect(saveBtn).toBeDefined();
    await saveBtn!.trigger("click");
    await flushPromises();

    expect(mocks.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "lit-1",
        name: "Culto Jovem",
        items: SAVED_LITURGY.items,
      })
    );
    expect(wrapper.emitted("managed")).toHaveLength(1);
  });

  it("impede renomear para um nome já usado por outra liturgia", async () => {
    mocks.getByName.mockResolvedValue({ ...SAVED_LITURGY, id: "lit-2", name: "Culto Quarta" });
    const wrapper = mount(LiturgyManageDialog, {
      props: { modelValue: false },
      global: { stubs },
    });
    await wrapper.setProps({ modelValue: true });
    await flushPromises();

    await wrapper.find("input").setValue("Culto Quarta");
    const saveBtn = wrapper.findAll("button").find((b) => b.text() === "actions.save");
    await saveBtn!.trigger("click");
    await flushPromises();

    expect(mocks.save).not.toHaveBeenCalled();
    expect(wrapper.find(".err").text()).toBe("library.name_exists");
  });
});
