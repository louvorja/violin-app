import { beforeEach, describe, expect, it, vi } from "vitest";
import { computed, ref } from "vue";
import type { LiturgyItem } from "@/types/Liturgy";
import { LiturgyItemTypeEnum } from "@/enums/LiturgyItemTypeEnum";

const saved = ref<LiturgyItem[]>([]);
let nextId = 0;

vi.mock("../../i18n", () => ({
  useLiturgyI18n: () => ({ t: (key: string) => key, locale: ref("pt") }),
  chaveLiturgia: (key: string) => key,
}));
vi.mock("../useLiturgyExecution", () => ({ useLiturgyExecution: () => ({}) }));
vi.mock("@/composables/useBroadcastListener", () => ({ useBroadcastListener: vi.fn() }));
vi.mock("@/composables/useMusicCatalog", () => ({
  useMusicCatalog: () => ({ musics: computed(() => []) }),
}));
vi.mock("@/helpers/Overlay", () => ({ readAllSlots: async () => [] }));
vi.mock("@/helpers/Alert", () => ({
  default: { yesno: (_data: unknown, callback: (_answer: string) => void) => callback("yes") },
}));
vi.mock("@/helpers/Liturgy", () => ({
  default: {
    list: () => saved.value,
    set: (list: LiturgyItem[]) => {
      saved.value = list;
    },
    add: (data: LiturgyItem) => {
      saved.value = [...saved.value, { ...data, id: `item-${++nextId}` }];
    },
    update: (id: string, data: Partial<LiturgyItem>) => {
      saved.value = saved.value.map((entry) => (entry.id === id ? { ...entry, ...data } : entry));
    },
    insert: (data: LiturgyItem, _day: number, index: number) => {
      saved.value.splice(index, 0, { ...data, id: `item-${++nextId}` });
    },
    isCheckedToday: (entry: LiturgyItem) => entry.checked === "done",
    remove: (id: string) => {
      saved.value = saved.value.filter((entry) => entry.id !== id);
    },
  },
}));

import { DEFAULT_FORM, useLiturgyItems } from "../useLiturgyItems";

const item = (id: string, extra: Partial<LiturgyItem> = {}): LiturgyItem => ({
  ...DEFAULT_FORM(),
  id,
  item: id,
  ...extra,
});

const nomes = () => saved.value.map((entry) => entry.item);

