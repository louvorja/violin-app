<template>
  <div
    v-if="openModules.length > 0"
    class="subtabs-wrapper"
    :class="{ 'subtabs-wrapper--compact-web': isMobileWeb }"
    role="tablist"
    :aria-label="$t('shell.open_modules')"
  >
    <draggable
      ref="strip"
      :list="openModules"
      item-key="id"
      class="subtabs"
      :disabled="isMobileWeb"
      ghost-class="subtab--ghost"
      :animation="150"
      @start="onDragStart"
      @end="onDragEnd"
    >
      <template #item="{ element: m }">
        <button
          type="button"
          role="tab"
          class="subtab"
          :class="{
            'subtab--active': isActive(m.id),
            'subtab--entering': enteringTabs.has(m.id),
            'subtab--activating': activatingTab === m.id,
          }"
          :data-tab="m.id"
          :aria-selected="isActive(m.id)"
          @click="focus(m.id)"
          @animationend="onTabAnimationEnd(m.id, $event)"
        >
          <LjIcon
            :icon="getModule(m.id).icon"
            :color="getModule(m.id).color"
            size="18"
            class="subtab-icon"
            aria-hidden="true"
          />
          <span class="subtab-label lj-u-truncate">{{ t(getModule(m.id).title) }}</span>
          <span
            role="button"
            tabindex="0"
            class="subtab-close"
            :aria-label="`${$t('alert.close')}: ${t(getModule(m.id).title)}`"
            @click.stop="close(m.id)"
            @keydown.enter.stop.prevent="close(m.id)"
            @keydown.space.stop.prevent="close(m.id)"
          >
            <LjIcon :icon="ICONS.ACTIONS.CLOSE" size="12" aria-hidden="true" />
          </span>
        </button>
      </template>
    </draggable>
  </div>
</template>

<script setup>
import { LjIcon } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from "vue";
import { useViewport } from "@/composables/useViewport";
import Platform from "@/helpers/Platform";
import { useI18n } from "vue-i18n";
import draggable from "vuedraggable";
import $appdata from "@/helpers/AppData";
import $userdata from "@/helpers/UserData";
import $modules from "@/helpers/Modules";
import { getAllModules } from "@/config/modules";
import { KEYS } from "@/constants/UserDataKeys";

const { t } = useI18n();
const { width } = useViewport();
const coarsePointer =
  typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
const isMobileWeb = computed(
  () =>
    !Platform.isDesktop &&
    width.value > 0 &&
    (width.value <= 700 || (coarsePointer && width.value <= 1000))
);
// Opened system modules also need their manifest, even when hidden from the Ribbon.
const modules = getAllModules;
const openModules = computed({
  get: () => $modules.tabs(),
  set() {},
});

function onReorder() {
  const ids = openModules.value.map((m) => m.id);
  $userdata.set(KEYS.MODULES.OPEN_ORDER, ids);
}

/*
 * Entrada, saída e reacomodação das abas.
 *
 * A aba nova cresce no lugar, a fechada some e as vizinhas deslizam para ocupar
 * o espaço — em vez de a faixa inteira pular de um quadro para o outro.
 *
 * Seria o caso de um <TransitionGroup>, mas o vuedraggable 4.1 não funciona
 * dentro de um (o Vue clona os filhos com chave e o Sortable nunca é criado —
 * sem erro na tela, a faixa só deixa de aceitar arrasto). Então é feito à mão:
 *
 * - Entrada: classe `subtab--entering` aplicada só às abas recém-abertas e
 *   retirada no `animationend`. Deixar a animação fixa em `.subtab` fazia o
 *   Sortable (ou tirar `animation: none` no fim do arrasto) reiniciar a entrada
 *   em toda a faixa, piscando todas as abas ao reordenar.
 * - Saída: o Vue tira a aba do DOM na hora; uma cópia dela, pregada onde ela
 *   estava, é que some.
 * - Vizinhas: FLIP — mede onde cada aba estava, deixa o layout mudar, põe cada
 *   uma de volta no lugar antigo com `transform` e solta, com a transição do
 *   token.
 *
 * Durante o arrasto (e logo depois dele) o FLIP não roda: quem move as abas ali
 * é o Sortable.
 */
