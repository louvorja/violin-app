/**
 * Projeção do **Sorteio** no desktop.
 *
 * A app remota não abre uma WebView local: o botão "Projetar Sorteio" deve
 * comandar a mesma janela/camada usada pelo botão Projetar da ribbon. A regra
 * de janela vs. Projeção de Fundo fica em `useScreenProjection`, a mesma dos
 * utilitários.
 */
import { useScreenProjection } from "@/composables/useScreenProjection";

const DRAW_ROUTE = "/projection/module?module=draw";

/** Cria o controlador uma única vez na janela principal. */
export function createDrawProjection() {
  return useScreenProjection({
    feature: () => "draw",
    route: () => DRAW_ROUTE,
    // undefined deixa `Projection.open` resolver o monitor preferido/fallback.
    monitorId: () => undefined,
    fullscreen: () => true,
    alwaysOnTop: () => false,
  });
}

export type DrawProjection = ReturnType<typeof createDrawProjection>;
export { DRAW_ROUTE };
