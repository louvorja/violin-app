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
    <!-- O <Transition> aqui NÃO anima nada (`:css="false"`): só atrasa a
         retirada do módulo que saiu, para ele continuar desenhado por baixo
         enquanto o próximo entra por cima. Quem anima a entrada é o próprio
         módulo (`.lj-page-in` em ModuleContainer.vue), uma animação CSS que
         reinicia sozinha quando o KeepAlive devolve a tela ao DOM.

         O Transition que já esteve aqui esmaecia a aba nova sobre o vazio, e o
         que aparecia atrás era o fundo de .shell-content — medido: 12 de 18
         trocas mostravam um quadro inteiro da cor do tema. Com a tela anterior
         segurada por baixo não há vazio para aparecer. -->
    <Transition
      :css="false"
      @before-enter="markEnteringPage"
      @leave="holdLeavingPage"
      @leave-cancelled="cancelLeavingPage"
    >
      <KeepAlive>
        <component
          :is="getComponent(activePersistentModule.id)"
          v-if="activePersistentModule"
          :key="activePersistentModule.id"
        />
      </KeepAlive>
    </Transition>

    <Transition
      :css="false"
      @before-enter="markEnteringPage"
      @leave="holdLeavingPage"
      @leave-cancelled="cancelLeavingPage"
    >
      <KeepAlive :max="RUNTIME_PERFORMANCE.moduleCacheMax">
        <component
          :is="getComponent(activeCachedModule.id)"
          v-if="activeCachedModule"
          :key="activeCachedModule.id"
        />
      </KeepAlive>
    </Transition>

    <template v-for="module in auxiliaryModules" :key="module.id">
      <component :is="getComponent(module.id)" />
    </template>
  </template>
</template>

<script setup lang="ts">
import {
  defineAsyncComponent,
  computed,
  nextTick,
  onBeforeUnmount,
  reactive,
  ref,
  watch,
  type Component,
} from "vue";
import $appdata from "@/helpers/AppData";
import $modules from "@/helpers/Modules";
import Telemetry from "@/helpers/Telemetry";
import { isStaleChunkError, notifyStaleVersion } from "@/helpers/StaleVersion";
import ModuleManager from "@/helpers/ModuleManager";
import { isPersistentModule, RUNTIME_PERFORMANCE } from "@/helpers/RuntimePerformance";
import {
  awaitingModule,
  navDirection,
  pickNavDirection,
  pickShownModule,
  resetModuleSwap,
  shownModuleId,
  heldModuleId,
  HOLD_TIMEOUT_MS,
  PAGE_LEAVE_MS,
} from "@/composables/useModuleSwap";

interface ModuleState {
  id: string;
  show?: boolean;
  minimized?: boolean;
  popup?: boolean;
  [key: string]: unknown;
}

// Glob estático — Vite analisa em build-time e gera importações individuais.
// Substitui template literals variáveis que falham no headless Chromium (Playwright).
const _globBase = import.meta.glob("../modules/*/components/Index.vue");

// Cache de async components por moduleId. Sem isto, cada render de Modules.vue
// criaria um defineAsyncComponent novo, fazendo Vue desmontar e remontar todos
// os módulos a cada interação — o que quebra o estado interno e causa erros de
// "Cannot read properties of null (reading 'type')" durante unmount em transit.
const _componentCache = new Map<string, Component>();

