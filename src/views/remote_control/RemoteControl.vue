<template>
  <div class="rc-root">
    <!-- Carregando -->
    <div v-if="loading" class="rc-loading" role="presentation">
      <LjSpinner :size="48" />
    </div>

    <header class="rc-topbar">
      <h1 class="rc-topbar__title">{{ t("options.transmission.remote_control") }}</h1>
      <span class="lj-u-spacer" />
      <div class="rc-topbar__refresh">
        <LjButton
          size="touch"
          variant="ghost"
          icon-only
          :icon="ICONS.ACTIONS.REFRESH"
          :aria-label="t('remote_control.sync.refresh')"
          @click="refreshState"
        />
      </div>
    </header>

    <div class="rc-tabs">
      <LjTabs
        v-model="tab"
        :tabs="tabItems"
        :aria-label="t('options.transmission.remote_control')"
      />
    </div>

    <div class="rc-content">
      <!-- Tab Músicas -->
      <div v-if="isBooted('music')" v-show="tab === 'music'" class="rc-pane">
        <remote-music
          v-model:tab="tab"
          v-model:choose-later-mode="chooseLaterMode"
          v-model:choose-later-item="chooseLaterItem"
          :token="token"
          @show-snackbar="showSnackbar"
        />
      </div>

      <!-- Tab Bíblia -->
      <div v-if="isBooted('bible')" v-show="tab === 'bible'" class="rc-pane">
        <remote-bible
          ref="bibleRef"
          v-model:active-bible="activeBible"
          :token="token"
          @show-snackbar="showSnackbar"
        />
      </div>

      <!-- Tab Liturgia -->
      <div v-if="isBooted('liturgy')" v-show="tab === 'liturgy'" class="rc-pane">
        <remote-liturgy
          ref="liturgyRef"
          v-model:tab="tab"
          :token="token"
          @show-snackbar="showSnackbar"
          @open-choose-later="openChooseLater"
        />
      </div>

      <!-- Tab Slides (Controle) -->
      <div v-if="isBooted('slides')" v-show="tab === 'slides'" class="rc-pane">
        <remote-slides
          v-model:current-slide-index="currentSlideIndex"
          :token="token"
          :slides="slides"
          :current-title="currentTitle"
          @show-snackbar="showSnackbar"
        />
      </div>

      <!-- Tab Anúncios -->
      <div v-if="isBooted('announcements')" v-show="tab === 'announcements'" class="rc-pane">
        <remote-announcements
          ref="announcementsRef"
          :token="token"
          @show-snackbar="showSnackbar"
          @update:ann-projecting="annProjecting = $event"
        />
      </div>
    </div>

    <!-- Controles fixos na parte inferior -->
    <footer v-if="tab === 'slides' && slides.length > 0" class="rc-footer">
      <div class="rc-footer__nav">
        <LjButton
          size="touch"
          variant="subtle"
          icon-only
          :icon="ICONS.ACTIONS.PREVIOUS"
          :aria-label="t('actions.previous')"
          :disabled="currentSlideIndex <= 0"
          @click="prevSlide"
        />
        <span class="rc-footer__status">{{ currentSlideIndex + 1 }} / {{ slides.length }}</span>
        <LjButton
          size="touch"
          variant="subtle"
          icon-only
          :icon="ICONS.ACTIONS.NEXT"
          :aria-label="t('actions.next')"
          :disabled="currentSlideIndex >= slides.length - 1"
          @click="nextSlide"
        />
      </div>
      <LjDivider />
      <button type="button" class="rc-action rc-action--danger" @click="closeMedia">
        <Icon :icon="ICONS.ACTIONS.CANCEL" :size="20" />
        <span>{{ t("remote_control.slides.close_projection") }}</span>
      </button>
    </footer>

    <footer v-if="tab === 'bible'" class="rc-footer">
      <div class="rc-footer__nav">
        <LjButton
          size="touch"
          variant="subtle"
          icon-only
          :icon="ICONS.ACTIONS.PREVIOUS"
          :aria-label="t('actions.previous')"
          @click="prevVerseRemote"
        />
        <span class="rc-footer__status">{{ activeBible.reference }}</span>
        <LjButton
          size="touch"
          variant="subtle"
          icon-only
          :icon="ICONS.ACTIONS.NEXT"
          :aria-label="t('actions.next')"
          @click="nextVerseRemote"
        />
      </div>
      <LjDivider />
      <div class="rc-footer__split">
        <button type="button" class="rc-action" @click="closeBible">
          <Icon :icon="ICONS.UI.MONITOR" :size="20" />
          <span>{{ t("remote_control.bible.clear_screen") }}</span>
        </button>
        <button type="button" class="rc-action rc-action--end" @click="closeProjection">
          <span>{{ t("remote_control.bible.close_projection") }}</span>
          <Icon :icon="ICONS.PROJECTION.SCREEN" :size="20" />
        </button>
      </div>
    </footer>

    <footer v-if="tab === 'announcements'" class="rc-footer">
      <div class="rc-footer__nav">
        <LjButton
          size="touch"
          variant="subtle"
          icon-only
          :icon="ICONS.ACTIONS.PREVIOUS"
          :aria-label="t('actions.previous')"
          @click="annPrev"
        />
        <span class="rc-footer__status">{{ t("remote_control.announcements.controls") }}</span>
        <LjButton
          size="touch"
          variant="subtle"
          icon-only
          :icon="ICONS.ACTIONS.NEXT"
          :aria-label="t('actions.next')"
          @click="annNext"
        />
      </div>
      <LjDivider />
      <button type="button" class="rc-action rc-action--danger" @click="annStop">
        <Icon :icon="ICONS.ACTIONS.CANCEL" :size="20" />
        <span>{{ t("remote_control.announcements.stop_projection") }}</span>
      </button>
    </footer>

    <!-- Diálogo de token inválido -->
    <LjDialog
      v-model="isTokenInvalid"
      persistent
      size="sm"
      :title="t('remote_control.token_invalid.title')"
      :icon="ICONS.UI.ALERT_CIRCLE"
      icon-variant="danger"
    >
      <p class="rc-dialog-text">{{ t("remote_control.token_invalid.message") }}</p>
      <template #footer>
        <LjButton size="touch" variant="primary" @click="isTokenInvalid = false">
          {{ t("alert.close") }}
        </LjButton>
      </template>
    </LjDialog>

    <!-- Aviso de feedback -->
    <LjToast
      v-model="snackbar.show"
      :text="snackbar.text"
      :variant="snackbarVariant"
      :timeout="2000"
    />
  </div>
