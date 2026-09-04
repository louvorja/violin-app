/**
 * Montagem padrão para os testes dos primitivos.
 *
 * Os primitivos traduzem os próprios rótulos acessíveis, então precisam de uma
 * instância real de vue-i18n — com as mensagens de verdade, não um dublê. É o
 * que permite um teste afirmar "o botão de limpar se chama Limpar em PT e
 * Limpiar em ES" e falhar de fato quando a chave não existe.
 */
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { defineComponent, h, type Component } from "vue";
import pt from "@/lang/pt.json";
import es from "@/lang/es.json";

export function makeI18n(locale: "pt" | "es" = "pt") {
  return createI18n({
    legacy: false,
    locale,
    fallbackLocale: "pt",
    messages: { pt, es },
    // Erra alto no teste em vez de devolver a chave crua em silêncio.
    missingWarn: true,
    fallbackWarn: false,
  });
}

/**
 * Icon.vue delega ícones "mdi-" ao <v-icon> do Vuetify, que não é registrado
 * aqui — sem um substituto, todo teste de ícone via ausência onde há ícone.
 * Este dublê mantém a classe e expõe o nome do ícone, que é o que um teste
 * precisa afirmar.
 */
const VIconStub = defineComponent({
  name: "VIcon",
  // Nenhuma prop declarada de propósito: assim `icon`, `class` e o resto caem em
  // attrs e aparecem no DOM como o v-icon de verdade faria, e um teste pode
  // afirmar tanto a classe quanto o nome do ícone.
  setup:
    (_props, { attrs }) =>
    () =>
      h("i", attrs),
});

/**
 * As opções ficam propositalmente frouxas: os genéricos de MountingOptions
 * exigiriam repetir o tipo de props de cada primitivo em cada teste, sem ganho
 * — o que o teste afirma é comportamento, não tipo. O componente, ao contrário,
 * mantém o tipo real, para `setProps` e `vm` continuarem inferidos no teste.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
export function mountUi<T extends Component>(
  component: T,
  options: any = {},
  locale: "pt" | "es" = "pt"
) {
  const globalOpts = options.global || {};
  return mount(component, {
    ...options,
    global: {
      ...globalOpts,
      plugins: [...(globalOpts.plugins || []), makeI18n(locale)],
      components: { VIcon: VIconStub, "v-icon": VIconStub, ...(globalOpts.components || {}) },
    },
  });
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Falha se a chave não existir em pt.json ou es.json — pega rótulo fantasma. */
export function expectKeyExists(path: string): void {
  for (const [name, dict] of [
    ["pt", pt],
    ["es", es],
  ] as const) {
    let cur: unknown = dict;
    for (const part of path.split(".")) {
      if (typeof cur !== "object" || cur === null || !(part in cur)) {
        throw new Error(`chave i18n ausente em ${name}.json: ${path}`);
      }
      cur = (cur as Record<string, unknown>)[part];
    }
  }
}
