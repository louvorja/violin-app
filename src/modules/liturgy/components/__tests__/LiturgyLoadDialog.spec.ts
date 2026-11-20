import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { ref } from "vue";
import type { LiturgyLibraryItem } from "@/types/LiturgyLibrary";

/**
 * Seletor de liturgia compartilhado: o módulo Liturgia carrega no dia ativo;
 * o Modo apresentação usa o mesmo diálogo no modo `pick`, que só devolve a
 * escolhida e não mexe nos dias da liturgia.
 */

const items: LiturgyLibraryItem[] = [
  {
    id: "lit-sabado",
    name: "Culto de sábado",
    color: "#123456",
    items: [{ id: "i1", item: "Abertura" }] as never,
    binding: { type: "day_of_week", value: "6" },
    updatedAt: "2026-11-10T10:00:00Z",
    createdAt: "2026-11-01T10:00:00Z",
  },
  {
    id: "lit-natal",
    name: "Culto de Natal",
    color: "#654321",
    items: [{ id: "i2", item: "Natal" }] as never,
    binding: { type: "date", value: "2026-12-25" },
    updatedAt: "2026-11-12T10:00:00Z",
    createdAt: "2026-11-01T10:00:00Z",
  },
];

const library = {
  loading: ref(false),
  list: vi.fn(async () => items),
  get: vi.fn(async (id: string) => items.find((i) => i.id === id) ?? null),
  getByName: vi.fn(async (_name: string): Promise<{ id: string } | null> => null),
  save: vi.fn(),
  remove: vi.fn(),
};
let answer = "yes";
const yesno = vi.fn((_data: unknown, cb: (_answer: string) => void) => cb(answer));

vi.mock("../../i18n", async () => {
  const { ref: vueRef } = await import("vue");
  const map: Record<string, string> = {
    "library.load_title": "Carregar Liturgia",
    "library.load_search": "Pesquisar",
    "library.load_confirm": "Carregar esta liturgia?",
    "library.load_empty": "Nenhuma liturgia salva.",
    "library.duplicate_prefix": "Cópia de",
    "library.duplicate_prefix_n": "Cópia ({n}) de",
    "library.duplicate_success": 'Liturgia duplicada como "{name}".',
    "library.delete_confirm": 'Excluir a liturgia "<b>{name}</b>"?',
    "library.weekday_saturday": "Sábado",
    "library.manage_binding_13th": "13º Sábado",
    "actions.clone": "Duplicar",
    "actions.delete": "Excluir",
  };
  return {
    useLiturgyI18n: () => ({
      t: (key: string, values?: Record<string, unknown>) => {
        let text = map[key] ?? key;
        for (const [name, value] of Object.entries(values ?? {})) {
          text = text.replace(`{${name}}`, String(value));
        }
        return text;
      },
      locale: vueRef("pt-BR"),
    }),
  };
});
vi.mock("../../composables/useLiturgyLibrary", () => ({
  useLiturgyLibrary: () => library,
  WEEKDAY_KEYS: ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"],
}));
vi.mock("@/helpers/Alert", () => ({
  default: {
    yesno: (...args: unknown[]) => yesno(...(args as [unknown, (_answer: string) => void])),
    info: vi.fn(),
  },
  escapeHtml: (text: string) => String(text),
}));

import LiturgyLoadDialog from "../LiturgyLoadDialog.vue";

const stubs = {
  LjDialog: { props: ["modelValue", "title"], template: "<div><slot /></div>" },
  LjInput: {
    props: ["modelValue"],
    emits: ["update:modelValue"],
    template: '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
  },
  LjButton: { template: "<button><slot /></button>" },
  LjIcon: true,
  LjAlert: { props: ["text"], template: "<p>{{ text }}</p>" },
  LjProgress: true,
};

async function open(props: Record<string, unknown> = {}) {
  const wrapper = mount(LiturgyLoadDialog, {
    props: { modelValue: false, ...props },
    global: { stubs },
  });
  await wrapper.setProps({ modelValue: true });
  await vi.waitFor(() => expect(library.list).toHaveBeenCalled());
  return wrapper;
}

describe("LiturgyLoadDialog", () => {
  it("confirma e devolve a liturgia escolhida", async () => {
    answer = "yes";
    library.list.mockClear();
    library.get.mockClear();

    const wrapper = await open();
    expect(wrapper.text()).toContain("Sábado");
    await wrapper.findAll(".llo-item__main")[0].trigger("click");

    await vi.waitFor(() => expect(wrapper.emitted("picked")).toBeTruthy());
    const picked = wrapper.emitted("picked")![0][0] as {
      id: string;
      items: unknown[];
    };
    expect(picked.id).toBe("lit-sabado");
    expect(picked.items).toHaveLength(1);
  });

  it("cancelar a confirmação não devolve nada", async () => {
    answer = "no";
    const wrapper = await open();
    await wrapper.findAll(".llo-item__main")[0].trigger("click");

    expect(wrapper.emitted("picked")).toBeUndefined();
    // Volta a confirmar para os próximos testes.
    answer = "yes";
  });

  it("a liturgia do dia aparece primeiro e devolve id nulo", async () => {
    library.get.mockClear();
    const optionExtra = {
      name: "Liturgia deste dia (atual)",
      subtitle: "sábado, 15/11",
      items: [{ id: "dia-1", item: "Dia" }] as never,
    };
    const wrapper = await open({ optionExtra });

    const rows = wrapper.findAll(".llo-item__main");
    expect(rows).toHaveLength(3);
    expect(wrapper.text()).toContain("Liturgia deste dia (atual)");
    await rows[0].trigger("click");

    await vi.waitFor(() => expect(wrapper.emitted("picked")).toBeTruthy());
    const picked = wrapper.emitted("picked")![0][0] as { id: string | null; items: unknown[] };
    expect(picked.id).toBeNull();
    expect(picked.items).toHaveLength(1);
    // A opção do dia não é buscada na biblioteca.
    expect(library.get).not.toHaveBeenCalled();
  });

  it("duplicar numera a cópia e avança quando o nome já existe", async () => {
    library.getByName.mockImplementation(async (name: string) =>
      name === "Cópia de Culto de sábado" ? { id: "existente" } : null
    );
    library.save.mockImplementation(async (data: Record<string, unknown>) => ({
      ...data,
      id: "copia-nova",
    }));

    const wrapper = await open();
    const row = wrapper.findAll(".llo-item")[0];
    const botoes = row.findAll("button");
    // [0] escolher, [1] duplicar, [2] excluir.
    await botoes[1].trigger("click");

    await vi.waitFor(() => expect(library.save).toHaveBeenCalledOnce());
    expect(library.save.mock.calls[0][0]).toMatchObject({
      name: "Cópia (2) de Culto de sábado",
    });
    library.getByName.mockResolvedValue(null);
  });
});
