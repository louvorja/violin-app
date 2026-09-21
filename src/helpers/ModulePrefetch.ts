import ModuleManager from "@/helpers/ModuleManager";
import Telemetry from "@/helpers/Telemetry";

/**
 * Pré-carrega o código e as traduções de um módulo quando há intenção explícita
 * do operador (hover ou foco na Ribbon). Não monta o componente nem acessa
 * banco/IPC: apenas aquece os chunks que Modules.vue carregaria no clique.
 *
 * Não há prefetch no boot. Assim, quem nunca usa um módulo não paga por ele e
 * o primeiro paint da Shell continua livre de downloads especulativos.
 */
const componentLoaders = import.meta.glob("../modules/*/components/Index.vue");
const prefetches = new Map<string, Promise<void>>();

const moduleIdPattern = /^[a-z0-9_-]+$/i;

export function prefetchModule(moduleId: string | null | undefined): void {
  if (!moduleId || !moduleIdPattern.test(moduleId) || prefetches.has(moduleId)) return;

  const loader = componentLoaders[`../modules/${moduleId}/components/Index.vue`];
  if (typeof loader !== "function") return;

  const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
  const prefetch = Promise.all([
    loader(),
    ModuleManager.ensureTranslations(moduleId),
  ])
    .then(() => {
      const endedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
      Telemetry.track("module_prefetch_completed", {
        module_id: moduleId,
        duration_ms: Math.max(0, Math.round(endedAt - startedAt)),
      });
    })
    .catch((error) => {
      // Prefetch é estritamente uma otimização. Um erro aqui não pode impedir
      // que o loader normal da aba tente novamente no clique.
      prefetches.delete(moduleId);
      Telemetry.captureException(error, {
        source: "module_prefetch",
        module_id: moduleId,
      });
    });

  prefetches.set(moduleId, prefetch);
}