</template>

<script setup>
import { ref, onMounted, computed, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute } from "vue-router";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import { useBroadcastListener } from "@/composables/useBroadcastListener";
import { isTokenInvalid, apiFetch } from "@/helpers/ApiClient";
import Icon from "@/components/Icon.vue";
import { LjButton, LjDialog, LjDivider, LjSpinner, LjTabs, LjToast } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import RemoteMusic from "./RemoteMusic.vue";
import RemoteBible from "./RemoteBible.vue";
import RemoteLiturgy from "./RemoteLiturgy.vue";
import RemoteSlides from "./RemoteSlides.vue";
import RemoteAnnouncements from "./RemoteAnnouncements.vue";

/** @typedef {import('@/types/Bible').ActiveBibleState} ActiveBibleState */

const { t } = useI18n();
const route = useRoute();

const tab = ref("music");
const loading = ref(true);
const snackbar = ref({ show: false, text: "", color: "" });
const token = computed(() => getToken());

isTokenInvalid.value = false;

const bibleRef = ref(null);
const liturgyRef = ref(null);
const announcementsRef = ref(null);

const tabItems = computed(() => [
  { value: "music", label: t("module_group.musics.title"), icon: ICONS.MUSIC.NOTE },
  { value: "bible", label: t("module_group.bible.title"), icon: ICONS.BIBLE.BOOK_OPEN },
  { value: "liturgy", label: t("modules.liturgy.name"), icon: ICONS.FORMAT.LIST_BULLETED },
  { value: "slides", label: t("remote_control.tabs.slides"), icon: ICONS.UI.VIEW_GRID },
  {
    value: "announcements",
    label: t("remote_control.tabs.announcements"),
    icon: ICONS.MODULES.ANNOUNCEMENTS,
  },
]);

