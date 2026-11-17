/**
 * Projeção do **Cronômetro** controlada pela API remota.
 *
 * O botão da ribbon usa `useScreenProjection` (componente). A API roda no
 * renderer mas fora de um componente; aqui replicamos a mesma regra:
 * - com a Projeção de Fundo aberta, o utilitário vira uma camada (não janela);
 * - sem fundo, abre/fecha a janela da feature.
 *
 * A feature/rota são as mesmas do manifest (`/projection/module?module=stopwatch`).
 */
import Broadcast from "@/helpers/Broadcast";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import {
  close as closeProjection,
  isOpen as isProjectionOpen,
  open as openProjection,
} from "@/helpers/Projection";
import {
  isBackgroundOpen,
  setUtilitarioNaCamada,
  utilitarioNaCamada,
} from "@/helpers/ProjectionWindows";

const FEATURE = "stopwatch";
const ROUTE = "/projection/module?module=stopwatch";

/** Está no telão? Com o fundo aberto, quem manda é a camada do utilitário. */
export async function isStopwatchProjecting(): Promise<boolean> {
  if (await isBackgroundOpen()) return utilitarioNaCamada() === FEATURE;
  return isProjectionOpen(FEATURE);
}

export async function projectStopwatch(): Promise<void> {
  if (await isBackgroundOpen()) {
    // Mesma proteção do composable: não deixar janela e camada no ar juntas.
    if (await isProjectionOpen(FEATURE)) await closeProjection(FEATURE);
    Broadcast.send(BROADCAST_TYPE.MODULE_PROJECTION_OPEN, { module: FEATURE });
    setUtilitarioNaCamada(FEATURE);
    return;
  }
  await openProjection({
    feature: FEATURE,
    route: ROUTE,
    monitorId: null,
    fullscreen: true,
    alwaysOnTop: false,
  });
}

export async function unprojectStopwatch(): Promise<void> {
  if (await isBackgroundOpen()) {
    Broadcast.send(BROADCAST_TYPE.MODULE_PROJECTION_CLOSE, { module: FEATURE });
    if (utilitarioNaCamada() === FEATURE) setUtilitarioNaCamada(null);
    return;
  }
  await closeProjection(FEATURE);
}