const strip = ref(null);
const dragging = ref(false);
const enteringTabs = reactive(new Set());
const enterTimers = new Map();
const activatingTab = ref(null);
let activateTimer;
let knownIds = new Set(openModules.value.map((m) => m.id));
let settleTimer;

function clearEnter(id) {
  const timer = enterTimers.get(id);
  if (timer) {
    clearTimeout(timer);
    enterTimers.delete(id);
  }
  enteringTabs.delete(id);
}

function markEntering(id) {
  clearEnter(id);
  enteringTabs.add(id);
  enterTimers.set(
    id,
    setTimeout(() => clearEnter(id), 400)
  );
}

function clearActivating() {
  clearTimeout(activateTimer);
  activateTimer = undefined;
  activatingTab.value = null;
}

function markActivating(id) {
  clearActivating();
  activatingTab.value = id;
  activateTimer = setTimeout(clearActivating, 250);
}

watch(
  () => $appdata.get("active_module"),
  (id) => {
    if (id) markActivating(id);
    else clearActivating();
  }
);

function onTabAnimationEnd(id, event) {
  // `subtab-in` é a animação mais longa das duas; só limpa quando ela acaba
  // (e ignora eventos borbulhados de filhos ou pseudo-elementos).
  if (event.target !== event.currentTarget) return;
  if (event.animationName && !event.animationName.includes("subtab-in")) return;
  clearEnter(id);
}

function tabElements() {
  const root = strip.value?.$el ?? strip.value;
  return root instanceof HTMLElement ? [...root.querySelectorAll(":scope > .subtab")] : [];
}

function snapshotTabs() {
  return new Map(tabElements().map((el) => [el.dataset.tab, { el, left: el.offsetLeft }]));
}

function animateTabChange(before) {
  const root = strip.value?.$el ?? strip.value;
  if (!(root instanceof HTMLElement)) return;
  const after = new Map(tabElements().map((el) => [el.dataset.tab, el]));

  // Saída: a cópia some onde a aba estava.
  for (const [id, { el, left }] of before) {
    if (after.has(id)) continue;
    const ghost = el.cloneNode(true);
    ghost.classList.remove("subtab--entering", "subtab--activating");
    ghost.classList.add("subtab--leaving");
    ghost.setAttribute("aria-hidden", "true");
    ghost.removeAttribute("role");
    ghost.style.left = `${left}px`;
    ghost.style.width = `${el.offsetWidth || parseFloat(getComputedStyle(el).width) || 0}px`;
    root.appendChild(ghost);
    const remove = () => ghost.remove();
    ghost.addEventListener("animationend", remove, { once: true });
    setTimeout(remove, 400);
  }

  // Vizinhas: voltam ao lugar antigo sem transição e deslizam até o novo.
  const moved = [];
  for (const [id, el] of after) {
    const was = before.get(id);
    if (!was) continue;
    const dx = was.left - el.offsetLeft;
    if (!dx) continue;
    el.classList.remove("subtab--moving");
    el.style.transition = "none";
    el.style.transform = `translateX(${dx}px)`;
    moved.push(el);
  }
  if (!moved.length) return;
  void root.offsetWidth; // aplica o ponto de partida antes de soltar
  for (const el of moved) {
    el.classList.add("subtab--moving");
    el.style.transition = "";
    el.style.transform = "";
    const done = () => el.classList.remove("subtab--moving");
    el.addEventListener("transitionend", done, { once: true });
    setTimeout(done, 400);
  }
}

// `pre` mede antes de o Vue mexer no DOM; o `nextTick` roda depois.
watch(
  () => openModules.value.map((m) => m.id).join("|"),
  (key) => {
    const nextIds = key ? key.split("|") : [];
    const nextSet = new Set(nextIds);
    for (const id of enteringTabs) {
      if (!nextSet.has(id)) clearEnter(id);
    }
    if (!dragging.value) {
      for (const id of nextIds) {
        if (!knownIds.has(id)) markEntering(id);
      }
      const before = snapshotTabs();
      void nextTick(() => animateTabChange(before));
    }
    knownIds = nextSet;
  },
  { flush: "pre" }
);