// O `v-window-item` do Vuetify montava a aba no primeiro acesso e a mantinha
// montada dali em diante (só escondia). As telas dependem disso: os `ref`
// continuam válidos e a busca digitada não se perde ao trocar de aba.
const bootedTabs = ref(new Set([tab.value]));
const isBooted = (name) => bootedTabs.value.has(name);
watch(tab, (newTab) => bootedTabs.value.add(newTab));

const TOAST_VARIANTS = ["info", "success", "warning", "error"];
const snackbarVariant = computed(() =>
  TOAST_VARIANTS.includes(snackbar.value.color) ? snackbar.value.color : "info"
);

// --- Anúncios ---
const annProjecting = ref(false);

/** @type {import('vue').Ref<ActiveBibleState>} */
const activeBible = ref({
  active: false,
  reference: "",
  bookId: null,
  chapter: null,
  verse: null,
  chapterVerses: [],
  versionId: null,
});

// --- Choose Later (Spotlight) ---
const chooseLaterMode = ref(false);
const chooseLaterItem = ref(null);

// Helper para pegar o token de forma robusta (query ou hash query)
const getToken = () => {
  if (route.query.token) return route.query.token;
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.has("token")) return urlParams.get("token");
  const hash = window.location.hash;
  if (hash.includes("?")) {
    const hashParams = new URLSearchParams(hash.split("?")[1]);
    return hashParams.get("token") || "";
  }
  return "";
};

function openChooseLater(item) {
  chooseLaterItem.value = item;
  chooseLaterMode.value = true;
  tab.value = "music";
}

// --- Liturgia ---
watch(tab, (newTab) => {
  if (newTab === "liturgy" && liturgyRef.value) {
    liturgyRef.value.refresh();
  }
});

// --- Slides ---
const slides = ref([]);
const currentSlideIndex = ref(0);
const currentTitle = ref("");

useBroadcastListener(BROADCAST_TYPE.SLIDES_DATA, (payload) => {
  slides.value = payload.slides || [];
  currentTitle.value = payload.title || "";
  currentSlideIndex.value = payload.slide_index ?? 0;
});

useBroadcastListener(BROADCAST_TYPE.SLIDE_CHANGE, (payload) => {
  currentSlideIndex.value = payload.slide_index ?? 0;
  if (payload.title) currentTitle.value = payload.title;
});

useBroadcastListener(BROADCAST_TYPE.BIBLE_VERSE, async (payload) => {
  activeBible.value.active = !!payload.active;
  activeBible.value.reference = payload.reference || "";
  activeBible.value.versionId = payload.versionId || null;

  if (!payload.active) {
    activeBible.value.chapterVerses = [];
    return;
  }

  if (payload.bookId && payload.chapter) {
    activeBible.value.bookId = Number(payload.bookId);
    activeBible.value.chapter = payload.chapter;
    activeBible.value.verse = payload.verses?.[0] || 1;
    await loadBibleChapter();

    // Sincroniza os selects do RemoteBible se ele estiver montado
    if (bibleRef.value?.loadBibleChapter) {
      bibleRef.value.loadBibleChapter(payload);
    }
  }
});

async function loadBibleChapter() {
  if (!activeBible.value.bookId || !activeBible.value.chapter) return;

  const bookId = Number(activeBible.value.bookId);
  let versionId = activeBible.value.versionId;
  if (!versionId) {
    versionId = await getPreferredBibleVersion();
  }
  if (!versionId) return;

  const dbKey = `bible_${versionId}_${bookId}_${activeBible.value.chapter}`;

  const Database = (await import("@helpers/Database")).default;
  const chapterData = await Database.get(dbKey);
  if (chapterData) {
    const verseKeys = Object.keys(chapterData)
      .map(Number)
      .filter((n) => !isNaN(n));
    const maxV = verseKeys.length > 0 ? Math.max(...verseKeys) : 0;
    const arr = [];
    for (let i = 1; i <= maxV; i++) {
      arr.push(chapterData[i] || chapterData[String(i)] || "");
    }
    activeBible.value.chapterVerses = arr;
  }
}

