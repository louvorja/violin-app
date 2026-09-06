<template>
  <aside class="liturgy-panel" :class="{ 'liturgy-panel--collapsed': collapsed }">
    <div class="liturgy-panel-header">
      <button
        type="button"
        class="liturgy-icon-btn"
        :title="$t('shell.toggle_liturgy')"
        :aria-label="$t('shell.toggle_liturgy')"
        @click="toggleCollapsed"
      >
        <LjIcon :icon="collapsed ? ICONS.UI.BACK : ICONS.UI.CHEVRON_RIGHT" size="16" />
      </button>
      <LjIcon :icon="ICONS.LITURGY.SCRIPT" size="14" class="liturgy-header-icon" />
      <span class="liturgy-header-title lj-u-truncate">{{ $t("shell.liturgy_title") }}</span>
      <span v-if="!collapsed && totals.count > 0" class="liturgy-totals">
        {{ totals.count }} · {{ totals.duration }}
      </span>
      <button
        v-if="!collapsed"
        type="button"
        class="liturgy-icon-btn"
        :title="$t('shell.edit_liturgy')"
        :aria-label="$t('shell.edit_liturgy')"
        @click="openLiturgy"
      >
        <LjIcon :icon="ICONS.ACTIONS.EDIT" size="13" />
      </button>
    </div>

    <div v-if="!collapsed" class="liturgy-panel-body">
      <LjEmpty
        v-if="items.length === 0"
        :icon="ICONS.CALENDAR.BLANK"
        :title="$t('shell.liturgy_empty')"
      >
        <LjButton size="sm" variant="primary" :icon="ICONS.ACTIONS.ADD" @click="openLiturgy">
          {{ $t("shell.add_item") }}
        </LjButton>
      </LjEmpty>

      <ul v-else class="liturgy-items">
        <template v-for="item in items" :key="item.id">
          <!-- Bloco é rótulo de trecho do culto, não item executável. -->
          <li
            v-if="item.tipo === LiturgyItemTypeEnum.BLOCO"
            class="liturgy-bloco"
            :style="corDoItem(item)"
          >
            <span class="liturgy-bloco-name lj-u-truncate">{{ item.item }}</span>
            <span v-if="item.time" class="liturgy-bloco-time">{{ item.time }}</span>
          </li>

          <li
            v-else
            class="liturgy-item-wrap"
            :class="{ 'liturgy-item-wrap--nested': item.blocoId }"
            :style="corDoBloco(item)"
          >
            <button
              type="button"
              class="liturgy-item"
              :class="{ 'liturgy-item--checked': isChecked(item) }"
              :style="corDoItem(item)"
              :title="tooltipDoItem(item)"
              @click="executar(item)"
            >
              <span class="liturgy-item-bar" />
              <LjIcon :icon="$liturgy.iconForItem(item)" size="14" class="liturgy-item-icon" />
              <span class="liturgy-item-content">
                <span class="liturgy-item-title lj-u-truncate">
                  {{ item.item || item.subitem || "—" }}
                </span>
                <span v-if="item.subitem && item.subitem !== item.item" class="liturgy-item-sub">
                  {{ item.subitem }}
                </span>
              </span>
              <span v-if="item.time" class="liturgy-item-meta">{{ item.time }}</span>
              <span v-else-if="Number(item.duration) > 0" class="liturgy-item-meta">
                {{ item.duration }}min
              </span>
            </button>
          </li>
        </template>
      </ul>
    </div>

    <MusicSpotlight v-model="escolhaAberta" mode="pick" @pick="onMusicaEscolhida" />
  </aside>
</template>

