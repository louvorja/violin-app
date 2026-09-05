/**
 * Cores expostas ao JavaScript — manifestos de módulo e botões da ribbon
 * recebem a cor como string e a jogam num `style` inline.
 *
 * São apenas apelidos dos tokens; a definição de cada uma vive em
 * `tokens.css` / `ui.css`, por tema. Manter a indireção em `var()` é o que faz
 * a cor acompanhar a troca de tema, já que o valor é lido no elemento e não
 * congelado aqui.
 */
export const COLORS = {
  PRIMARY: "var(--lj-ui-accent)",
  SECONDARY: "var(--lj-text-muted)",
  SURFACE: "var(--lj-surface-bg)",
  DANGER: "var(--lj-danger)",
  WARNING: "var(--lj-warning)",
};
