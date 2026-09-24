"use strict";

// A prioridade descreve a intenção, não o processo que executa o trabalho.
// Em particular, um download pedido pelo operador é INTERACTIVE mesmo quando
// sua transferência acontece em um processo utilitário.
const WorkPriority = Object.freeze({
  CRITICAL: "critical",
  INTERACTIVE: "interactive",
  BACKGROUND: "background",
});

function canStartWork(priority, presentationActive) {
  if (!Object.values(WorkPriority).includes(priority)) {
    throw new TypeError("Prioridade de trabalho inválida");
  }
  return priority !== WorkPriority.BACKGROUND || presentationActive !== true;
}

module.exports = { WorkPriority, canStartWork };
