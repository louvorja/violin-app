/**
 * Lado do módulo da fila de `ModuleLaunch`: consome o pedido ao montar e
 * sempre que chegar outro com o módulo já aberto.
 */
import { onMounted, watch } from "vue";
import {
  pendingModuleLaunches,
  takeModuleLaunch,
  type ModuleLaunchRequest,
} from "@/helpers/ModuleLaunch";

export function useModuleLaunch(
  moduleId: string,
  apply: (request: ModuleLaunchRequest) => void | Promise<void>
): void {
  function consume(): void {
    const request = takeModuleLaunch(moduleId);
    if (request) void apply(request);
  }
  onMounted(consume);
  watch(pendingModuleLaunches, consume);
}
