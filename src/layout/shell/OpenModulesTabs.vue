<template>
  <div
    v-if="openModules.length > 0"
    class="subtabs-wrapper"
    role="tablist"
    :aria-label="$t('shell.open_modules')"
  >
    <draggable
      :list="openModules"
      item-key="id"
      class="subtabs"
      ghost-class="subtab--ghost"
      :animation="150"
      @end="onReorder"
    >
      <template #item="{ element: m }">
        <button
          type="button"
          role="tab"
          class="subtab"
          :class="{ 'subtab--active': isActive(m.id) }"
          :aria-selected="isActive(m.id)"
          @click="focus(m.id)"
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
            tabindex="-1"
            class="subtab-close"
            :aria-label="`${$t('alert.close')}: ${t(getModule(m.id).title)}`"
            @click.stop="close(m.id)"
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
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import draggable from "vuedraggable";
import $appdata from "@/helpers/AppData";
import $userdata from "@/helpers/UserData";
import $modules from "@/helpers/Modules";
import { getModules } from "@/config/modules";
import { KEYS } from "@/constants/UserDataKeys";

const { t } = useI18n();
const modules = getModules;
const openModules = computed({
  get() {
    const modules = $appdata.get("modules") || {};
    const skip = new Set(["media", "lyric", "album"]);
    const order = $userdata.get(KEYS.MODULES.OPEN_ORDER, []);
    const orderMap = new Map(order.map((id, i) => [id, i]));
    return Object.values(modules)
      .filter((m) => m && m.show === true && !skip.has(m.id) && m.popup !== true)
      .sort((a, b) => (orderMap.get(a.id) ?? Infinity) - (orderMap.get(b.id) ?? Infinity));
  },
  set() {},
});

function onReorder() {
  const ids = openModules.value.map((m) => m.id);
  $userdata.set(KEYS.MODULES.OPEN_ORDER, ids);
}

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
  $modules.close(id);
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
}

.subtabs::-webkit-scrollbar {
  display: none;
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
</style>
