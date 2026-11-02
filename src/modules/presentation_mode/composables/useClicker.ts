import { onBeforeUnmount, watch } from "vue";
import $appdata from "@/helpers/AppData";
import Hotkeys from "@/helpers/Hotkeys";
import { KEYS } from "@/constants/UserDataKeys";
import { ModuleEnum } from "@/enums/ModuleEnum";
import type { Step } from "./useLiveNavigation";

/**
 * Passador de slides (clicker) e teclado no modo apresentação. Um passador
 * genérico é um teclado de poucas teclas: PageDown/PageUp, setas, às vezes
 * Espaço; "B" ou "." para a tela preta. No teclado ainda valem K (reproduzir),
 * M (silenciar) e Enter (enviar o próximo item). Todas levam ao mesmo Anterior/Próximo
 * das saídas — música, versículo, pasta, vídeo da lista.
 *
 * Só vale com a aba do modo apresentação à vista: nos atalhos do app, o
 * último registrado vence a tecla mesmo sem fazer nada, e com o módulo aberto
 * em outra aba ele roubaria as setas do player de músicas.
 */

const NEXT = ["PageDown", "ArrowRight", "ArrowDown", "Space"];
const PREV = ["PageUp", "ArrowLeft", "ArrowUp"];
const BLACK = ["b", "."];
/** Controle focado que já faz algo com o Enter: a tecla é dele. */
const OWNS_ENTER =
  'button, a[href], select, summary, [role="button"], [role="menuitem"], [role="option"], [role="tab"], [role="switch"], [role="checkbox"]';

export function useClicker(actions: {
  navigate: (to: Step) => void;
  toggleBlack: () => void;
  /** Enter: envia o próximo item do programa. */
  send?: () => void;
  /** K: reproduzir/pausar o que está no ar. */
  togglePlay?: () => void;
  /** M: silenciar. */
  toggleMute?: () => void;
  /** + − 0: zoom da imagem ou página de PDF no ar. */
  zoomIn?: () => void;
  zoomOut?: () => void;
  zoomFit?: () => void;
  /** 1: tamanho real (ou 2×). */
  zoomDetail?: () => void;
}): void {
  // A tecla é só daqui: outro ouvinte na janela (o player de músicas montado
  // depois dos atalhos) passaria o slide de novo.
  type Handler = (e?: KeyboardEvent) => void;
  const own =
    (run: () => void): Handler =>
    (e) => {
      // Alça de redimensionar em foco: as setas são dela (largura e altura dos painéis).
      if (document.activeElement?.getAttribute("role") === "separator") return;
      e?.stopImmediatePropagation();
      run();
    };
  const next = own(() => actions.navigate("next"));
  const prev = own(() => actions.navigate("prev"));
  const black = own(() => actions.toggleBlack());
  const play = own(() => actions.togglePlay?.());
  const mute = own(() => actions.toggleMute?.());
  // Enter não cancela o padrão de saída: num botão em foco, o clique dele vale.
  const send: Handler = (e) => {
    if (!actions.send || document.activeElement?.closest?.(OWNS_ENTER)) return;
    e?.preventDefault();
    e?.stopImmediatePropagation();
    actions.send();
  };
  const bindings: [string, Handler, string, boolean?][] = [
    ...NEXT.map((k): [string, Handler, string] => [k, next, "hotkeys.presentation_next"]),
    ...PREV.map((k): [string, Handler, string] => [k, prev, "hotkeys.presentation_prev"]),
    ...BLACK.map((k): [string, Handler, string] => [k, black, "hotkeys.presentation_black"]),
    ["Enter", send, "hotkeys.presentation_send", false],
    ["k", play, "hotkeys.presentation_play"],
    ["m", mute, "hotkeys.presentation_mute"],
  ];

  /*
   * + − 0 não passam pelo Hotkeys: ele separa a combinação pelo "+". O "+"
   * vem com Shift em muitos teclados e o "=" é a mesma tecla sem ele.
   */
  const ZOOM_KEYS: Record<string, (() => void) | undefined> = {
    "+": actions.zoomIn,
    "=": actions.zoomIn,
    "-": actions.zoomOut,
    _: actions.zoomOut,
    "0": actions.zoomFit,
    "1": actions.zoomDetail,
  };
  const onZoomKey = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const el = document.activeElement as HTMLElement | null;
    if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
    if (el?.closest?.("[data-dismissable-layer]")) return;
    const run = ZOOM_KEYS[e.key];
    if (!run) return;
    e.preventDefault();
    run();
  };

  let registered = false;
  function setActive(active: boolean): void {
    if (active === registered) return;
    registered = active;
    if (active) window.addEventListener("keydown", onZoomKey);
    else window.removeEventListener("keydown", onZoomKey);
    for (const [combo, handler, description, preventDefault] of bindings) {
      if (active)
        Hotkeys.register(combo, handler, {
          context: "live",
          description,
          group: "presentation",
          label: combo,
          preventDefault,
        });
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
