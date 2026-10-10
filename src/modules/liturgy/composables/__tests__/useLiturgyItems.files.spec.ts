import { beforeEach, describe, expect, it, vi } from "vitest";
import { computed, ref } from "vue";
import type { LiturgyItem } from "@/types/Liturgy";
import { LiturgyItemTypeEnum } from "@/enums/LiturgyItemTypeEnum";

const mocks = vi.hoisted(() => ({
  importFile: vi.fn(),
  removeFile: vi.fn(),
  validateFile: vi.fn(),
  platform: { isDesktop: false, api: { storage: { chooseFile: vi.fn() } } },
}));
const saved = ref<LiturgyItem[]>([]);
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
vi.mock("@/helpers/Platform", () => ({ default: mocks.platform }));
vi.mock("@/helpers/LiturgyFiles", () => ({
  importLiturgyFile: mocks.importFile,
  removeLiturgyFile: mocks.removeFile,
  validateLiturgyFile: mocks.validateFile,
  LITURGY_FILE_ACCEPT: ".png,.mp4",
}));
vi.mock("@/helpers/Liturgy", () => ({
  default: {
    list: () => saved.value,
    set: (list: LiturgyItem[]) => {
      saved.value = list;
    },
    add: (data: LiturgyItem) => {
      saved.value = [...saved.value, { ...data, id: "item-1" }];
    },
    update: (id: string, data: Partial<LiturgyItem>) => {
      saved.value = saved.value.map((item) => (item.id === id ? { ...item, ...data } : item));
    },
  },
}));
import { DEFAULT_FORM, useLiturgyItems } from "../useLiturgyItems";

async function select(ui: ReturnType<typeof useLiturgyItems>, name = "aviso.png") {
  const create = vi.spyOn(document, "createElement");
  await ui.chooseFile();
  const input = create.mock.results.at(-1)?.value as HTMLInputElement;
  create.mockRestore();
  const file = new File(["bytes"], name, { type: "image/png" });
  Object.defineProperty(input, "files", { value: [file] });
  input.dispatchEvent(new Event("change"));
  return file;
}
function form() {
  const ui = useLiturgyItems(ref(0), ref([]));
  ui.quickAdd(LiturgyItemTypeEnum.ARQUIVO);
  ui.setFormField("item", "Aviso");
  return ui;
}
beforeEach(() => {
  vi.clearAllMocks();
  saved.value = [];
  mocks.platform.isDesktop = false;
  mocks.importFile.mockImplementation(async (file: File) => ({
    dir: file.name,
    ref_id: "new-ref",
  }));
  mocks.removeFile.mockResolvedValue(undefined);
});

describe("seletor de arquivos da liturgia", () => {
  it("persiste somente a última seleção ao salvar e mantém a referência ao reabrir", async () => {
    const ui = form();
    await select(ui, "primeiro.png");
    const last = await select(ui, "segundo.png");
    expect(mocks.importFile).not.toHaveBeenCalled();
    await ui.saveItem();
    expect(mocks.importFile).toHaveBeenCalledExactlyOnceWith(last);
    expect(saved.value[0]).toMatchObject({ dir: "segundo.png", ref_id: "new-ref" });
    ui.openItemDialog(0);
    expect(ui.form.value.ref_id).toBe("new-ref");
    ui.dialog.value = false;
    expect(mocks.removeFile).not.toHaveBeenCalled();
  });

  it("cancelar, trocar tipo ou editar caminho não grava nem remove arquivos salvos", async () => {
    const ui = form();
    await select(ui);
    ui.dialog.value = false;
    expect(mocks.importFile).not.toHaveBeenCalled();
    saved.value = [
      {
        ...DEFAULT_FORM(),
        id: "old",
        tipo: LiturgyItemTypeEnum.ARQUIVO,
        item: "Salvo",
        dir: "salvo.png",
        ref_id: "old-ref",
      },
    ];
    ui.openItemDialog(0);
    await select(ui);
    ui.setFormField("dir", "C:\\LouvorJA\\outro.png");
    await ui.saveItem();
    expect(saved.value[0]).toMatchObject({ dir: "C:\\LouvorJA\\outro.png", ref_id: undefined });
    expect(mocks.importFile).not.toHaveBeenCalled();
    expect(mocks.removeFile).not.toHaveBeenCalled();
    ui.openItemDialog();
    await select(ui);
    ui.setFormField("tipo", LiturgyItemTypeEnum.ANOTACAO);
    ui.onTypeChange();
    ui.setFormField("item", "Nota");
    await ui.saveItem();
    expect(mocks.importFile).not.toHaveBeenCalled();
  });

  it("cancelar durante a gravação remove somente o novo arquivo e não salva formulário antigo", async () => {
    let finish!: (_result: { dir: string; ref_id: string }) => void;
    mocks.importFile.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const ui = form();
    await select(ui);
    const saving = ui.saveItem();
    expect(ui.fileImporting.value).toBe(true);
    await ui.saveItem();
    await ui.chooseFile();
    expect(mocks.importFile).toHaveBeenCalledOnce();
    ui.dialog.value = false;
    ui.openItemDialog();
    ui.setFormField("item", "Novo formulário");
    finish({ dir: "aviso.png", ref_id: "abandoned-ref" });
    await saving;
    expect(mocks.removeFile).toHaveBeenCalledExactlyOnceWith("abandoned-ref");
    expect(saved.value).toEqual([]);
    expect(ui.form.value.item).toBe("Novo formulário");
    expect(ui.fileImporting.value).toBe(false);
  });

  it("mantém o diálogo e permite nova tentativa quando a gravação falha", async () => {
    mocks.importFile.mockRejectedValueOnce(new Error("quota"));
    const ui = form();
    await select(ui);
    await ui.saveItem();
    expect(saved.value).toEqual([]);
    expect(ui.dialog.value).toBe(true);
    expect(ui.formErrors.value.dir).toBe("alerts.file_import_failed");
    await ui.saveItem();
    expect(saved.value[0].ref_id).toBe("new-ref");
  });

  it("o seletor desktop conserva o caminho e limpa a seleção web antiga", async () => {
    mocks.platform.isDesktop = true;
    mocks.platform.api.storage.chooseFile.mockResolvedValue("C:\\Culto\\aviso.png");
    const ui = form();
    await ui.chooseFile();
    await ui.saveItem();
    expect(saved.value[0].dir).toBe("C:\\Culto\\aviso.png");
    expect(mocks.importFile).not.toHaveBeenCalled();
  });
});
