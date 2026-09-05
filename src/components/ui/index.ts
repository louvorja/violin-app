/**
 * Catálogo de primitivos do LouvorJA — inventário fechado.
 *
 * Regra: a UI do app usa exclusivamente estes componentes. Precisou de um
 * controle que não existe aqui? Ele entra neste catálogo primeiro, com página
 * no /ui — não como variação local dentro de uma tela.
 *
 * Os que dependem de foco preso, navegação por teclado, ARIA e portal são
 * construídos sobre Reka UI (headless); os demais são markup e CSS sobre os
 * tokens de `ui.css`.
 */

/* — sem biblioteca — */
export { default as LjAlert } from "./LjAlert.vue";
export { default as LjButton } from "./LjButton.vue";
export { default as LjCalendar } from "./LjCalendar.vue";
export { default as LjCard } from "./LjCard.vue";
export { default as LjCheckbox } from "./LjCheckbox.vue";
export { default as LjChip } from "./LjChip.vue";
export { default as LjDivider } from "./LjDivider.vue";
export { default as LjEmpty } from "./LjEmpty.vue";
export { default as LjField } from "./LjField.vue";
export { default as LjInput } from "./LjInput.vue";
export { default as LjProgress } from "./LjProgress.vue";
export { default as LjSkeleton } from "./LjSkeleton.vue";
export { default as LjSpinner } from "./LjSpinner.vue";
export { default as LjSwitch } from "./LjSwitch.vue";
export { default as LjTable } from "./LjTable.vue";
export { default as LjTextarea } from "./LjTextarea.vue";
export { default as LjToast } from "./LjToast.vue";

/* — sobre Reka UI — */
export { default as LjAccordion } from "./LjAccordion.vue";
export { default as LjCombobox } from "./LjCombobox.vue";
export { default as LjDialog } from "./LjDialog.vue";
export { default as LjDrawer } from "./LjDrawer.vue";
export { default as LjMenu } from "./LjMenu.vue";
export { default as LjPopover } from "./LjPopover.vue";
export { default as LjSelect } from "./LjSelect.vue";
export { default as LjSlider } from "./LjSlider.vue";
export { default as LjTabs } from "./LjTabs.vue";
export { default as LjTooltip } from "./LjTooltip.vue";

export { ICON_SIZE } from "./types";
export type { UiSize } from "./types";
export type { LjMenuItem } from "./LjMenu.vue";
export type { LjTab } from "./LjTabs.vue";
export type { LjAccordionItem } from "./LjAccordion.vue";
export type {
  LjCalendarDay,
  LjCalendarDayClick,
  LjCalendarEventClick,
  LjCalendarMoreClick,
} from "./LjCalendar.vue";