function buildAsyncComponent(moduleId: string): Component {
  return defineAsyncComponent({
    loader: () => {
      const baseKey = `../modules/${moduleId}/components/Index.vue`;
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
      Telemetry.captureException(err, { source: "module_async_load", module_id: moduleId });
      console.error(`[Modules] erro ao carregar "${moduleId}":`, err);
      Telemetry.markEnd("module.open", moduleId, { module_id: moduleId, outcome: "failed" });
      Telemetry.track("module_load_failed", {
        module_id: moduleId,
        reason: err instanceof Error ? err.name : "unknown",
      });
      if (isStaleChunkError(err)) notifyStaleVersion();
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

/*
 * Quem fica na tela não é sempre o módulo ativo.
 *
 * Abrir um módulo cujo chunk ainda não foi baixado trocava a aba na hora e
 * deixava o lugar vazio até o código chegar: alguns quadros com o fundo de
 * `.shell-content` — a cor do tema — piscando atrás da tela. Agora a aba
 * anterior continua desenhada até a nova estar pronta, como um navegador
 * trocando de aba (ver composables/useModuleSwap.ts).
 *
 * "Pronta" é o chunk carregado pelo `__asyncLoader` do próprio componente
 * assíncrono: depois dele o Vue monta o módulo no mesmo quadro, sem passar
 * pelo placeholder vazio. É a mesma função que o vue-router usa para resolver
 * componentes assíncronos antes de navegar; se um dia ela sumir, `preload`
 * dá o módulo por pronto e tudo volta ao comportamento anterior.
 */
const readyModules = reactive(new Set<string>());
const holdTimers = new Map<string, ReturnType<typeof setTimeout>>();
const lastShownId = ref<string | null>(null);

function preload(id: string): void {
  if (readyModules.has(id) || holdTimers.has(id)) return;
  const markReady = () => {
    clearTimeout(holdTimers.get(id));
    holdTimers.delete(id);
    readyModules.add(id);
  };
  const loader = (getComponent(id) as { __asyncLoader?: () => Promise<unknown> }).__asyncLoader;
  if (typeof loader !== "function") {
    readyModules.add(id);
    return;
  }
  // Falha de carga também libera a troca: quem mostra o erro (e registra a
  // telemetria) é o `onError` do componente assíncrono, que só roda montado.
  holdTimers.set(id, setTimeout(markReady, HOLD_TIMEOUT_MS));
  loader().then(markReady, markReady);
}

/*
 * Troca de página — o módulo que saiu fica desenhado por baixo enquanto o
 * próximo entra por cima.
 *
 * Tudo acontece nos ganchos do <Transition>, direto no elemento raiz do módulo
 * (`data-page`, lido por ui.css). Não passa por estado reativo de propósito: um
 * `:class` no ModuleContainer refaria o render dele três vezes por troca, e o
 * render daquele componente reexecuta o slot inteiro do módulo. E assim serve
 * para qualquer raiz — a Liturgia não usa ModuleContainer.
 *
 * - `entering`: veio da tela inicial; esmaece sobre ela.
 * - `entering-over`: veio de outro módulo, que ainda está desenhado por baixo.
 *   Fica por cima (a ordem dos dois no DOM depende de qual faixa KeepAlive cada
 *   um ocupa) e entra OPACO, só deslizando: esmaecer aqui mistura as duas telas.
 *   Os dois recebem `--lj-nav-x`, o lado por onde a entrada vem.
 * - `leaving`: trocado por outro; continua desenhado por baixo, sem receber
 *   clique.
 * - `closing`: a aba foi FECHADA. É ele quem some, por cima — recua e esmaece —
 *   e a vizinha, já no lugar, é revelada parada.
 * - `leaving-home`: fechou a última aba; some do mesmo jeito e revela a tela
 *   inicial.
 *
 * O elemento raiz do módulo tem `v-show`, e o `v-show` também passa por estes
 * ganchos: numa saída há DUAS esperas pendentes para o mesmo elemento (a que
 * esconde e a que tira do DOM). Se o operador volta à aba no meio do caminho,
 * o Vue cancela só a última — a outra dispararia depois e esconderia a aba que
 * acabou de voltar. Por isso o cancelamento limpa todas.
 */
type PageElement = HTMLElement;

/*
 * De onde para onde é a troca — medido entre o começo e o fim do MESMO tick,
 * não entre dois valores seguidos.
 *
 * Fechar uma aba são duas mudanças no mesmo tick: o módulo deixa de estar
 * aberto (por um instante não há módulo ativo) e só então o vizinho assume. O
 * Vue desenha só o resultado, mas quem olhasse cada passo veria "foi para a
 * tela inicial" e depois "veio da tela inicial" — e o vizinho entraria
 * esmaecendo sobre a cor do tema, sem direção. O ponto de partida é o que
 * estava na tela quando o tick começou, e a ordem das abas é a de antes dele
 * (a aba fechada já não está na de agora).
 */
let enteringOverModule = false;
let closingModule = false;
let swapFrom: string | null | undefined;
let tabOrderBeforeTick: string[] = currentTabOrder();

function currentTabOrder(): string[] {
  return ($modules.tabs() as { id: string }[]).map((tab) => tab.id);
}

function describeSwap(previous: string | null, next: string | null): void {
  if (swapFrom === undefined) {
    swapFrom = previous;
    void nextTick(() => {
      swapFrom = undefined;
      tabOrderBeforeTick = currentTabOrder();
    });
  }
  const from = swapFrom;
  const before = tabOrderBeforeTick;
  const knownBefore =
    from !== null && next !== null && before.includes(from) && before.includes(next);
  navDirection.value = pickNavDirection(from, next, knownBefore ? before : currentTabOrder());
  enteringOverModule = from !== null && next !== null && from !== next;
  // A aba de onde se saiu não está mais aberta: não foi troca, foi fechamento.
  closingModule = from !== null && !isOpenOnScreen(from);
}
const pageTimers = new WeakMap<Element, Set<ReturnType<typeof setTimeout>>>();

function laterOn(el: Element, run: () => void, ms: number): void {
  const timers = pageTimers.get(el) ?? new Set();
  pageTimers.set(el, timers);
  const timer = setTimeout(() => {
    timers.delete(timer);
    run();
  }, ms);
  timers.add(timer);
}

function clearPageTimers(el: Element): void {
  pageTimers.get(el)?.forEach((timer) => clearTimeout(timer));
  pageTimers.delete(el);
}

function markEnteringPage(el: Element): void {
  const page = el as PageElement;
  clearPageTimers(page);
  // Fechou a aba de cima: esta já está no lugar, parada, e é revelada.
  const sliding = enteringOverModule && !closingModule;
  page.dataset.page = enteringOverModule ? "entering-over" : "entering";
  page.style.setProperty("--lj-nav-x", sliding ? String(navDirection.value) : "0");
  page.style.setProperty("--lj-nav-y", "0");
  // Por cima de outro módulo entra opaca (ver `lj-page-fade` em ui.css).
  page.style.setProperty("--lj-page-from-opacity", enteringOverModule ? "1" : "0");
  laterOn(
    page,
    () => {
      delete page.dataset.page;
      // A direção era desta troca: um painel de aba dentro do módulo não pode
      // herdá-la depois.
      page.style.removeProperty("--lj-nav-x");
      page.style.removeProperty("--lj-nav-y");
    },
    PAGE_LEAVE_MS
  );
}

function holdLeavingPage(el: Element, done: () => void): void {
  const page = el as PageElement;
  if (shownModuleId.value === null) page.dataset.page = "leaving-home";
  else page.dataset.page = closingModule ? "closing" : "leaving";
  laterOn(
    page,
    () => {
      done();
      delete page.dataset.page;
    },
    PAGE_LEAVE_MS
  );
}

function cancelLeavingPage(el: Element): void {
  clearPageTimers(el);
  delete (el as PageElement).dataset.page;
}

const isOpenOnScreen = (id: string): boolean =>
  modules.value.some(
    (module) =>
      module.id === id && module.show === true && module.popup !== true && module.minimized !== true
  );

const activeId = computed(() => activeEmbeddedModule.value?.id ?? null);
const activeIsReady = computed(() => activeId.value !== null && readyModules.has(activeId.value));

const shownId = computed(() =>
  pickShownModule(activeId.value, lastShownId.value, (id) => readyModules.has(id), isOpenOnScreen)
);

// `activeIsReady` é fonte de propósito: no primeiro módulo aberto a partir da
// tela inicial o id na tela é o mesmo antes e depois da carga, e sem ela nada
// avisaria a Shell de que a espera acabou.
//
// `sync`: o módulo anterior precisa saber que foi segurado ANTES de o `v-show`
// dele reagir à troca de `active_module`, ou se esconderia por um quadro.
watch(
  [activeId, shownId, activeIsReady],
  ([active, shown, ready]) => {
    if (active) preload(active);
    // Voltar à tela inicial esquece a aba anterior: abrir um módulo novo a
    // partir dali não pode trazer de volta, por um instante, a aba de antes.
    if (!active) lastShownId.value = null;
    else if (shown === active && ready) lastShownId.value = active;

    // Antes de publicar a tela nova: a direção precisa estar no CSS no mesmo
    // quadro em que o módulo entra no DOM, ou a animação já começa do lado
    // errado.
    if (shown !== shownModuleId.value) describeSwap(shownModuleId.value, shown);

    shownModuleId.value = shown;
    heldModuleId.value = shown !== null && shown !== active ? shown : null;
    awaitingModule.value = active !== null && shown === active && !ready;
  },
  { immediate: true, flush: "sync" }
);

onBeforeUnmount(() => {
  holdTimers.forEach((timer) => clearTimeout(timer));
  holdTimers.clear();
  resetModuleSwap();
});

const shownEmbeddedModule = computed(() =>
  shownId.value ? modules.value.find((module) => module.id === shownId.value) : undefined
);

const activePersistentModule = computed(() =>
  shownEmbeddedModule.value && isPersistentModule(shownEmbeddedModule.value.id)
    ? shownEmbeddedModule.value
    : undefined
);

const activeCachedModule = computed(() =>
  shownEmbeddedModule.value && !isPersistentModule(shownEmbeddedModule.value.id)
    ? shownEmbeddedModule.value
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
