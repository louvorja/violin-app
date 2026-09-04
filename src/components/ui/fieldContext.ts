import { inject, provide, type InjectionKey, type Ref } from "vue";

/**
 * Ligação entre LjField e o controle que ele embrulha.
 *
 * A associação rótulo↔campo era opt-in — o chamador tinha de passar `htmlFor` e
 * repetir o mesmo id no controle. Ninguém fazia isso, então todo rótulo ficava
 * órfão e o campo, sem nome acessível. Aqui o LjField publica os ids e o
 * controle os consome sozinho; quem quiser continua podendo passar `id` na mão,
 * que tem precedência.
 */
export interface FieldContext {
  /** id do controle, referenciado pelo `for` do rótulo. */
  inputId: Ref<string>;
  /** id da mensagem de erro ou dica, para o aria-describedby do controle. */
  describedById: Ref<string | undefined>;
  /** Há mensagem de erro ativa. */
  invalid: Ref<boolean>;
}

export const FIELD_CONTEXT: InjectionKey<FieldContext> = Symbol("lj-field");

export function provideFieldContext(ctx: FieldContext): void {
  provide(FIELD_CONTEXT, ctx);
}

/** Devolve o contexto do LjField acima, ou null quando o controle está solto. */
export function useFieldContext(): FieldContext | null {
  return inject(FIELD_CONTEXT, null);
}
