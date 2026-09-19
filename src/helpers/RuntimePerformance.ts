/**
 * Perfil pequeno e conservador do renderer.
 *
 * A aplicação precisa continuar funcional quando Chromium/Electron não expõe
 * `deviceMemory` (isso acontece em algumas versões do Electron). Nesses casos
 * usamos apenas `hardwareConcurrency` e um perfil normal como fallback.
 *
 * O perfil não tenta medir benchmark em tempo real: ele só escolhe limites
 * seguros para o cache de abas e para a quantidade inicial de linhas da tabela.
 * Menos DOM no primeiro paint é mais importante que preencher uma lista inteira
 * que ainda está fora da viewport.
 */

export interface RuntimePerformanceProfile {
  lowResource: boolean;
  constrained: boolean;
  moduleCacheMax: number;
  tablePageSize: number;
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

interface NavigatorLike {
  deviceMemory?: number;
  hardwareConcurrency?: number;
}

const NORMAL_PROFILE: RuntimePerformanceProfile = {
  lowResource: false,
  constrained: false,
  moduleCacheMax: 6,
  tablePageSize: 80,
};

const CONSTRAINED_PROFILE: RuntimePerformanceProfile = {
  lowResource: false,
  constrained: true,
  moduleCacheMax: 4,
  tablePageSize: 60,
};

const LOW_RESOURCE_PROFILE: RuntimePerformanceProfile = {
  lowResource: true,
  constrained: true,
  moduleCacheMax: 3,
  tablePageSize: 40,
};

function positiveNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

/** Resolve o perfil sem depender diretamente do objeto global. */
export function getRuntimePerformanceProfile(
  source: NavigatorLike | null | undefined = typeof navigator !== "undefined"
    ? (navigator as NavigatorLike)
    : undefined
): RuntimePerformanceProfile {
  const cores = positiveNumber(source?.hardwareConcurrency);
  const memory = positiveNumber(source?.deviceMemory);

  // `deviceMemory` é arredondado pelo navegador. Até 2 GB é um cenário de
  // pressão real; sem essa informação, 2 threads é um sinal equivalente.
  const lowResource = memory !== null ? memory <= 2 : cores !== null && cores <= 2;

  // 4 GB ou 4 threads ainda funcionam bem, mas não devem manter seis módulos
  // grandes em KeepAlive nem montar 80 linhas complexas no primeiro frame.
  const constrained = lowResource || (memory !== null ? memory <= 4 : cores !== null && cores <= 4);

  if (lowResource) return { ...LOW_RESOURCE_PROFILE };
  if (constrained) return { ...CONSTRAINED_PROFILE };
  return { ...NORMAL_PROFILE };
}

export const RUNTIME_PERFORMANCE = getRuntimePerformanceProfile();
