/**
 * Limites únicos e conservadores do renderer.
 *
 * A aplicação não adapta comportamento a memória, núcleos ou plataforma:
 * todos os equipamentos usam os mesmos limites para preservar uma experiência
 * previsível. A estratégia é evitar trabalho fora da viewport e pressão de
 * memória desnecessária sem retirar dados, comandos ou recursos.
 */

export interface RuntimePerformanceProfile {
  moduleCacheMax: number;
}

/**
 * Esses módulos podem ter uma projeção/rotina em andamento enquanto outra aba
 * está em primeiro plano. Eles ficam em uma faixa KeepAlive própria para não
 * serem desalojados pelo limite das telas de consulta.
 */
export const PERSISTENT_MODULE_IDS: ReadonlySet<string> = new Set([
  "clock",
  "liturgy",
  "stopwatch",
  "timer",
  "timer_worship",
]);

export function isPersistentModule(moduleId: string): boolean {
  return PERSISTENT_MODULE_IDS.has(moduleId);
}

/**
 * Quatro telas de consulta recentes equilibram reabertura rápida e retenção de
 * memória. O mesmo limite vale para web, Electron e qualquer configuração de
 * hardware; módulos operacionais ficam na faixa persistente acima.
 */
export const RUNTIME_PERFORMANCE: RuntimePerformanceProfile = Object.freeze({
  moduleCacheMax: 4,
});
