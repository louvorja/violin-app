<template>
  <template v-if="import_modules">
    <!-- Marcador para testes E2E aguardarem o boot dos módulos (vide liturgy.spec.js) -->
    <span data-testid="modules-ready" aria-hidden="true" style="display: none" />
    <template v-for="module in visibleModules" :key="module.id">
      <KeepAlive>
        <component :is="getComponent(module.id)" />
      </KeepAlive>
    </template>
  </template>
</template>

<script setup lang="ts">
import { defineAsyncComponent, computed, type Component } from "vue";
import $appdata from "@/helpers/AppData";
import $modules from "@/helpers/Modules";
import Telemetry from "@/helpers/Telemetry";

interface ModuleState {
  id: string;
  show?: boolean;
  minimized?: boolean;
  popup?: boolean;
  [key: string]: unknown;
}

// Glob estático — Vite analisa em build-time e gera importações individuais.
// Substitui template literals variáveis que falham no headless Chromium (Playwright).
const _globBase = import.meta.glob("@/modules/*/components/Index.vue");

// Cache de async components por moduleId. Sem isto, cada render de Modules.vue
// criaria um defineAsyncComponent novo, fazendo Vue desmontar e remontar todos
// os módulos a cada interação — o que quebra o estado interno e causa erros de
// "Cannot read properties of null (reading 'type')" durante unmount em transit.
const _componentCache = new Map<string, Component>();

function buildAsyncComponent(moduleId: string): Component {
  return defineAsyncComponent({
    loader: () => {
      const baseKey = `/src/modules/${moduleId}/components/Index.vue`;
      if (_globBase[baseKey]) return (_globBase[baseKey] as () => Promise<Component>)();
      return Promise.reject(new Error(`[Modules] módulo não encontrado: ${moduleId}`));
    },
    onError(err, _retry, fail) {
      console.error(`[Modules] erro ao carregar "${moduleId}":`, err);
      Telemetry.captureException(err, { source: "module_async_load", module_id: moduleId });
      Telemetry.track("module_load_failed", {
        module_id: moduleId,
        reason: err instanceof Error ? err.name : "unknown",
      });
      fail();
    },
    delay: 0,
    // Mostra um placeholder vazio durante o carregamento (evita flicker)
    loadingComponent: { name: `Loading_${moduleId}`, render: () => null },
    // Componente exibido se o load falhar definitivamente
    errorComponent: {
      name: `Broken_${moduleId}`,
      render() {
        return null;
      },
    },
  });
}

function getComponent(moduleId: string): Component {
  if (!_componentCache.has(moduleId)) {
    _componentCache.set(moduleId, buildAsyncComponent(moduleId));
  }
  return _componentCache.get(moduleId) as Component;
}

const modules = computed((): ModuleState[] => {
  const all = $modules.get() as Record<string, ModuleState> | null;
  return all ? Object.values(all) : [];
});
// Cada módulo tem seu próprio setup/onMounted; montar os ~30 módulos no boot
// fazia inclusive os que nunca foram abertos carregarem banco, IndexedDB e
// listeners. Entre abas, manter todos os módulos embedded no DOM também fazia
// o Vue recalcular tabelas ocultas. Popups continuam coexistindo (player/letra
// precisam disso); para embedded, só o ativo fica renderizado. O KeepAlive
// conserva a tela ao alternar abas sem repetir o carregamento.
const visibleModules = computed(() =>
  modules.value.filter((module) => {
    if (module.show !== true && module.minimized !== true) return false;
    return (
      module.popup === true ||
      module.minimized === true ||
      module.id === $appdata.get("active_module")
    );
  })
);
const import_modules = computed(() => $appdata.get("import_modules"));

defineExpose({ getComponent });
</script>
