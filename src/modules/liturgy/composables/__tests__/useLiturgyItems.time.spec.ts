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
      saved.value = saved.value.map((item) => (item.id === id ? { ...item, ...data } : item));
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

describe("campo Hora da liturgia", () => {
  beforeEach(() => {
    saved.value = [];
    nextId = 0;
  });

  it("cria, edita e limpa uma hora manual sem salvar horas calculadas", () => {
    const ui = useLiturgyItems(ref(0), ref([]));
    ui.openItemDialog();
    ui.setFormField("item", "Manual");
    ui.setFormField("time", "19:30");
    ui.setFormField("duration", 5);
    ui.saveItem();
    expect(saved.value[0]).toMatchObject({ time: "19:30", time_mode: "manual" });
    ui.openItemDialog(0);
    expect(ui.form.value.time).toBe("19:30");
    ui.setFormField("time", "20:15");
    ui.saveItem();
    expect(saved.value[0].time).toBe("20:15");
    ui.openItemDialog(0);
    ui.setFormField("time", "");
    ui.saveItem();
    expect(saved.value[0]).toMatchObject({ time: "", time_mode: "auto" });
    expect(ui.items.value[0].time).toBe("");
  });

  it("preenche e sincroniza a hora do título, mas respeita ajuste e limpeza explícitos", () => {
    const ui = useLiturgyItems(ref(0), ref([]));
    ui.openItemDialog();
    ui.setFormField("item", "08:30 Louvor");
    expect(ui.form.value.time).toBe("08:30");
    ui.setFormField("item", "Louvor às 9h");
    expect(ui.form.value.time).toBe("09:00");
    ui.setFormField("item", "Louvor sem horário");
    expect(ui.form.value.time).toBe("");
    ui.setFormField("item", "09:30 Louvor");
    ui.setFormField("time", "10:15");
    ui.setFormField("item", "11:30 Louvor");
    expect(ui.form.value.time).toBe("10:15");
    ui.setFormField("time", "");
    ui.setFormField("item", "12:30 Louvor");
    expect(ui.form.value.time).toBe("");
    ui.saveItem();
    expect(saved.value[0]).toMatchObject({ item: "12:30 Louvor", time: "", time_mode: "auto" });
    const reopened = useLiturgyItems(ref(0), ref([]));
    reopened.openItemDialog(0);
    expect(reopened.form.value.time).toBe("");
    reopened.setFormField("item", "13:30 Louvor");
    expect(reopened.form.value.time).toBe("13:30");
    reopened.setFormField("time", "");
    reopened.setFormField("item", "14:30 Louvor");
    expect(reopened.form.value.time).toBe("");
  });

  it("salva a hora inferida como âncora manual e preserva a escolha ao reabrir", () => {
    const ui = useLiturgyItems(ref(0), ref([]));
    ui.openItemDialog();
    ui.setFormField("item", "8h30 Louvor");
    ui.saveItem();
    expect(saved.value[0]).toMatchObject({
      item: "8h30 Louvor",
      time: "08:30",
      time_mode: "manual",
    });
    const reopened = useLiturgyItems(ref(0), ref([]));
    reopened.openItemDialog(0);
    expect(reopened.form.value.time).toBe("08:30");
    reopened.setFormField("item", "9h30 Louvor");
    expect(reopened.form.value.time).toBe("08:30");
  });

  it("preenche legado sem escolha anterior somente no formulário e preserva âncora legada", () => {
    saved.value = [
      item("legado", { item: "08:30 Louvor", time_mode: undefined }),
      item("manual", { item: "09:30 Sermão", time: "10:00", time_mode: undefined }),
    ];
    const ui = useLiturgyItems(ref(0), ref([]));
    ui.openItemDialog(0);
    expect(ui.form.value.time).toBe("08:30");
    expect(saved.value[0]).toMatchObject({ time: "", time_mode: undefined });
    ui.openItemDialog(1);
    expect(ui.form.value.time).toBe("10:00");
  });

  it("infere o horário do bloco e deixa o filho gerenciado mesmo com horário no título", () => {
    const ui = useLiturgyItems(ref(0), ref([]));
    ui.quickAdd(LiturgyItemTypeEnum.BLOCO);
    ui.setFormField("item", "8h Bloco");
    ui.saveItem();
    expect(saved.value[0]).toMatchObject({ time: "08:00", time_mode: "manual" });
    ui.openItemDialog();
    ui.setFormField("item", "09:30 Filho");
    expect(ui.form.value.time).toBe("09:30");
    ui.setFormField("blocoId", saved.value[0].id);
    expect(ui.form.value.time).toBe("");
    ui.setFormField("item", "10h30 Filho");
    expect(ui.form.value.time).toBe("");
    ui.saveItem();
    expect(saved.value[1]).toMatchObject({ time: "", time_mode: "auto" });
    expect(ui.items.value[1].time).toBe("08:00");
  });

  it("fixa a inferência legada antes de editar duração e não converte hora calculada do formulário em manual", () => {
    saved.value = [
      item("inicio", { time: "08:00", time_mode: undefined, duration: 5 }),
      item("auto", { time: "08:05", time_mode: undefined, duration: 5 }),
    ];
    const ui = useLiturgyItems(ref(0), ref([]));
    ui.openItemDialog(0);
    ui.setFormField("duration", 15);
    ui.saveItem();
    expect(ui.items.value[1].time).toBe("08:15");
    expect(saved.value[1]).toMatchObject({ time: "", time_mode: "auto" });
    ui.openItemDialog(1);
    expect(ui.form.value.time).toBe("");
    ui.setFormField("item", "Renomeado");
    ui.saveItem();
    ui.openItemDialog(0);
    ui.setFormField("duration", 20);
    ui.saveItem();
    expect(ui.items.value[1].time).toBe("08:20");
  });

  it("horário de item vinculado é automático e desvincular não cria uma âncora", () => {
    saved.value = [
      item("bloco", { tipo: LiturgyItemTypeEnum.BLOCO, time: "10:00", time_mode: "manual" }),
      item("filho", { blocoId: "bloco", duration: 5 }),
    ];
    const ui = useLiturgyItems(ref(0), ref([]));
    ui.openItemDialog(1);
    expect(ui.form.value.time).toBe("10:00");
    ui.setFormField("duration", 10);
    ui.saveItem();
    expect(saved.value[1]).toMatchObject({ time: "", time_mode: "auto" });
    ui.openItemDialog(1);
    ui.setFormField("blocoId", "");
    expect(ui.form.value.time).toBe("");
    ui.saveItem();
    expect(saved.value[1]).toMatchObject({ time: "", time_mode: "auto", blocoId: "" });
  });

  it("clonar um item automático legado recalcula os seguintes", () => {
    saved.value = [
      item("inicio", { time: "08:00", time_mode: undefined, duration: 5 }),
      item("auto", { time: "08:05", time_mode: undefined, duration: 5 }),
      item("fim", { time: "08:10", time_mode: undefined }),
    ];
    const ui = useLiturgyItems(ref(0), ref([]));
    ui.cloneItem(1);
    expect(ui.items.value.map((entry) => entry.time)).toEqual(["08:00", "08:05", "08:10", "08:15"]);
    expect(
      saved.value.slice(1).every((entry) => entry.time === "" && entry.time_mode === "auto")
    ).toBe(true);
  });

  it("reordena a lista exibida sem persistir os horários calculados", () => {
    saved.value = [
      item("inicio", { time: "08:00", time_mode: "manual", duration: 5 }),
      item("curto", { time_mode: "auto", duration: 3 }),
      item("longo", { time_mode: "auto", duration: 10 }),
    ];
    const ui = useLiturgyItems(ref(0), ref([]));
    const [first, short, long] = ui.items.value;
    ui.onReorder([first, long, short]);
    expect(saved.value.map((entry) => entry.time)).toEqual(["08:00", "", ""]);
    expect(ui.items.value.map((entry) => entry.time)).toEqual(["08:00", "08:05", "08:15"]);
  });

  it("remover item concluído recalcula a continuação legada", () => {
    saved.value = [
      item("bloco", { tipo: LiturgyItemTypeEnum.BLOCO, time: "08:00", time_mode: undefined }),
      item("concluido", { checked: "done", time: "08:00", time_mode: undefined, duration: 5 }),
      item("seguinte", { time: "08:05", time_mode: undefined }),
    ];
    const ui = useLiturgyItems(ref(0), ref([]));
    ui.removeDone();
    expect(ui.items.value[1].time).toBe("08:00");
    expect(saved.value[1]).toMatchObject({ time: "", time_mode: "auto" });
  });

  it("remover bloco desvincula o filho sem transformar sua hora calculada em manual", () => {
    saved.value = [
      item("bloco", { tipo: LiturgyItemTypeEnum.BLOCO, time: "08:00", time_mode: undefined }),
      item("filho", { blocoId: "bloco", time: "08:00", time_mode: undefined }),
    ];
    const ui = useLiturgyItems(ref(0), ref([]));
    ui.confirmRemove(0);
    expect(saved.value[0]).toMatchObject({ time: "", time_mode: "auto" });
    expect(saved.value[0].blocoId).toBeUndefined();
    expect(ui.items.value[0].time).toBe("");
  });
});