function onDragStart() {
  clearTimeout(settleTimer);
  dragging.value = true;
  clearActivating();
  for (const id of [...enteringTabs]) clearEnter(id);
}

function onDragEnd() {
  onReorder();
  // O Vue ainda vai reordenar os nós para a ordem nova; só então o FLIP volta
  // a observar trocas de lista.
  settleTimer = setTimeout(() => {
    dragging.value = false;
  }, 300);
}

onBeforeUnmount(() => {
  clearTimeout(settleTimer);
  clearActivating();
  for (const timer of enterTimers.values()) clearTimeout(timer);
  enterTimers.clear();
});

function isActive(id) {
  return $appdata.get("active_module") === id;
}

function getModule(id) {
  return modules[id] || {};
}

function focus(id) {
  $modules.open(id);
}
function close(id) {
  void $modules.requestClose(id);
}
</script>

<style scoped>
.subtabs-wrapper {
  flex-shrink: 0;
}

.subtabs {
  /* Raio das pontas da aba e dos "pés" côncavos da ativa. É também o recuo
     lateral da faixa: sem ele o pé da primeira aba seria cortado pelo overflow. */
  --subtab-r: var(--lj-radius-md);

  display: flex;
  align-items: flex-end;
  gap: 3px;
  height: var(--lj-subtabs-height);
  padding: var(--lj-space-2) var(--subtab-r) 0;
  /* A linha da base é fundo, e não borda: a aba ativa desce sobre ela para se
     fundir ao painel, e uma borda ficaria fora da área que o overflow deixa
     pintar. */
  background:
    linear-gradient(var(--lj-subtabs-border), var(--lj-subtabs-border)) left bottom / 100% 1px
      no-repeat,
    var(--lj-subtabs-bg);
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
  font-family: var(--lj-font-shell);
  /* Referência da aba que sai (`position: absolute` durante a saída). */
  position: relative;
}

.subtabs::-webkit-scrollbar {
  display: none;
}

/* Entrada, saída e reacomodação das abas (ver o comentário no script).
   A aba nova cresce a partir da base, que é onde ela se prende ao painel — mas
   só enquanto carrega `subtab--entering`, para o arrasto do Sortable nunca
   reiniciar a entrada nas abas já abertas. */
.subtab {
  transform-origin: 50% 100%;
}

.subtab.subtab--entering {
  animation:
    subtab-in var(--lj-motion-fast),
    subtab-fade-in var(--lj-transition-fast);
}

@keyframes subtab-in {
  from {
    transform: scale(var(--lj-enter-layer-scale));
  }
}

@keyframes subtab-fade-in {
  from {
    opacity: 0;
  }
}

/* A cópia da aba fechada: pregada onde a aba estava, some no lugar. */
.subtab.subtab--leaving {
  position: absolute;
  bottom: 0;
  pointer-events: none;
  animation: subtab-out var(--lj-exit-fast) both;
}

@keyframes subtab-out {
  to {
    opacity: 0;
    transform: scale(var(--lj-enter-layer-scale));
  }
}

/* As vizinhas deslizam até o novo lugar (o ponto de partida vem do script). */
.subtab.subtab--moving {
  transition: transform var(--lj-motion-fast);
}

/* A aba inativa termina 2px acima da base e a ativa desce até ela, mas o topo é
   o mesmo: o que muda entre os estados é o acabamento, não o tamanho. */
.subtab {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--lj-space-3);
  height: calc(var(--lj-subtabs-height) - var(--lj-space-2) - 2px);
  margin-bottom: 2px;
  padding: 0 var(--lj-space-2) 0 var(--lj-space-4);
  background: var(--lj-subtab-bg);
  border: none;
  border-radius: var(--subtab-r);
  color: var(--lj-subtab-color);
  font-family: inherit;
  font-size: var(--lj-text-base);
  /* Mesmo peso nos dois estados: trocar 400 por 600 alargava a aba ativa e
     empurrava as vizinhas a cada clique. */
  font-weight: var(--lj-weight-medium);
  white-space: nowrap;
  cursor: pointer;
  outline: none;
  transition:
    background var(--lj-transition-fast),
    color var(--lj-transition-fast);
}

