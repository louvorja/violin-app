import { describe, expect, it } from "vitest";
import { defineComponent, h, ref } from "vue";
import LjTextarea from "../LjTextarea.vue";
import LjField from "../LjField.vue";
import { mountUi } from "./mountUi";

describe("LjTextarea", () => {
  it("renderiza um <textarea> real, não um contenteditable", () => {
    const w = mountUi(LjTextarea);
    expect(w.element.tagName).toBe("TEXTAREA");
  });

  it("leva o id ao textarea, para o rótulo do LjField ter destino", () => {
    const w = mountUi(LjTextarea, { props: { id: "obs" } });
    expect(w.attributes("id")).toBe("obs");
    expect((w.element as HTMLTextAreaElement).id).toBe("obs");
  });

  it("dentro do LjField, clicar no rótulo encontra o campo pelo for/id", () => {
    const w = mountUi(LjField, {
      props: { label: "Observações", htmlFor: "obs" },
      slots: { default: () => h(LjTextarea, { id: "obs" }) },
    });

    const label = w.get("label");
    const textarea = w.get("textarea");
    expect(label.attributes("for")).toBe("obs");
    expect(textarea.attributes("id")).toBe(label.attributes("for"));
    // Sem id no textarea o rótulo aponta para o nada — é o defeito que este caso trava.
    expect(textarea.attributes("id")).toBeDefined();
  });

  it("sem id não inventa um — o atributo simplesmente não aparece", () => {
    expect(mountUi(LjTextarea).attributes("id")).toBeUndefined();
  });

  it("mostra o valor recebido por modelValue", () => {
    const w = mountUi(LjTextarea, { props: { modelValue: "primeira estrofe" } });
    expect((w.element as HTMLTextAreaElement).value).toBe("primeira estrofe");
  });

  it("v-model: digitar emite update:modelValue com o texto digitado", async () => {
    const w = mountUi(LjTextarea, { props: { modelValue: "" } });
    await w.setValue("Cristo vem");

    const eventos = w.emitted("update:modelValue");
    expect(eventos).toHaveLength(1);
    expect(eventos?.[0]).toEqual(["Cristo vem"]);
  });

  it("v-model: apagar tudo emite string vazia, não undefined", async () => {
    const w = mountUi(LjTextarea, { props: { modelValue: "algo" } });
    await w.setValue("");
    expect(w.emitted("update:modelValue")?.[0]).toEqual([""]);
  });

  it("v-model: preserva quebras de linha, que é o motivo de existir um textarea", async () => {
    const w = mountUi(LjTextarea, { props: { modelValue: "" } });
    await w.setValue("verso 1\nverso 2");
    expect(w.emitted("update:modelValue")?.[0]).toEqual(["verso 1\nverso 2"]);
  });

  it("v-model completo: o valor volta do pai para a tela", async () => {
    const Pai = defineComponent({
      setup() {
        const texto = ref("inicial");
        return () =>
          h(LjTextarea, {
            modelValue: texto.value,
            "onUpdate:modelValue": (v: string) => (texto.value = v),
          });
      },
    });

    const w = mountUi(Pai);
    const campo = w.get("textarea");
    await campo.setValue("editado pelo usuário");
    expect((campo.element as HTMLTextAreaElement).value).toBe("editado pelo usuário");
  });

  it("acompanha modelValue quando o pai troca o valor por fora", async () => {
    const w = mountUi(LjTextarea, { props: { modelValue: "antes" } });
    await w.setProps({ modelValue: "depois" });
    expect((w.element as HTMLTextAreaElement).value).toBe("depois");
  });

  it("usa 4 linhas por padrão e respeita rows quando informado", () => {
    expect((mountUi(LjTextarea).element as HTMLTextAreaElement).rows).toBe(4);
    const w = mountUi(LjTextarea, { props: { rows: 10 } });
    expect((w.element as HTMLTextAreaElement).rows).toBe(10);
  });

  it("repassa o placeholder recebido", () => {
    const w = mountUi(LjTextarea, { props: { placeholder: "Digite a letra" } });
    expect(w.attributes("placeholder")).toBe("Digite a letra");
  });

  it("desabilitado: marca o textarea e não emite alteração", async () => {
    const w = mountUi(LjTextarea, { props: { disabled: true, modelValue: "travado" } });
    expect(w.attributes("disabled")).toBeDefined();
    expect((w.element as HTMLTextAreaElement).disabled).toBe(true);

    // Um textarea desabilitado não recebe input do usuário no navegador; aqui o
    // trigger respeita esse bloqueio, então nenhuma alteração escapa.
    (w.element as HTMLTextAreaElement).value = "tentativa de edição";
    await w.trigger("input");
    expect(w.emitted("update:modelValue")).toBeUndefined();
  });

  it("anuncia aria-invalid apenas quando inválido", async () => {
    const w = mountUi(LjTextarea);
    expect(w.attributes("aria-invalid")).toBeUndefined();

    await w.setProps({ invalid: true });
    expect(w.attributes("aria-invalid")).toBe("true");

    await w.setProps({ invalid: false });
    expect(w.attributes("aria-invalid")).toBeUndefined();
  });

  it("deixa passar os atributos de acessibilidade e de formulário do chamador", () => {
    const w = mountUi(LjTextarea, {
      attrs: {
        "aria-label": "Anotações do culto",
        "aria-describedby": "ajuda-obs",
        name: "observacoes",
        maxlength: "200",
        required: true,
      },
    });

    expect(w.attributes("aria-label")).toBe("Anotações do culto");
    expect(w.attributes("aria-describedby")).toBe("ajuda-obs");
    expect(w.attributes("name")).toBe("observacoes");
    expect((w.element as HTMLTextAreaElement).maxLength).toBe(200);
    expect(w.attributes("required")).toBeDefined();
  });

  it("não injeta texto próprio — o conteúdo é só o que o chamador passou (PT e ES)", () => {
    for (const locale of ["pt", "es"] as const) {
      const w = mountUi(LjTextarea, { props: { modelValue: "" } }, locale);
      // Texto dentro de um <textarea> vira valor inicial: qualquer rótulo
      // hardcoded aqui sujaria o campo do usuário.
      expect(w.element.textContent).toBe("");
      expect((w.element as HTMLTextAreaElement).value).toBe("");
    }
  });
});
