<template>
  <template v-if="import_modules">
    <!-- Marcador para testes E2E aguardarem o boot dos módulos (vide liturgy.spec.js) -->
    <span data-testid="modules-ready" aria-hidden="true" style="display: none" />
    <!--
      Os módulos embedded usam duas faixas KeepAlive: uma persistente para
      operações em andamento e outra com limite global para consultas comuns.
      Antes cada módulo tinha seu próprio KeepAlive, então o limite não podia
      ser global e abrir muitas abas mantinha todas as árvores em memória.
      Popups (player/letra/álbum) ficam fora deste limite porque precisam
      coexistir e continuam sendo desmontados assim que são fechados.
    -->
    <!-- Relógios/cronômetros/liturgia têm estado operacional que pode continuar
         sendo usado pela projeção enquanto outra aba está ativa. -->
    <KeepAlive>
      <component
        :is="getComponent(activePersistentModule.id)"
        v-if="activePersistentModule"
        :key="activePersistentModule.id"
      />
    </KeepAlive>

    <KeepAlive :max="RUNTIME_PERFORMANCE.moduleCacheMax">
      <component
        :is="getComponent(activeCachedModule.id)"
        v-if="activeCachedModule"
        :key="activeCachedModule.id"
      />
    </KeepAlive>

    <template v-for="module in auxiliaryModules" :key="module.id">
      <component :is="getComponent(module.id)" />
    </template>
  </template>
</template>

<script setup lang="ts">
import { defineAsyncComponent, computed, type Component } from "vue";
import $appdata from "@/helpers/AppData";
import $modules from "@/helpers/Modules";
import Telemetry from "@/helpers/Telemetry";
import ModuleManager from "@/helpers/ModuleManager";
import { isPersistentModule, RUNTIME_PERFORMANCE } from "@/helpers/RuntimePerformance";

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
      const componentLoader = _globBase[baseKey] as (() => Promise<Component>) | undefined;
      if (componentLoader) {
        // Traduções não bloqueiam a montagem. O componente usa os títulos de
        // metadata no primeiro frame e o vue-i18n atualiza o texto quando os
        // JSONs chegam; importar o componente e baixar idioma em paralelo
        // remove uma espera serial do clique da Ribbon.
        void ModuleManager.ensureTranslations(moduleId);
        return componentLoader();
      }
      return Promise.reject(new Error(`[Modules] módulo não encontrado: ${moduleId}`));
    },
    onError(err, _retry, fail) {
      console.error(`[Modules] erro ao carregar "${moduleId}":`, err);
      Telemetry.markEnd("module.open", moduleId, { module_id: moduleId, outcome: "failed" });
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
// faria inclusive os que nunca foram abertos carregarem banco, IndexedDB e
// listeners. Entre abas, apenas o ativo fica no DOM. A faixa KeepAlive das
// consultas comuns conserva as últimas telas dentro de um limite adaptado ao
// equipamento; ao exceder o limite, a aba menos recentemente usada é
// desmontada e libera RAM. A faixa operacional não sofre essa expulsão.
const activeEmbeddedModule = computed(() => {
  const activeId = $appdata.get("active_module");
  return modules.value.find(
    (module) =>
      module.id === activeId &&
      module.show === true &&
      module.popup !== true &&
      module.minimized !== true
  );
});

const activePersistentModule = computed(() =>
  activeEmbeddedModule.value && isPersistentModule(activeEmbeddedModule.value.id)
    ? activeEmbeddedModule.value
    : undefined
);

const activeCachedModule = computed(() =>
  activeEmbeddedModule.value && !isPersistentModule(activeEmbeddedModule.value.id)
    ? activeEmbeddedModule.value
    : undefined
);

const auxiliaryModules = computed(() =>
  modules.value.filter(
    (module) =>
      (module.show === true || module.minimized === true) &&
      (module.popup === true || module.minimized === true)
  )
);
const import_modules = computed(() => $appdata.get("import_modules"));

defineExpose({ getComponent });
</script>