async function getPreferredBibleVersion() {
  try {
    const res = await apiFetch(`/api/user-data?path=id_bible_version&token=${token.value}`);
    if (res.ok) {
      const data = await res.json();
      return data.value;
    }
  } catch (e) {
    console.error("Erro ao buscar versão da bíblia:", e);
  }
  return null;
}

function nextVerseRemote() {
  const current = activeBible.value.verse || 1;
  const total = activeBible.value.chapterVerses.length;
  if (current < total) {
    const newVerse = current + 1;
    activeBible.value.verse = newVerse;
    updateVerseReference(newVerse);
  }
  apiFetch(`/api/bible?action=next&token=${token.value}`).catch(() =>
    showSnackbar(t("remote_control.errors.generic"), "error")
  );
}

function prevVerseRemote() {
  const current = activeBible.value.verse || 1;
  if (current > 1) {
    const newVerse = current - 1;
    activeBible.value.verse = newVerse;
    updateVerseReference(newVerse);
  }
  apiFetch(`/api/bible?action=prev&token=${token.value}`).catch(() =>
    showSnackbar(t("remote_control.errors.generic"), "error")
  );
}

function updateVerseReference(verse) {
  const ref = activeBible.value.reference;
  if (ref) {
    activeBible.value.reference = ref.replace(/:(\d+)/, `:${verse}`);
  }
}

async function closeBible() {
  try {
    await apiFetch(`/api/bible?action=close&token=${token.value}`);
    activeBible.value.active = false;
    showSnackbar(t("remote_control.bible.screen_cleaned"));
  } catch (e) {
    console.error("Erro ao fechar bíblia:", e);
  }
}
async function closeProjection() {
  try {
    await apiFetch(`/api/song-slides?action=close&token=${token.value}`);
    activeBible.value.active = false;
    activeBible.value.chapterVerses = [];
    showSnackbar(t("remote_control.bible.projection_closed"));
  } catch (e) {
    console.error("Erro ao fechar bíblia:", e);
  }
}

function nextSlide() {
  if (currentSlideIndex.value < slides.value.length - 1) {
    goToSlide(currentSlideIndex.value + 1);
  }
}

function prevSlide() {
  if (currentSlideIndex.value > 0) {
    goToSlide(currentSlideIndex.value - 1);
  }
}

function goToSlide(index) {
  currentSlideIndex.value = index;
  apiFetch(`/api/song-slides?action=go-to-slide&index=${index}&token=${token.value}`).catch(() =>
    showSnackbar(t("remote_control.slides.error_change"), "error")
  );
}

async function closeMedia() {
  try {
    await apiFetch(`/api/song-slides?action=close&token=${token.value}`);
    slides.value = [];
    currentTitle.value = "";
    showSnackbar(t("remote_control.slides.projection_closed"));
  } catch (e) {
    console.error("Erro ao fechar mídia:", e);
  }
}

function showSnackbar(text, color = "success") {
  snackbar.value = { show: true, text, color };
}

function annNext() {
  apiFetch(`/api/announcements?action=next&token=${token.value}`).catch(() =>
    showSnackbar(t("remote_control.errors.generic"), "error")
  );
}

function annPrev() {
  apiFetch(`/api/announcements?action=prev&token=${token.value}`).catch(() =>
    showSnackbar(t("remote_control.errors.generic"), "error")
  );
}

async function annStop() {
  try {
    await apiFetch(`/api/announcements?action=stop&token=${token.value}`);
    annProjecting.value = false;
    showSnackbar(t("remote_control.announcements.projection_closed"));
  } catch (e) {
    console.error("Erro ao parar anúncios:", e);
  }
}