.subtab:hover:not(.subtab--active) {
  background: var(--lj-subtab-hover-bg);
  color: var(--lj-text);
}

.subtab:focus-visible {
  box-shadow: var(--lj-ui-focus);
}

/* Aba ativa: mesma cor do painel e pontas côncavas que a ligam à linha da base.
   Sem barra de cor — quem a destaca é o contraste com a faixa. */
.subtab--active {
  height: calc(var(--lj-subtabs-height) - var(--lj-space-2));
  margin-bottom: 0;
  /* Devolve os 2px a mais de altura ao lado de dentro, para o texto ficar no
     mesmo lugar nos dois estados. */
  padding-bottom: 2px;
  background: var(--lj-subtab-active-bg);
  border-radius: var(--subtab-r) var(--subtab-r) 0 0;
  color: var(--lj-subtab-active-color);
  z-index: 2;
}

.subtab--active::before,
.subtab--active::after {
  content: "";
  position: absolute;
  bottom: 0;
  width: var(--subtab-r);
  height: var(--subtab-r);
  pointer-events: none;
}

.subtab--active.subtab--activating::before,
.subtab--active.subtab--activating::after {
  animation: subtab-foot-in var(--lj-transition-fast) both;
}

@keyframes subtab-foot-in {
  from {
    opacity: 0;
  }
}

/* O círculo tem centro no canto de cima, junto à aba: por dentro é transparente
   (mostra a faixa), por fora é o fundo da aba — o que desenha o arco côncavo. Os
   0,5px de transição suavizam a serrilha sem deixar uma franja semitransparente. */
.subtab--active::before {
  left: calc(-1 * var(--subtab-r));
  background: radial-gradient(
    circle at 0 0,
    transparent var(--subtab-r),
    var(--lj-subtab-active-bg) calc(var(--subtab-r) + 0.5px)
  );
}

.subtab--active::after {
  right: calc(-1 * var(--subtab-r));
  background: radial-gradient(
    circle at 100% 0,
    transparent var(--subtab-r),
    var(--lj-subtab-active-bg) calc(var(--subtab-r) + 0.5px)
  );
}

/* Filete entre abas inativas, no meio do vão. Some junto da ativa, do hover e
   depois da última, onde não separa nada. */
.subtab:not(.subtab--active)::after {
  content: "";
  position: absolute;
  top: 50%;
  right: -2px;
  width: 1px;
  height: 14px;
  transform: translateY(-50%);
  background: var(--lj-subtabs-border);
  pointer-events: none;
  transition: opacity var(--lj-transition-fast);
}

.subtab:not(.subtab--active):is(
    :last-child,
    :hover,
    :has(+ .subtab:hover),
    :has(+ .subtab--active)
  )::after {
  opacity: 0;
}

.subtab-icon {
  flex-shrink: 0;
}

.subtab-label {
  max-width: 200px;
}

.subtab-close {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  color: var(--lj-subtab-close-color);
  transition:
    background var(--lj-transition-fast),
    color var(--lj-transition-fast);
}

.subtab-close:hover {
  background: var(--lj-subtab-close-hover-bg);
  color: var(--lj-text);
}

.subtab--ghost {
  opacity: 0.4;
}

.subtabs-wrapper--compact-web .subtabs {
  --lj-subtabs-height: 48px;
  align-items: stretch;
  gap: var(--lj-space-1);
  padding-top: var(--lj-space-1);
  overscroll-behavior-inline: contain;
}

.subtabs-wrapper--compact-web .subtab,
.subtabs-wrapper--compact-web .subtab--active {
  min-height: 40px;
  margin-bottom: 0;
  padding-inline: var(--lj-space-3);
}

.subtabs-wrapper--compact-web .subtab-close {
  width: 40px;
  height: 40px;
}

.subtabs-wrapper--compact-web .subtab-label {
  max-width: 120px;
}
</style>
