<template>
  <ModuleContainer ref="moduleContainer" :manifest="manifest" @show="show" @close="close">
    <template #header>
      <div v-if="compact" class="col-toolbar">
        <LjMenu :items="categoryMenuItems" side="bottom" align="start">
          <template #trigger>
            <LjButton
              variant="ghost"
              icon-only
              :icon="ICONS.UI.MENU"
              :title="t('categories')"
              :aria-label="t('categories')"
            />
          </template>
        </LjMenu>

        <span class="col-toolbar__title">{{ currentCategoryName }}</span>

        <LjButton
          variant="ghost"
          icon-only
          :icon="ICONS.ACTIONS.SEARCH"
          :title="t('music_search.title')"
          :aria-label="t('music_search.title')"
          @click="openMusicSearch"
        />
      </div>
    </template>

    <template #left>
      <nav v-if="!compact" class="col-sidebar" :aria-label="t('title')">
        <LjProgress v-if="loading" indeterminate :height="4" />

        <button type="button" class="col-nav-item" @click="openMusicSearch">
          <Icon :icon="ICONS.ACTIONS.SEARCH" :size="16" />
          <span class="col-nav-item__label">{{ t("music_search.title") }}</span>
        </button>

        <hr class="col-divider" />

        <button
          v-for="category in categories"
          :key="category.id_category"
          type="button"
          class="col-nav-item"
          :class="{ 'is-active': id_category === category.id_category }"
          :aria-current="id_category === category.id_category ? 'true' : undefined"
          @click="setCategory(category.id_category)"
        >
          <span class="col-nav-item__label">{{ category.name }}</span>
        </button>

        <button
          type="button"
          class="col-nav-item col-nav-item--last"
          :class="{ 'is-active': id_category === 0 }"
          :aria-current="id_category === 0 ? 'true' : undefined"
          @click="setCategory(0)"
        >
          <span class="col-nav-item__label">{{ t("all_collections") }}</span>
        </button>
      </nav>
    </template>

    <p v-if="error" class="col-alert" role="alert">{{ error }}</p>

    <div class="collections-scroll" @scroll="onScroll">
      <div class="col-search">
        <LjInput
          v-model="search"
          clearable
          :icon="ICONS.ACTIONS.SEARCH"
          :placeholder="t('music_search.title')"
        />
      </div>

      <div class="col-grid">
        <button
          v-for="album in visibleAlbums"
          :key="album.id_album"
          type="button"
          class="col-album"
          :class="{ 'col-album--wide': width > 350 }"
          :style="album.color ? { background: album.color } : undefined"
          @click="openAlbum(album.id_album)"
        >
          <span v-if="album.url_image" class="col-album__cover">
            <img :src="pathFile(album.url_image)" :alt="album.name" loading="lazy" />
          </span>
          <span class="col-album__text">
            <span class="col-album__name">{{ album.name }}</span>
            <span v-if="album.subtitle" class="col-album__subtitle">{{ album.subtitle }}</span>
          </span>
        </button>
      </div>

      <div v-if="visibleAlbums.length < filteredAlbums.length" class="col-more">
        <LjSpinner :size="24" />
      </div>
    </div>
  </ModuleContainer>
</template>

<script setup>
import { ref, computed, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { useDisplay } from "vuetify";
import { module as manifest } from "../manifest";
import ModuleContainer from "@/components/ModuleContainer.vue";
import Icon from "@/components/Icon.vue";
import { LjButton, LjInput, LjMenu, LjProgress, LjSpinner } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import Strings from "@/helpers/Strings";
import Database from "@/helpers/Database";
import Modules from "@/helpers/Modules";
import Media from "@/composables/useMedia";
import Path from "@/helpers/Path";
import $userdata from "@/helpers/UserData";
import { KEYS } from "@/constants/UserDataKeys";
import { useShell } from "@/composables/useShell";

const { locale } = useI18n();
const { width } = useDisplay();
const shell = useShell();

const moduleContainer = ref(null);
const categories = ref([]);
const lang = ref(null);
const id_category = ref(null);
const loading = ref(false);
const error = ref(null);

const albums = computed(() => {
  const disabled = $userdata.get(KEYS.OPTIONS.DISABLED_ALBUMS, []) || [];
  const activeOnly = (list) =>
    (list || []).filter((album) => !disabled.includes(Number(album.id_album)));

  if (!categories.value) return [];
  if (!id_category.value) {
    return [
      ...new Map(
        categories.value
          .reduce((acc, category) => acc.concat(activeOnly(category.albums)), [])
          .map((album) => [album.id_album, { ...album, subtitle: null }])
      ).values(),
    ].sort((a, b) => Strings.sort(a.name, b.name));
  }
  return activeOnly(
    categories.value.filter((item) => item.id_category === id_category.value)[0]?.albums
  ).sort((a, b) => a.order - b.order);
});

const compact = computed(() => width.value <= 600);

// Scroll infinito: renderiza os álbuns em páginas à medida que se rola.
const PAGE_SIZE = 30;
const visibleCount = ref(PAGE_SIZE);
const search = ref("");

const filteredAlbums = computed(() => {
  const q = Strings.clean(search.value);
  // Busca textual só filtra a partir de 4 caracteres (performance).
  if (!q || q.length < 4) return albums.value;
  return albums.value.filter((a) => Strings.clean(a.name).includes(q));
});

const visibleAlbums = computed(() => visibleAlbumsFrom(filteredAlbums.value));

function visibleAlbumsFrom(list) {
  return list.slice(0, visibleCount.value);
}

function showMore() {
  if (visibleCount.value < filteredAlbums.value.length) {
    visibleCount.value += PAGE_SIZE;
  }
}

function onScroll(event) {
  const el = event.currentTarget;
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 200) showMore();
}