async function refreshState() {
  showSnackbar(t("remote_control.sync.syncing"));
  try {
    if (tab.value === "liturgy" && liturgyRef.value) {
      await liturgyRef.value.refresh();
    } else if (tab.value === "bible" && bibleRef.value) {
      await bibleRef.value.refresh();
    } else if (tab.value === "announcements" && announcementsRef.value) {
      await announcementsRef.value.refresh();
    }
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  await refreshState();
});
</script>

<!-- Sem `scoped`: o diálogo de token vai para um portal no <body> e o atributo
     de escopo não chega lá. O isolamento vem do prefixo `rc-`. -->
<style>
.rc-root {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--lj-surface-bg-soft);
  color: var(--lj-text);
  font-family: var(--lj-font-shell);
  font-size: var(--lj-text-base);
}

/* --- Cabeçalho --- */
.rc-topbar {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: var(--lj-space-4);
  height: 48px;
  padding-inline: var(--lj-space-6);
  background: var(--lj-titlebar-bg);
  color: var(--lj-titlebar-color);
}

.rc-topbar__title {
  margin: 0;
  overflow: hidden;
  font-size: var(--lj-text-xl);
  font-weight: var(--lj-weight-medium);
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* O botão fantasma nasce com a cor de texto da superfície — sobre o navy do
   cabeçalho ele precisa herdar o branco da barra. */
.rc-topbar .rc-topbar__refresh .lj-btn {
  color: var(--lj-titlebar-color);
}

.rc-topbar .rc-topbar__refresh .lj-btn:hover {
  background: var(--lj-white-alpha-10);
  color: var(--lj-titlebar-color);
}

/* --- Abas --- */
.rc-tabs {
  flex-shrink: 0;
  background: var(--lj-surface-bg);
}

/* Cinco abas não cabem na largura de um celular: a faixa rola na horizontal,
   sem barra visível, como fazia o `v-tabs`. */
.rc-tabs .lj-tabs__list {
  justify-content: center;
  justify-content: safe center;
  overflow-x: auto;
  scrollbar-width: none;
}

.rc-tabs .lj-tabs__list::-webkit-scrollbar {
  display: none;
}

/* Alvo de toque confortável — a altura de aba do shell é pensada para mouse. */
.rc-tabs .lj-tabs__list .lj-tabs__trigger {
  flex-shrink: 0;
  height: auto;
  min-height: 44px;
  white-space: nowrap;
}

/* --- Conteúdo --- */
.rc-content {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.rc-pane {
  height: 100%;
}

/* --- Rodapé de controles --- */
.rc-footer {
  flex-shrink: 0;
  background: var(--lj-surface-bg);
  border-top: 1px solid var(--lj-surface-border);
}

.rc-footer__nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--lj-space-5);
  padding: var(--lj-space-6);
}

.rc-footer__status {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--lj-text-muted);
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rc-footer__split {
  display: flex;
  align-items: center;
  gap: var(--lj-space-4);
}

.rc-action {
  display: flex;
  flex: 1;
  align-items: center;
  gap: var(--lj-space-4);
  min-height: 48px;
  padding: var(--lj-space-5) var(--lj-space-6);
  background: transparent;
  border: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.rc-action--end {
  justify-content: flex-end;
  text-align: right;
}

.rc-action--danger {
  color: var(--lj-alert-error-color, var(--lj-danger));
}

.rc-action:hover {
  background: var(--lj-surface-bg-hover);
}

.rc-action:active {
  background: var(--lj-surface-bg-active);
}

.rc-action:focus-visible {
  outline: none;
  box-shadow: var(--lj-ui-focus);
}

/* --- Carregando --- */
.rc-loading {
  position: fixed;
  inset: 0;
  z-index: 2400;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--lj-black-alpha-40);
  color: var(--lj-white);
}

/* --- Diálogo (conteúdo teleportado) --- */
.rc-dialog-text {
  margin: 0;
  line-height: 1.5;
}
</style>
