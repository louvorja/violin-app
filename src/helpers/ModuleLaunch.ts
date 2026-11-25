/**
 * Abrir um módulo já configurado (item "Utilitário" da liturgia).
 *
 * Quem pede (a liturgia) enfileira o pedido e abre o módulo; o módulo, quando
 * monta ou se já estava montado, consome o pedido com `useModuleLaunch` e
 * aplica a configuração — e inicia, se o item pediu. A fila existe porque o
 * módulo pode ainda não estar montado quando o item é clicado: uma ação mandada
 * pelo canal nessa hora se perderia.
 *
 * Arquivo pequeno de propósito, sem Vue além do `shallowRef`: a liturgia
 * importa isto sem arrastar o código dos módulos junto.
 */
import { shallowRef } from "vue";

/**
 * Configuração que o módulo aplica ao abrir. Cada módulo lê as chaves que
 * conhece (mode, target, minutes, warning, sound_start, draw_mode…); a lista
 * de campos de cada um mora em `modules/liturgy/utility.ts`.
 */
export type ModuleLaunchConfig = Record<string, unknown>;

export interface ModuleLaunchRequest {
  module: string;
  config: ModuleLaunchConfig;
  autoStart: boolean;
}

export const pendingModuleLaunches = shallowRef<ModuleLaunchRequest[]>([]);

/** Só o pedido mais recente de cada módulo vale: dois cliques seguidos não somam. */
export function requestModuleLaunch(request: ModuleLaunchRequest): void {
  pendingModuleLaunches.value = [
    ...pendingModuleLaunches.value.filter((r) => r.module !== request.module),
    request,
  ];
}

/**
 * Tira e devolve o pedido do módulo. Sem pedido, a fila não é regravada:
 * quem observa a fila e chama isto a cada mudança entraria em laço.
 */
export function takeModuleLaunch(moduleId: string): ModuleLaunchRequest | undefined {
  const found = pendingModuleLaunches.value.find((r) => r.module === moduleId);
  if (!found) return undefined;
  pendingModuleLaunches.value = pendingModuleLaunches.value.filter((r) => r !== found);
  return found;
}

/** Leitores tolerantes: valor do tipo certo ou `undefined` (o módulo mantém o que tinha). */
export function launchString(config: ModuleLaunchConfig, key: string): string | undefined {
  const value = config[key];
  return typeof value === "string" && value !== "" ? value : undefined;
}

export function launchNumber(config: ModuleLaunchConfig, key: string): number | undefined {
  const value = config[key];
  if (value === "" || value === null || value === undefined) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export function launchBoolean(config: ModuleLaunchConfig, key: string): boolean | undefined {
  const value = config[key];
  return typeof value === "boolean" ? value : undefined;
}