describe("item em relação ao bloco", () => {
  beforeEach(() => {
    saved.value = [];
    nextId = 0;
  });

  it("item novo com bloco entra no fim daquele bloco, não no fim da liturgia", () => {
    saved.value = [
      item("a", { tipo: LiturgyItemTypeEnum.BLOCO }),
      item("a1", { blocoId: "a" }),
      item("b", { tipo: LiturgyItemTypeEnum.BLOCO }),
      item("b1", { blocoId: "b" }),
    ];
    const ui = useLiturgyItems(ref(0), ref([]));
    ui.openItemDialog();
    ui.setFormField("item", "a2");
    ui.setFormField("blocoId", "a");
    ui.saveItem();

    expect(nomes()).toEqual(["a", "a1", "a2", "b", "b1"]);
    expect(saved.value[2].blocoId).toBe("a");
  });

  it("item novo com bloco no fim da liturgia continua no fim", () => {
    saved.value = [item("a", { tipo: LiturgyItemTypeEnum.BLOCO }), item("a1", { blocoId: "a" })];
    const ui = useLiturgyItems(ref(0), ref([]));
    ui.openItemDialog();
    ui.setFormField("item", "a2");
    ui.setFormField("blocoId", "a");
    ui.saveItem();

    expect(nomes()).toEqual(["a", "a1", "a2"]);
  });

  it("item novo sem bloco continua indo para o fim da liturgia", () => {
    saved.value = [item("a", { tipo: LiturgyItemTypeEnum.BLOCO }), item("a1", { blocoId: "a" })];
    const ui = useLiturgyItems(ref(0), ref([]));
    ui.openItemDialog();
    ui.setFormField("item", "solto");
    ui.saveItem();

    expect(nomes()).toEqual(["a", "a1", "solto"]);
  });

  it("trocar de bloco na edição move o item para o fim do bloco novo", () => {
    saved.value = [
      item("a", { tipo: LiturgyItemTypeEnum.BLOCO }),
      item("a1", { blocoId: "a" }),
      item("a2", { blocoId: "a" }),
      item("b", { tipo: LiturgyItemTypeEnum.BLOCO }),
      item("b1", { blocoId: "b" }),
    ];
    const ui = useLiturgyItems(ref(0), ref([]));
    ui.openItemDialog(1);
    ui.setFormField("blocoId", "b");
    ui.saveItem();

    expect(nomes()).toEqual(["a", "a2", "b", "b1", "a1"]);
    expect(saved.value[4].blocoId).toBe("b");

    const tela = ui.items.value.map((entry) => entry.id);
    expect(tela).toEqual(["a", "a2", "b", "b1", "a1"]);
    expect(ui.items.value.at(-1)).toMatchObject({ id: "a1", blocoId: "b" });
    expect(ui.items.value.at(-2)).toMatchObject({ id: "b1", blocoId: "b" });
  });

  it("editar sem mexer no campo Bloco preserva a posição", () => {
    saved.value = [
      item("a", { tipo: LiturgyItemTypeEnum.BLOCO }),
      item("a1", { blocoId: "a" }),
      item("b", { tipo: LiturgyItemTypeEnum.BLOCO }),
    ];
    const ui = useLiturgyItems(ref(0), ref([]));
    ui.openItemDialog(1);
    ui.setFormField("item", "a1 renomeado");
    ui.saveItem();

    expect(saved.value.map((entry) => entry.id)).toEqual(["a", "a1", "b"]);
    expect(saved.value[1].item).toBe("a1 renomeado");
  });

  it("sair do bloco leva o item para o fim da seção em que ele estava", () => {
    saved.value = [
      item("a", { tipo: LiturgyItemTypeEnum.BLOCO }),
      item("a1", { blocoId: "a" }),
      item("a2", { blocoId: "a" }),
      item("b", { tipo: LiturgyItemTypeEnum.BLOCO }),
      item("b1", { blocoId: "b" }),
    ];
    const ui = useLiturgyItems(ref(0), ref([]));
    ui.openItemDialog(1);
    ui.setFormField("blocoId", "");
    ui.saveItem();

    expect(nomes()).toEqual(["a", "a2", "a1", "b", "b1"]);
    expect(saved.value[2].blocoId).toBe("");
  });

  it("sair do bloco com o item já no fim da seção não move nada", () => {
    saved.value = [
      item("a", { tipo: LiturgyItemTypeEnum.BLOCO }),
      item("a1", { blocoId: "a" }),
      item("b", { tipo: LiturgyItemTypeEnum.BLOCO }),
    ];
    const ui = useLiturgyItems(ref(0), ref([]));
    ui.openItemDialog(1);
    ui.setFormField("blocoId", "");
    ui.saveItem();

    expect(nomes()).toEqual(["a", "a1", "b"]);
  });

  it("vincular um item que está antes do cabeçalho leva ele para o fim da seção", () => {
    saved.value = [item("solto"), item("a", { tipo: LiturgyItemTypeEnum.BLOCO })];
    const ui = useLiturgyItems(ref(0), ref([]));
    ui.openItemDialog(0);
    ui.setFormField("blocoId", "a");
    ui.saveItem();

    expect(nomes()).toEqual(["a", "solto"]);
    expect(saved.value[1].blocoId).toBe("a");
  });

  it("item que já estava na seção do bloco destino é levado ao fim dele na troca", () => {
    saved.value = [
      item("a", { tipo: LiturgyItemTypeEnum.BLOCO }),
      item("a1", { blocoId: "a" }),
      item("b", { tipo: LiturgyItemTypeEnum.BLOCO }),
      item("b1", { blocoId: "b" }),
      item("hospede", { blocoId: "a" }),
      item("b2", { blocoId: "b" }),
    ];
    const ui = useLiturgyItems(ref(0), ref([]));
    ui.openItemDialog(4);
    expect(ui.form.value.blocoId).toBe("a");
    ui.setFormField("blocoId", "b");
    ui.saveItem();

    expect(nomes()).toEqual(["a", "a1", "b", "b1", "b2", "hospede"]);
    expect(ui.items.value.at(-1)).toMatchObject({ id: "hospede", blocoId: "b" });
  });

  it("item sem bloco que entra num bloco vai logo abaixo do cabeçalho, acima dos soltos", () => {
    saved.value = [
      item("bloco-1", { tipo: LiturgyItemTypeEnum.BLOCO }),
      item("solto-2"),
      item("solto-3"),
      item("solto-4"),
      item("solto-5"),
      item("solto-6"),
      item("bloco-2", { tipo: LiturgyItemTypeEnum.BLOCO }),
    ];
    const ui = useLiturgyItems(ref(0), ref([]));
    ui.openItemDialog(3);
    ui.setFormField("blocoId", "bloco-1");
    ui.saveItem();

    expect(nomes()).toEqual([
      "bloco-1",
      "solto-4",
      "solto-2",
      "solto-3",
      "solto-5",
      "solto-6",
      "bloco-2",
    ]);
    expect(ui.items.value[1]).toMatchObject({ id: "solto-4", blocoId: "bloco-1" });
  });
});
