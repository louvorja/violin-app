import { onBeforeUnmount, watch } from "vue";
import $appdata from "@/helpers/AppData";
import Hotkeys from "@/helpers/Hotkeys";
import { KEYS } from "@/constants/UserDataKeys";
import { ModuleEnum } from "@/enums/ModuleEnum";
import type { Step } from "./useLiveNavigation";

/**
 * Passador de slides (clicker) e teclado no modo apresentação. Um passador
 * genérico é um teclado de poucas teclas: PageDown/PageUp, setas, às vezes
 * Espaço; "B" ou "." para a tela preta. Todas levam ao mesmo Anterior/Próximo
 * das saídas — música, versículo, pasta, vídeo da lista.
 *
 * Só vale com a aba do modo apresentação à vista: nos atalhos do app, o
 * último registrado vence a tecla mesmo sem fazer nada, e com o módulo aberto
 * em outra aba ele roubaria as setas do player de músicas.
 */

const NEXT = ["PageDown", "ArrowRight", "ArrowDown", "Space"];
const PREV = ["PageUp", "ArrowLeft", "ArrowUp"];
const BLACK = ["b", "."];

export function useClicker(actions: { navigate: (to: Step) => void; toggleBlack: () => void }): void {
  const next = () => actions.navigate("next");
  const prev = () => actions.navigate("prev");
  const black = () => actions.toggleBlack();
  const bindings: [string, () => void, string][] = [
    ...NEXT.map((k): [string, () => void, string] => [k, next, "hotkeys.presentation_next"]),
    ...PREV.map((k): [string, () => void, string] => [k, prev, "hotkeys.presentation_prev"]),
    ...BLACK.map((k): [string, () => void, string] => [k, black, "hotkeys.presentation_black"]),
  ];

  let registered = false;
  function setActive(active: boolean): void {
    if (active === registered) return;
    registered = active;
    for (const [combo, handler, description] of bindings) {
      if (active) Hotkeys.register(combo, handler, { context: "live", description, group: "presentation", label: combo });
      else Hotkeys.unregister(combo, handler);
    }
  }

  const stop = watch(
    () => $appdata.get<string>(KEYS.SHELL.ACTIVE_MODULE, "") === ModuleEnum.PRESENTATION_MODE,
    setActive,
    { immediate: true }
  );
  onBeforeUnmount(() => {
    stop();
    setActive(false);
  });
}