<script setup>
import { LjButton, LjEmpty, LjIcon } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { ref, computed, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import MusicSpotlight from "@/components/MusicSpotlight.vue";
import $liturgy from "@/helpers/Liturgy";
import $userdata from "@/helpers/UserData";
import $modules from "@/helpers/Modules";
import { KEYS } from "@/constants/UserDataKeys";
import { LiturgyItemTypeEnum } from "@/enums/LiturgyItemTypeEnum";
import { useLiturgyExecution } from "@/modules/liturgy/composables/useLiturgyExecution";
import { prepararAgenda } from "@/modules/liturgy/agenda";

const { t } = useI18n();

/**
 * A execução vem do módulo Liturgia — a mesma função que a tela cheia usa.
 * O painel antes tinha uma cópia reduzida que só sabia tocar música e abrir
 * site: anúncio, overlay, som de fundo, vídeo, arquivo e item agendado caíam
 * todos em "abre a tela de liturgia", o que no meio de um culto é devolver o
 * trabalho para o operador.
 */
const { executeItem, playMusic } = useLiturgyExecution();

const collapsed = ref(false);
const escolhaAberta = ref(false);
const itemEmEscolha = ref(null);

// Mesma preparação da tela cheia: os itens agrupados sob o bloco e com a
// hora calculada. Sem ela o painel mostrava outra ordem e nenhum horário.
const items = computed(() => prepararAgenda($liturgy.list()));

const totals = computed(() => {
  const arr = items.value;
  const count = arr.filter((i) => i.tipo !== LiturgyItemTypeEnum.BLOCO).length;
  const totalMin = arr.reduce((s, i) => s + (Number(i.duration) || 0), 0);
  let duration = "—";
  if (totalMin > 0) {
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    duration = h > 0 ? `${h}h${m > 0 ? m + "m" : ""}` : `${m}m`;
  }
  return { count, duration };
});

function toggleCollapsed() {
  collapsed.value = !collapsed.value;
  $userdata.set(KEYS.SHELL.LITURGY_COLLAPSED, collapsed.value);
}

function isChecked(item) {
  return $liturgy.isCheckedToday(item);
}

/** A cor do item é dado do operador; entra como variável, não como token. */
function corDoItem(item) {
  return item.cor ? { "--item-color": item.cor } : {};
}

/** Cor do bloco a que o item pertence, para a faixa tonal de fundo. */
function corDoBloco(item) {
  if (!item.blocoId) return {};
  const bloco = items.value.find(
    (i) => i.tipo === LiturgyItemTypeEnum.BLOCO && i.id === item.blocoId
  );
  return bloco?.cor ? { "--bloco-color": bloco.cor } : {};
}

/** Música ainda sem hino definido — o item existe, o dado não. */
function precisaEscolherMusica(item) {
  return item.tipo === LiturgyItemTypeEnum.MUSICA && (item.escolha || !item.id_music);
}

function tooltipDoItem(item) {
  const nome = item.item || item.subitem || "";
  return precisaEscolherMusica(item) ? `${nome} — ${t("shell.liturgy_pick_music")}` : nome;
}

function openLiturgy() {
  $modules.open("liturgy");
}

function marcar(item) {
  if ($userdata.get(KEYS.MODULES.LITURGY.MARK_ON_ACCESS, true) === false) return;
  if ($liturgy.isCheckedToday(item)) return;
  $liturgy.toggleChecked(item.id);
}

function executar(item) {
  if (precisaEscolherMusica(item)) {
    itemEmEscolha.value = item;
    escolhaAberta.value = true;
    return;
  }
  executeItem(item);
  marcar(item);
}

/**
 * Hino escolhido na hora: toca sem gravar no item. A liturgia guarda a
 * intenção ("um hino aqui"), e qual hino foi cantado neste domingo é decisão do
 * culto — quem quiser fixar edita o item na tela do módulo.
 */
function onMusicaEscolhida(music) {
  const item = itemEmEscolha.value;
  itemEmEscolha.value = null;
  const id = Number(music.id_music);
  if (!item || !Number.isFinite(id)) return;
  playMusic({ ...item, id_music: id, musica: id, escolha: false }, "sung");
  marcar(item);
}

onMounted(() => {
  collapsed.value = $userdata.get(KEYS.SHELL.LITURGY_COLLAPSED, false);
});
</script>

<style scoped>
.liturgy-panel {
  width: var(--lj-sidebar-width);
  flex-shrink: 0;
  background: var(--lj-surface-bg-soft);
  border-left: 1px solid var(--lj-surface-border);
  display: flex;
  flex-direction: column;
  color: var(--lj-text);
  overflow: hidden;
  transition: width var(--lj-transition-slow);
  font-family: var(--lj-font-shell);
}

.liturgy-panel--collapsed {
  width: var(--lj-sidebar-collapsed);
}

/* Header */
.liturgy-panel-header {
  display: flex;
  align-items: center;
  gap: var(--lj-space-3);
  height: var(--lj-tab-height);
  padding: 0 var(--lj-space-3);
  background: var(--lj-surface-bg);
  border-bottom: 1px solid var(--lj-surface-border);
  font-size: var(--lj-text-base);
  font-weight: var(--lj-weight-semibold);
  flex-shrink: 0;
  user-select: none;
}

.liturgy-icon-btn {
  width: var(--lj-ui-h-sm);
  height: var(--lj-ui-h-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: var(--lj-radius-xs);
  cursor: pointer;
  color: inherit;
  opacity: 0.65;
  transition:
    background var(--lj-transition-fast),
    opacity var(--lj-transition-fast);
  font-family: inherit;
}

.liturgy-icon-btn:hover {
  background: var(--lj-hover-bg);
  opacity: 1;
}

.liturgy-icon-btn:focus-visible {
  outline: none;
  box-shadow: var(--lj-ui-focus);
  opacity: 1;
}

.liturgy-header-icon {
  opacity: 0.7;
}

.liturgy-header-title {
  flex: 1;
}

.liturgy-totals {
  font-size: var(--lj-text-sm);
  font-weight: var(--lj-weight-medium);
  opacity: 0.75;
  font-variant-numeric: tabular-nums;
}

/* Body */
.liturgy-panel-body {
  flex: 1;
  overflow-y: auto;
  padding: var(--lj-space-2) var(--lj-space-3) var(--lj-space-5);
}

.liturgy-panel-body::-webkit-scrollbar {
  width: 6px;
}
.liturgy-panel-body::-webkit-scrollbar-thumb {
  background: var(--lj-scrollbar-thumb-bg);
  border-radius: var(--lj-radius-xs);
}

/* Itens */
.liturgy-items {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-1);
}

/* Bloco: rótulo do trecho, sem afordância de clique. */
.liturgy-bloco {
  display: flex;
  align-items: baseline;
  gap: var(--lj-space-3);
  margin-top: var(--lj-space-4);
  padding: var(--lj-space-2) var(--lj-space-2) var(--lj-space-1);
  border-bottom: 1px solid var(--item-color, var(--lj-surface-border-strong));
  color: var(--item-color, var(--lj-text-muted));
  font-size: var(--lj-text-xs);
  font-weight: var(--lj-weight-bold);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  user-select: none;
}

.liturgy-bloco:first-child {
  margin-top: 0;
}

.liturgy-bloco-name {
  flex: 1;
  min-width: 0;
}

.liturgy-bloco-time {
  font-variant-numeric: tabular-nums;
  opacity: 0.8;
}

/* Pertencer ao bloco é dito pela faixa tonal na cor dele — a mesma leitura da
   tela cheia. Um recuo aqui tiraria o item de bloco da coluna do item solto. */
.liturgy-item-wrap--nested {
  padding: 1px var(--lj-space-2);
  margin: 0 calc(var(--lj-space-2) * -1);
  background: color-mix(in srgb, var(--bloco-color, var(--lj-surface-border)) 8%, transparent);
}

.liturgy-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--lj-space-3);
  width: 100%;
  padding: var(--lj-space-2) var(--lj-space-4) var(--lj-space-2) var(--lj-space-6);
  background: var(--lj-surface-bg);
  border: 1px solid var(--lj-surface-border);
  border-radius: var(--lj-radius-sm);
  color: inherit;
  font-family: inherit;
  font-size: var(--lj-text-base);
  text-align: left;
  cursor: pointer;
  transition:
    background var(--lj-transition-fast),
    border-color var(--lj-transition-fast),
    transform 0.05s;
  user-select: none;
}

