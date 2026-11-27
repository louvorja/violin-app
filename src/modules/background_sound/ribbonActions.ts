/**
 * Ações da guia contextual do Som de Fundo.
 *
 * O manifesto escreve `<módulo>_<ação>` e a RibbonBar devolve só `<ação>` ao
 * módulo. Com o nome escrito à mão nas duas pontas, "Tocar aleatório" saía do
 * manifesto como `play_random` e era esperado como `random`: o botão não fazia
 * nada, sem erro. Aqui o nome existe uma vez, e o tipo obriga a tela a tratar
 * todas as ações.
 */
export const RIBBON_ACTION = {
  PLAY: "play",
  STOP: "stop",
  STOP_IMMEDIATELY: "stop_immediately",
  PLAY_RANDOM: "play_random",
  ADD_AUDIO: "add_audio",
  MANAGE_CATEGORIES: "manage_categories",
} as const;

export type RibbonAction = (typeof RIBBON_ACTION)[keyof typeof RIBBON_ACTION];

export type RibbonActionHandlers = Record<RibbonAction, () => void>;

/** Executa a ação pedida pela ribbon; `false` quando o nome não é deste módulo. */
export function runRibbonAction(action: unknown, handlers: RibbonActionHandlers): boolean {
  if (typeof action !== "string" || !Object.hasOwn(handlers, action)) return false;
  handlers[action as RibbonAction]();
  return true;
}