const t = (key) => moduleContainer.value?.t(key) || key;
const pathFile = (img) => Path.file(img);

// Título da barra compacta: nome da categoria atual ou "todas as coletâneas".
const currentCategoryName = computed(() => {
  if (!id_category.value) return t("all_collections");
  return categories.value.find((c) => c.id_category === id_category.value)?.name || "";
});

// Mesma lista da sidebar, servida como menu na largura compacta.
const categoryMenuItems = computed(() => [
  ...categories.value.map((category) => ({
    label: category.name,
    checked: id_category.value === category.id_category,
    action: () => setCategory(category.id_category),
  })),
  { separator: true },
  {
    label: t("all_collections"),
    checked: id_category.value === 0,
    action: () => setCategory(0),
  },
]);

async function loadData() {
  id_category.value = null;
  categories.value = [];
  visibleCount.value = PAGE_SIZE;
  loading.value = true;

  categories.value = await Database.get(`${locale.value}_categories`);

  if (categories.value == null) {
    Modules.close(manifest.id);
    return;
  }

  if (categories.value.length > 0) {
    categories.value.sort((a, b) => a.order - b.order);
    id_category.value = categories.value[0].id_category;
  } else {
    id_category.value = 0;
  }

  lang.value = locale.value;
  loading.value = false;
}

function setCategory(id = null) {
  id_category.value = id;
  visibleCount.value = PAGE_SIZE;
}

function openAlbum(id_album) {
  Media.openAlbum(id_album);
}

function openMusicSearch() {
  shell.openMusicSearch();
}

async function show(value) {
  if (value && lang.value !== locale.value) {
    await loadData();
  } else if (value && categories.value.length > 0 && id_category.value === null) {
    id_category.value = categories.value[0].id_category;
  }
}

function close() {
  id_category.value = null;
}

onMounted(async () => {
  await loadData();
});
</script>

<style scoped>
/* ---- barra compacta (largura <= 600px) ---- */
.col-toolbar {
  display: flex;
  align-items: center;
  gap: var(--lj-space-4);
  width: 100%;
  min-width: 0;
}

.col-toolbar__title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: var(--lj-text-lg);
  font-weight: var(--lj-weight-medium);
}

/* ---- lista lateral de categorias ---- */
.col-sidebar {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-1);
  width: 200px;
  height: 100%;
  padding: var(--lj-space-2);
}

.col-nav-item {
  display: flex;
  align-items: center;
  gap: var(--lj-space-4);
  width: 100%;
  padding: var(--lj-space-3) var(--lj-space-4);
  border: none;
  border-radius: var(--lj-radius-sm);
  background: transparent;
  color: var(--lj-text);
  font-family: inherit;
  font-size: var(--lj-text-base);
  text-align: left;
  cursor: pointer;
  transition:
    background var(--lj-transition-fast),
    color var(--lj-transition-fast);
}

.col-nav-item:hover {
  background: var(--lj-surface-bg-hover);
}

.col-nav-item:focus-visible {
  outline: none;
  box-shadow: var(--lj-ui-focus);
}

.col-nav-item.is-active {
  background: var(--lj-ui-accent-soft);
  color: var(--lj-ui-accent-text);
  font-weight: var(--lj-weight-medium);
}

.col-nav-item__label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

/* Empurra "todas as coletâneas" para o fim da coluna. */
.col-nav-item--last {
  margin-top: auto;
}

.col-divider {
  height: 1px;
  margin: var(--lj-space-2) 0;
  border: none;
  background: var(--lj-surface-divider);
}

/* ---- corpo ---- */
.col-alert {
  margin: var(--lj-space-4);
  padding: var(--lj-space-4) var(--lj-space-5);
  border-left: 3px solid var(--lj-danger);
  border-radius: var(--lj-radius-sm);
  background: var(--lj-danger-soft);
  color: var(--lj-alert-error-color);
  font-size: var(--lj-text-base);
}

.collections-scroll {
  height: 100%;
  overflow-y: auto;
}

.col-search {
  padding: var(--lj-space-4) var(--lj-space-6) 0;
}

.col-search :deep(.lj-input) {
  width: 100%;
}

.col-grid {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: var(--lj-space-4);
  padding: var(--lj-space-4);
}

/* Cartão de álbum: a cor vem do banco (album.color); sem ela, cai num cinza
   escuro do sistema — o texto é sempre claro, como no cartão dark original. */
.col-album {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--lj-space-5);
  width: 100%;
  padding: var(--lj-space-5);
  border: none;
  border-radius: var(--lj-radius-md);
  background: var(--lj-gray-700);
  color: var(--lj-white);
  box-shadow: var(--lj-shadow-1);
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  overflow: hidden;
  transition: box-shadow var(--lj-transition-normal);
}

.col-album:hover {
  box-shadow: var(--lj-shadow-2);
}

.col-album:focus-visible {
  outline: none;
  box-shadow: var(--lj-ui-focus);
}

.col-album--wide {
  min-width: 300px;
  max-width: 300px;
}

.col-album__cover {
  display: block;
  flex-shrink: 0;
  width: 75px;
  height: 75px;
}

.col-album--wide .col-album__cover {
  width: 125px;
  height: 125px;
}

.col-album__cover img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.col-album__text {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  gap: var(--lj-space-2);
}

.col-album__name {
  font-size: var(--lj-text-xl);
  font-weight: var(--lj-weight-medium);
  line-height: 1.3;
  overflow-wrap: anywhere;
}

.col-album__subtitle {
  font-size: var(--lj-text-base);
  opacity: 0.85;
  overflow-wrap: anywhere;
}

.col-more {
  display: flex;
  justify-content: center;
  padding: var(--lj-space-6);
  color: var(--lj-text-muted);
}
</style>