.liturgy-item:hover {
  background: var(--lj-surface-bg-hover);
  border-color: var(--lj-surface-border-strong);
}

.liturgy-item:focus-visible {
  outline: none;
  box-shadow: var(--lj-ui-focus);
  border-color: var(--lj-ui-accent);
}

.liturgy-item:active {
  transform: scale(0.985);
}

.liturgy-item-bar {
  position: absolute;
  left: 0;
  top: var(--lj-space-2);
  bottom: var(--lj-space-2);
  width: 3px;
  background: var(--item-color, var(--lj-surface-border-strong));
  border-radius: 0 var(--lj-radius-xs) var(--lj-radius-xs) 0;
}

.liturgy-item-icon {
  opacity: 0.7;
  flex-shrink: 0;
}

.liturgy-item-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.liturgy-item-title {
  font-weight: var(--lj-weight-medium);
  line-height: 1.25;
}

.liturgy-item-sub {
  font-size: var(--lj-text-xs);
  opacity: 0.7;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.2;
}

.liturgy-item-meta {
  font-size: var(--lj-text-xs);
  font-variant-numeric: tabular-nums;
  opacity: 0.7;
  flex-shrink: 0;
}

.liturgy-item--checked {
  opacity: 0.55;
}
.liturgy-item--checked .liturgy-item-title {
  text-decoration: line-through;
}
</style>
