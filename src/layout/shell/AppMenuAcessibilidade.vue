<template>
  <div class="opt">
    <section class="opt-section">
      <h3 class="opt-section-title">
        <Icon :icon="ICONS.UI.ACCESSIBILITY" :size="18" />
        {{ $t("accessibility.title") }}
      </h3>

      <div class="opt-stats opt-stats--compact">
        <div class="opt-stat">
          <span class="opt-stat-label">
            {{ $t(statsLoading ? "accessibility.stats.loading" : "accessibility.stats.total") }}
          </span>
          <span v-if="!statsLoading" class="opt-stat-value">
            {{
              $t("accessibility.stats.usage", {
                size: Libras.humanSize(stats.total_bytes),
                count: stats.total_entries,
                type: stats.total_entries === 1 ? "item" : "itens",
              })
            }}
          </span>
        </div>
      </div>
    </section>

    <LjAlert
      v-if="internetHintVisible"
      variant="info"
      :icon="ICONS.UI.INFORMATION_OUTLINE"
      dismissible
      class="acc-hint"
      @dismiss="internetHintVisible = false"
    >
      {{ $t("accessibility.internet_hint") }}
    </LjAlert>

    <!-- O traço sob as abas vem do próprio LjTabs; não há divisória extra. -->
    <LjTabs
      v-model="activeTab"
      :tabs="tabItems"
      :aria-label="$t('accessibility.title')"
      class="acc-tabs"
    />

    <div class="acc-panes">
      <!-- ═══ Aba Avatar ═══ -->
      <section v-if="isBooted('avatar')" v-show="activeTab === 'avatar'" class="opt-section">
        <div class="acc-grid acc-grid--3">
          <div>
            <div class="opt-row">
              <span class="opt-label">{{ $t("accessibility.avatar.enable_projection") }}</span>
              <LjSwitch v-model="librasEnabled" @update:model-value="toggleLibrasEnabled" />
            </div>
            <div class="opt-row">
              <span class="opt-label">{{ $t("accessibility.avatar.translate_musics") }}</span>
              <LjSwitch
                v-model="librasMusicsEnabled"
                :disabled="!librasEnabled"
                @update:model-value="toggleMusicsEnabled"
              />
            </div>
            <div class="opt-row">
              <span class="opt-label">{{ $t("accessibility.avatar.translate_bible") }}</span>
              <LjSwitch
                v-model="librasBibleEnabled"
                :disabled="!librasEnabled"
                @update:model-value="toggleBibleEnabled"
              />
            </div>
            <div class="opt-row">
              <span class="opt-label">{{ $t("accessibility.avatar.show_on_obs") }}</span>
              <LjSwitch v-model="showOnObs" @update:model-value="toggleShowOnObs" />
            </div>
          </div>

          <div>
            <p class="opt-hint">{{ $t("accessibility.avatar.hint") }}</p>
            <div class="opt-download-scroll">
              <div class="opt-download-list">
                <label
                  v-for="option in avatarOptions"
                  :key="option.value"
                  class="opt-checkbox opt-album"
                >
                  <input
                    type="radio"
                    :value="option.value"
                    :checked="selectedAvatar === option.value"
                    @change="selectAvatar(option.value)"
                  />
                  <span>{{ option.label }}</span>
                </label>
              </div>
            </div>
          </div>

          <div>
            <!-- Cor de fundo do avatar -->
            <span class="opt-label">{{ $t("accessibility.avatar.background_color") }}</span>
            <div class="opt-row">
              <LjSwitch
                v-model="transparentBg"
                :label="t('accessibility.avatar.bg_transparent')"
                @update:model-value="toggleTransparentBg"
              />
            </div>

            <!-- Sem primitivo de cor no catálogo: seletor nativo do sistema,
                 paleta em botões e alfa em slider. O valor gravado continua
                 sendo o mesmo hex de 8 dígitos de antes. -->
            <div v-if="!transparentBg" class="acc-color">
              <div class="acc-color__pick">
                <input
                  type="color"
                  class="opt-color"
                  :value="bgColorHex"
                  :aria-label="$t('accessibility.avatar.background_color')"
                  @input="setBgColorHex(($event.target as HTMLInputElement).value)"
                />
                <span class="acc-color__value">{{ bgColorHex }}</span>
              </div>

              <div
                class="acc-color__swatches"
                role="group"
                :aria-label="$t('accessibility.avatar.bg_swatches')"
              >
                <button
                  v-for="hex in bgSwatchHexes"
                  :key="hex"
                  type="button"
                  class="acc-color__swatch"
                  :class="{ 'acc-color__swatch--active': bgColorHex === hex }"
                  :style="{ background: hex }"
                  :title="hex"
                  :aria-label="hex"
                  :aria-pressed="bgColorHex === hex"
                  @click="setBgColorHex(hex)"
                />
              </div>

              <LjField :label="$t('accessibility.avatar.bg_opacity')" layout="column">
                <LjSlider
                  :model-value="bgAlphaPercent"
                  :min="0"
                  :max="100"
                  :step="1"
                  show-value
                  unit="%"
                  @update:model-value="setBgAlphaPercent"
                />
              </LjField>
            </div>
          </div>
        </div>

        <div class="opt-divider" />

        <div class="acc-grid acc-grid--435">
          <div>
            <!-- Posição -->
            <div class="opt-label acc-block-label">{{ $t("accessibility.avatar.position") }}</div>
            <div class="position-options">
              <button
                v-for="a in anchorOptions"
                :key="a.value"
                type="button"
                class="position-btn"
                :class="{ 'position-btn--active': currentAnchor === a.value }"
                :aria-pressed="currentAnchor === a.value"
                @click="setAnchor(a.value)"
              >
                <Icon :icon="a.icon" :size="18" />
                {{ a.label }}
              </button>
            </div>

            <div class="opt-row acc-row--spaced">
              <span class="opt-label">{{ $t("accessibility.avatar.show_border") }}</span>
              <LjSwitch v-model="showBorder" @update:model-value="toggleShowBorder" />
            </div>
          </div>

          <div>
            <!-- Deslocamento -->
            <div class="opt-label acc-block-label">{{ $t("accessibility.avatar.align_hint") }}</div>
            <div class="acc-pair">
              <LjField :label="$t('accessibility.avatar.offset_x')" layout="column">
                <LjInput
                  :model-value="currentOffsetX"
                  type="number"
                  @update:model-value="setOffsetX(Number($event))"
                >
                  <template #suffix><span class="acc-suffix">px</span></template>
                </LjInput>
              </LjField>
              <LjField :label="$t('accessibility.avatar.offset_y')" layout="column">
                <LjInput
                  :model-value="currentOffsetY"
                  type="number"
                  @update:model-value="setOffsetY(Number($event))"
                >
                  <template #suffix><span class="acc-suffix">px</span></template>
                </LjInput>
              </LjField>
            </div>

            <!-- Tamanho -->
            <div class="opt-label acc-block-label acc-block-label--gap">
              {{ $t("accessibility.avatar.size_hint") }}
            </div>
            <div class="acc-pair">
              <LjField :label="$t('accessibility.avatar.width')" layout="column">
                <LjInput
                  :model-value="currentWidth"
                  type="number"
                  :min="100"
                  @update:model-value="setWidth(Number($event))"
                >
                  <template #suffix><span class="acc-suffix">px</span></template>
                </LjInput>
              </LjField>
              <LjField :label="$t('accessibility.avatar.height')" layout="column">
                <LjInput
                  :model-value="currentHeight"
                  type="number"
                  :min="150"
                  @update:model-value="setHeight(Number($event))"
                >
                  <template #suffix><span class="acc-suffix">px</span></template>
                </LjInput>
              </LjField>
            </div>
          </div>

          <div class="acc-anim">
            <div class="acc-pair">
              <!-- Animação de entrada -->
              <LjField :label="$t('accessibility.avatar.animation')" layout="column">
                <LjSelect
                  v-model="currentAnimation"
                  :items="animationOptions"
                  item-label="title"
                  @update:model-value="setAnimation(String($event))"
                />
              </LjField>
              <!-- Duração da entrada -->
              <LjField :label="$t('accessibility.avatar.animation_duration')" layout="column">
                <LjSlider
                  v-model="currentAnimationDuration"
                  :min="0"
                  :max="3000"
                  :step="100"
                  show-value
                  unit="ms"
                  @update:model-value="setAnimationDuration"
                />
              </LjField>
            </div>

            <div class="acc-pair">
              <!-- Animação de saída -->
              <LjField :label="$t('accessibility.avatar.exit_animation')" layout="column">
                <LjSelect
                  v-model="currentExitAnimation"
                  :items="animationOptions"
                  item-label="title"
                  @update:model-value="setExitAnimation(String($event))"
                />
              </LjField>
              <!-- Duração da saída -->
              <LjField :label="$t('accessibility.avatar.exit_animation_duration')" layout="column">
                <LjSlider
                  v-model="currentExitAnimationDuration"
                  :min="0"
                  :max="3000"
                  :step="100"
                  show-value
                  unit="ms"
                  @update:model-value="setExitAnimationDuration"
                />
              </LjField>
            </div>
          </div>
        </div>

        <!--       TODO atualizar api para suportar essas opções
           Opções desativadas, pois a api nao suporta atualmente
-->
        <div class="opt-divider acc-hidden" />
        <div class="acc-grid acc-grid--3 acc-hidden">
          <!-- Velocidade dos gestos -->
          <LjField :label="$t('accessibility.avatar.speed')" layout="column">
            <div class="acc-select--narrow">
              <LjSelect
                v-model="currentSpeed"
                :items="speedOptions"
                item-label="title"
                @update:model-value="setSpeed(Number($event))"
              />
            </div>
          </LjField>

          <!-- Emoção -->
          <LjField :label="$t('accessibility.avatar.emotion')" layout="column">
            <div class="acc-select--narrow">
              <LjSelect
                v-model="currentEmotion"
                :items="emotionOptions"
                item-label="title"
                @update:model-value="setEmotion(String($event))"
              />
            </div>
          </LjField>

          <!-- Sotaque -->
          <LjField :label="$t('accessibility.avatar.region')" layout="column">
            <div class="acc-select--wide">
              <LjSelect
                v-model="currentRegion"
                :items="regionOptions"
                item-label="title"
                @update:model-value="setRegion(String($event))"
              />
            </div>
          </LjField>
        </div>
      </section>

      <!-- ═══ Aba Músicas ═══ -->
      <section v-if="isBooted('musics')" v-show="activeTab === 'musics'" class="opt-section">
        <p class="opt-hint">{{ $t("accessibility.musics.hint") }}</p>

        <div class="opt-folder-actions acc-actions--below">
          <LjButton size="sm" :disabled="translating" @click="selectAll">
            {{ $t("accessibility.musics.select_all") }}
          </LjButton>
          <LjButton size="sm" :disabled="translating" @click="deselectAll">
            {{ $t("accessibility.musics.deselect_all") }}
          </LjButton>
        </div>

        <div v-if="loadingCatalog" class="opt-hint">
          <LjProgress indeterminate class="acc-loading" />
        </div>

        <div v-else class="opt-download-scroll">
          <div class="opt-download-list">
            <!-- Hinário Adventista -->
            <div v-if="hymnalIds.length" class="opt-cat opt-cat--special">
              <label class="opt-checkbox opt-cat-header">
                <input
                  type="checkbox"
                  :checked="selectedHymnal"
                  :disabled="translating"
                  @change="selectedHymnal = ($event.target as HTMLInputElement).checked"
                />
                <strong>{{ $t("options.collections_download.hymnal") }}</strong>
                <small class="opt-download-count">
                  · {{ hymnalIds.length }} {{ $t("options.collections_download.songs") }}
                </small>
                <small v-if="isHymnalCached" class="opt-download-count">
                  · {{ $t("accessibility.musics.cached") }}
                </small>
              </label>
            </div>

            <!-- Hinário 1996 -->
            <div v-if="hymnal1996Enabled && hymnal1996Ids.length" class="opt-cat opt-cat--special">
              <label class="opt-checkbox opt-cat-header">
                <input
                  type="checkbox"
                  :checked="selectedHymnal1996"
                  :disabled="translating"
                  @change="selectedHymnal1996 = ($event.target as HTMLInputElement).checked"
                />
                <strong>{{ $t("options.collections_download.hymnal_1996") }}</strong>
                <small class="opt-download-count">
                  · {{ hymnal1996Ids.length }} {{ $t("options.collections_download.songs") }}
                </small>
                <small v-if="isHymnal1996Cached" class="opt-download-count">
                  · {{ $t("accessibility.musics.cached") }}
                </small>
              </label>
            </div>

            <!-- Categorias > Álbuns -->
            <div v-for="cat in categories" :key="cat.id_category" class="opt-cat">
              <label class="opt-checkbox opt-cat-header">
                <input
                  :ref="(el) => setCategoryCheckboxRef(cat.id_category, el)"
                  type="checkbox"
                  :checked="isCategoryFullySelected(cat)"
                  :disabled="translating"
                  @change="toggleCategory(cat, ($event.target as HTMLInputElement).checked)"
                />
                <strong>{{ cat.name }}</strong>
                <small v-if="cat.albums" class="opt-download-count">
                  · {{ cat.albums.length }} {{ $t("options.collections_download.albums") }}
                </small>
              </label>

              <div class="opt-cat-albums">
                <label
                  v-for="album in cat.albums || []"
                  :key="album.id_album"
                  class="opt-checkbox opt-album"
                >
                  <input
                    type="checkbox"
                    :checked="selectedAlbums.has(album.id_album)"
                    :disabled="translating"
                    @change="
                      toggleAlbum(album.id_album, ($event.target as HTMLInputElement).checked)
                    "
                  />
                  <span>{{ album.name }}</span>
                  <small v-if="album.subtitle" class="opt-download-count">
                    · {{ album.subtitle }}
                  </small>
                  <small v-if="isAlbumCached(album.id_album)" class="opt-download-count">
                    · {{ $t("accessibility.musics.cached") }}
                  </small>
                </label>
              </div>
            </div>
          </div>
        </div>

        <!-- Progresso -->
        <ProgressBar
          v-if="translating"
          class="libras-progress"
          :done="musicProgress.done"
          :total="musicProgress.total"
          :current="musicProgress.current"
          :completed-msg="completedMsg"
          show-cancel
          :cancel-label="$t('accessibility.musics.cancel')"
          @cancel="sync.cancelLibrasDownloads()"
        >
          <template #label>
            {{
              $t("accessibility.musics.progress", {
                done: musicProgress.done,
                total: musicProgress.total,
                percent: musicPercent,
              })
            }}
          </template>
        </ProgressBar>

        <div class="opt-actions acc-actions--above">
          <LjButton
            :icon="ICONS.UI.TRANSLATE"
            :disabled="translating || !hasAnySelection"
            @click="translateSelected"
          >
            {{ $t("accessibility.musics.translate") }}
          </LjButton>
          <LjButton
            :icon="ICONS.ACTIONS.SAVE"
            :disabled="translating || !hasPendingRemovals || saving"
            @click="saveSelection"
          >
            {{ saving ? $t("accessibility.musics.saving") : $t("accessibility.musics.save") }}
          </LjButton>
        </div>
      </section>

      <!-- ═══ Aba Bíblia ═══ -->
      <section v-if="isBooted('bible')" v-show="activeTab === 'bible'" class="opt-section">
        <p class="opt-hint">{{ $t("accessibility.bible.hint") }}</p>

        <div v-if="loadingBible" class="opt-hint">
          <LjProgress indeterminate class="acc-loading" />
        </div>

        <div v-else class="opt-download-scroll">
          <div class="opt-download-list">
            <div v-for="ver in bibleVersions" :key="ver.id_bible_version" class="opt-cat">
              <label class="opt-checkbox opt-cat-header">
                <input
                  type="checkbox"
                  :checked="selectedBibleVersions.has(ver.id_bible_version)"
                  :disabled="translatingBible"
                  @change="
                    toggleBibleVersion(
                      ver.id_bible_version,
                      ($event.target as HTMLInputElement).checked
                    )
                  "
                />
                <strong>{{ ver.name }}</strong>
                <small v-if="ver.abbreviation" class="opt-download-count">
                  · {{ ver.abbreviation }}
                </small>
                <small v-if="isBibleVersionCached(ver.id_bible_version)" class="opt-download-count">
                  · {{ $t("accessibility.bible.cached") }}
                </small>
              </label>
            </div>
          </div>
        </div>

        <ProgressBar
          v-if="translatingBible"
          class="libras-progress"
          :done="bibleProgress.done"
          :total="bibleProgress.total"
          :current="bibleProgress.current"
          :completed-msg="bibleCompletedMsg"
          show-cancel
          :cancel-label="$t('accessibility.bible.cancel')"
          @cancel="sync.cancelLibrasDownloads()"
        >
          <template #label>
            {{
              $t("accessibility.bible.progress", {
                done: bibleProgress.done,
                total: bibleProgress.total,
                percent: biblePercent,
              })
            }}
          </template>
        </ProgressBar>

        <div class="opt-actions acc-actions--above">
          <LjButton
            :icon="ICONS.UI.TRANSLATE"
            :disabled="translatingBible || selectedBibleVersions.size === 0"
            @click="translateSelectedBibles"
          >
            {{ $t("accessibility.bible.translate") }}
          </LjButton>
          <LjButton
            :icon="ICONS.ACTIONS.SAVE"
            :disabled="translatingBible || !bibleHasPendingRemovals || savingBible"
            @click="saveBibleSelection"
          >
            {{ savingBible ? $t("accessibility.bible.saving") : $t("accessibility.bible.save") }}
          </LjButton>
        </div>
      </section>

      <!-- ═══ Aba Armazenamento ═══ -->
      <section v-if="isBooted('storage')" v-show="activeTab === 'storage'" class="opt-section">
        <div class="opt-stats opt-stats--compact">
          <div class="opt-stat">
            <span class="opt-stat-label">{{ $t("accessibility.storage.gloss_entries") }}</span>
            <span class="opt-stat-value">{{ stats.total_entries }}</span>
          </div>
          <div class="opt-stat">
            <span class="opt-stat-label">{{ $t("accessibility.stats.bundles_size") }}</span>
            <span class="opt-stat-value">{{ Libras.humanSize(stats.total_bundles_bytes) }}</span>
          </div>
          <div class="opt-stat">
            <span class="opt-stat-label">{{ $t("accessibility.storage.total_size") }}</span>
            <span class="opt-stat-value">{{ Libras.humanSize(stats.total_bytes) }}</span>
          </div>
        </div>

        <div class="opt-actions">
          <LjButton :icon="ICONS.ACTIONS.REFRESH" @click="refreshStats">
            {{ $t("accessibility.storage.refresh") }}
          </LjButton>
          <LjButton variant="danger" :icon="ICONS.ACTIONS.DELETE_FILLED" @click="clearLibrasCache">
            {{ $t("accessibility.storage.clear_cache") }}
          </LjButton>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { ICONS } from "@/config/Icons";
import $database from "@/helpers/Database";
import $alert from "@/helpers/Alert";
import $snackbar from "@/helpers/Snackbar";
import Libras from "@/helpers/Libras";
import { useSyncManager } from "@/composables/useSyncManager";
import { useBackgroundTasks } from "@/composables/useBackgroundTasks";
import { formatBackgroundTaskDetail } from "@/helpers/BackgroundTaskDetail";
import ProgressBar from "@/components/ProgressBar.vue";
import {
  LjAlert,
  LjButton,
  LjField,
  LjInput,
  LjProgress,
  LjSelect,
  LjSlider,
  LjSwitch,
  LjTabs,
} from "@/components/ui";
import type { LjTab } from "@/components/ui";
import { BG_SWATCHES } from "@/config/Theme";
import $broadcast from "@/helpers/Broadcast";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import $userdata from "@/helpers/UserData";
import { KEYS } from "@/constants/UserDataKeys";
import type { BibleVersion, BibleBook } from "@/types/Bible";
import Icon from "@components/Icon.vue";
import { LibrasCacheStats } from "@/types/Libras";
import { KEYS_LS } from "@constants/LocalStorageKeys";

// ─── Tipos ──────────────────────────────────────────────────────────────────

interface Category {
  id_category: number;
  name: string;
  order?: number;
  albums?: Array<{ id_album: number; name: string; subtitle?: string }>;
}

// ─── Estado ─────────────────────────────────────────────────────────────────

const { t, locale } = useI18n();
const sync = useSyncManager();
const bgTasks = useBackgroundTasks();
const activeTab = ref("avatar");

// O v-alert fechava a si mesmo; o LjAlert só avisa que o operador dispensou,
// e quem esconde é esta tela.
const internetHintVisible = ref(true);

const tabItems = computed<LjTab[]>(() => [
  { value: "avatar", label: t("accessibility.tabs.avatar"), icon: ICONS.UI.AVATAR },
  { value: "musics", label: t("accessibility.tabs.musics"), icon: ICONS.MUSIC.MUSIC },
  { value: "bible", label: t("accessibility.tabs.bible"), icon: ICONS.BIBLE.BIBLE },
  { value: "storage", label: t("accessibility.tabs.storage"), icon: ICONS.UI.HARDDISK },
]);

// Mesma economia do v-window-item: o painel só é montado na primeira vez que
// aparece e fica montado depois — a lista inteira de álbuns não é construída
// enquanto o operador está noutra aba, e o que ele já rolou continua onde
// estava quando ele volta.
const bootedTabs = ref(new Set<string>([activeTab.value]));

function isBooted(tab: string): boolean {
  return bootedTabs.value.has(tab);
}

watch(activeTab, (tab) => {
  if (!bootedTabs.value.has(tab)) bootedTabs.value = new Set(bootedTabs.value).add(tab);
});

function findTask(id: string) {
  return bgTasks.tasks.value.find((t) => t.id === id && t.status === "running");
}

// Stats
const stats = ref<LibrasCacheStats>({
  total_entries: 0,
  music_count: 0,
  bible_count: 0,
  total_gloss_bytes: 0,
  total_bundles_bytes: 0,
  total_bytes: 0,
});
const statsLoading = ref(true);

// Músicas
const categories = ref<Category[]>([]);
const hymnalIds = ref<number[]>([]);
const hymnal1996Ids = ref<number[]>([]);
const hymnal1996Enabled = ref(false);
const selectedAlbums = ref<Set<number>>(new Set());
const selectedHymnal = ref(false);
const selectedHymnal1996 = ref(false);
const cachedAlbumIds = ref<Set<number>>(new Set());
const isHymnalCached = ref(false);
const isHymnal1996Cached = ref(false);
const loadingCatalog = ref(false);
const translating = ref(false);
const completedMsg = ref("");

// Baselines (snapshots do estado cacheado no último scan)
const cachedAlbumsBaseline = ref<Set<number>>(new Set());
const cachedHymnalBaseline = ref(false);
const cachedHymnal1996Baseline = ref(false);
const saving = ref(false);
const categoryCheckboxRefs = ref<Record<number, HTMLInputElement | null>>({});

// Bíblia
const bibleVersions = ref<BibleVersion[]>([]);
const selectedBibleVersions = ref<Set<number>>(new Set());
const cachedBibleVersionIds = ref<Set<number>>(new Set());
const cachedBibleBaseline = ref<Set<number>>(new Set());
const loadingBible = ref(false);
const translatingBible = ref(false);
const bibleCompletedMsg = ref("");
const savingBible = ref(false);

// Progresso de tradução Libras (lê de bgTasks se download está rodando em background)
const musicProgress = computed(() => {
  const task = findTask("libras-music");
  if (task) {
    return {
      done: task._done ?? 0,
      total: task._total ?? 0,
      current: formatBackgroundTaskDetail(task.detail, t),
    };
  }
  return sync.librasMusicProgress.value;
});
const musicPercent = computed(() =>
  musicProgress.value.total > 0
    ? Math.round((musicProgress.value.done / musicProgress.value.total) * 100)
    : 0
);
const bibleProgress = computed(() => {
  const task = findTask("libras-bible");
  if (task) {
    return {
      done: task._done ?? 0,
      total: task._total ?? 0,
      current: formatBackgroundTaskDetail(task.detail, t),
    };
  }
  return sync.librasBibleProgress.value;
});
const biblePercent = computed(() =>
  bibleProgress.value.total > 0
    ? Math.round((bibleProgress.value.done / bibleProgress.value.total) * 100)
    : 0
);

// Avatar
const selectedAvatar = ref("icaro");
const librasEnabled = ref(false);
const librasMusicsEnabled = ref(true);
const librasBibleEnabled = ref(true);
const showOnObs = ref(false);
const showBorder = ref(false);
const avatarOptions = computed(() => [
  { value: "icaro", label: t("accessibility.avatar.icaro") },
  { value: "hosana", label: t("accessibility.avatar.hosana") },
  { value: "guga", label: t("accessibility.avatar.guga") },
  { value: "random", label: t("accessibility.avatar.random") },
]);

function selectAvatar(value: string) {
  selectedAvatar.value = value;
  localStorage.setItem(KEYS_LS.LIBRAS.AVATAR, value);
}

function toggleLibrasEnabled(value: boolean | null) {
  librasEnabled.value = value === true;
  localStorage.setItem(KEYS_LS.LIBRAS.ENABLED, String(value === true));
  $broadcast.send(BROADCAST_TYPE.LIBRAS_TOGGLE, { enabled: value === true });
}

function toggleShowOnObs(value: boolean | null) {
  showOnObs.value = value === true;
  localStorage.setItem(KEYS_LS.LIBRAS.SHOW_ON_OBS, String(value === true));
}

function toggleMusicsEnabled(value: boolean | null) {
  librasMusicsEnabled.value = value === true;
  localStorage.setItem(KEYS_LS.LIBRAS.MUSICS_ENABLED, String(value === true));
}

function toggleBibleEnabled(value: boolean | null) {
  librasBibleEnabled.value = value === true;
  localStorage.setItem(KEYS_LS.LIBRAS.BIBLE_ENABLED, String(value === true));
}

function setCategoryCheckboxRef(id: number, el: unknown): void {
  categoryCheckboxRefs.value[id] = el instanceof HTMLInputElement ? el : null;
}

async function syncCategoryIndeterminateState(): Promise<void> {
  await nextTick();
  for (const cat of categories.value) {
    const el = categoryCheckboxRefs.value[cat.id_category];
    if (el) el.indeterminate = isCategoryPartiallySelected(cat);
  }
}

watch(
  [categories, selectedAlbums],
  () => {
    void syncCategoryIndeterminateState();
  },
  { deep: true, immediate: true }
);

function toggleShowBorder(value: boolean | null) {
  showBorder.value = value === true;
  $userdata.set(KEYS.MODULES.LIBRAS.SHOW_BORDER, value === true);
}

// Velocidade
const currentSpeed = ref(1);
const speedOptions = [
  { title: "0.5x", value: 0.5 },
  { title: "1x (padrão)", value: 1 },
  { title: "1.5x", value: 1.5 },
  { title: "2x", value: 2 },
];

function setSpeed(value: number) {
  currentSpeed.value = value;
  $userdata.set(KEYS.MODULES.LIBRAS.SPEED, value);
}

// Emoção
const currentEmotion = ref("default");
const emotionOptions = [
  { title: t("accessibility.avatar.emotion_default"), value: "default" },
  { title: t("accessibility.avatar.emotion_happy"), value: "happy" },
  { title: t("accessibility.avatar.emotion_sad"), value: "sad" },
  { title: t("accessibility.avatar.emotion_surprise"), value: "surprise" },
];

function setEmotion(value: string) {
  currentEmotion.value = value;
  $userdata.set(KEYS.MODULES.LIBRAS.EMOTION, value);
}

// Região
const currentRegion = ref("BR");
const regionOptions = [
  { title: "BR — Padrão Nacional", value: "BR" },
  { title: "AC — Acre", value: "AC" },
  { title: "AL — Alagoas", value: "AL" },
  { title: "AP — Amapá", value: "AP" },
  { title: "AM — Amazonas", value: "AM" },
  { title: "BA — Bahia", value: "BA" },
  { title: "CE — Ceará", value: "CE" },
  { title: "DF — Distrito Federal", value: "DF" },
  { title: "ES — Espírito Santo", value: "ES" },
  { title: "GO — Goiás", value: "GO" },
  { title: "MA — Maranhão", value: "MA" },
  { title: "MT — Mato Grosso", value: "MT" },
  { title: "MS — Mato Grosso do Sul", value: "MS" },
  { title: "MG — Minas Gerais", value: "MG" },
  { title: "PA — Pará", value: "PA" },
  { title: "PB — Paraíba", value: "PB" },
  { title: "PR — Paraná", value: "PR" },
  { title: "PE — Pernambuco", value: "PE" },
  { title: "PI — Piauí", value: "PI" },
  { title: "RJ — Rio de Janeiro", value: "RJ" },
  { title: "RN — Rio Grande do Norte", value: "RN" },
  { title: "RS — Rio Grande do Sul", value: "RS" },
  { title: "RO — Rondônia", value: "RO" },
  { title: "RR — Roraima", value: "RR" },
  { title: "SC — Santa Catarina", value: "SC" },
  { title: "SP — São Paulo", value: "SP" },
  { title: "SE — Sergipe", value: "SE" },
  { title: "TO — Tocantins", value: "TO" },
];

function setRegion(value: string) {
  currentRegion.value = value;
  $userdata.set(KEYS.MODULES.LIBRAS.REGION, value);
}

// Animação de entrada
const currentAnimation = ref("fade");
const animationOptions = [
  { title: "Fade", value: "fade" },
  { title: "Slide esquerda", value: "slide-left" },
  { title: "Slide direita", value: "slide-right" },
  { title: "Slide baixo", value: "slide-up" },
];

function setAnimation(value: string) {
  currentAnimation.value = value;
  $userdata.set(KEYS.MODULES.LIBRAS.ANIMATION, value);
}

// Animação de saída
const currentExitAnimation = ref("fade");

function setExitAnimation(value: string) {
  currentExitAnimation.value = value;
  $userdata.set(KEYS.MODULES.LIBRAS.EXIT_ANIMATION, value);
}

// Duração das animações
const currentAnimationDuration = ref(1500);
const currentExitAnimationDuration = ref(1000);

function setAnimationDuration(value: number) {
  currentAnimationDuration.value = value;
  $userdata.set(KEYS.MODULES.LIBRAS.ANIMATION_DURATION, value);
}

function setExitAnimationDuration(value: number) {
  currentExitAnimationDuration.value = value;
  $userdata.set(KEYS.MODULES.LIBRAS.EXIT_ANIMATION_DURATION, value);
}

// Cor de fundo
const transparentBg = ref(true);
const bgColor = ref("");
const bgSwatches = BG_SWATCHES;

function toggleTransparentBg(value: boolean | null) {
  transparentBg.value = value === true;
  if (value === true) {
    $userdata.set(KEYS.MODULES.LIBRAS.BACKGROUND_COLOR, "transparent");
  } else {
    $userdata.set(KEYS.MODULES.LIBRAS.BACKGROUND_COLOR, bgColor.value);
  }
}

function setBgColor(c: string) {
  bgColor.value = c;
  $userdata.set(KEYS.MODULES.LIBRAS.BACKGROUND_COLOR, c);
}

// Sem primitivo de cor no catálogo, o v-color-input vira três peças: o seletor
// nativo do sistema, a paleta em botões e o alfa num slider. O que é gravado
// continua sendo o mesmo hex de 8 dígitos (#rrggbbaa) que a projeção já lê.
const BG_COLOR_FALLBACK = "#000000ff";

function toHex2(n: number): string {
  return Math.max(0, Math.min(255, Math.round(n)))
    .toString(16)
    .padStart(2, "0");
}

const bgSwatchHexes = computed(() =>
  bgSwatches.flat().map((c) => `#${toHex2(c.r)}${toHex2(c.g)}${toHex2(c.b)}`)
);

// Minúsculas porque é assim que o <input type="color"> devolve o valor: sem
// normalizar, uma cor gravada em maiúsculas não casaria com a amostra da
// paleta nem com o que o seletor nativo mostra.
const bgColorHex = computed(() => (bgColor.value || BG_COLOR_FALLBACK).slice(0, 7).toLowerCase());

const bgAlphaPercent = computed(() => {
  const alpha = (bgColor.value || BG_COLOR_FALLBACK).slice(7, 9) || "ff";
  return Math.round((parseInt(alpha, 16) / 255) * 100);
});

function setBgColorHex(hex: string): void {
  setBgColor(`${hex}${toHex2((bgAlphaPercent.value / 100) * 255)}`);
}

function setBgAlphaPercent(percent: number): void {
  setBgColor(`${bgColorHex.value}${toHex2((percent / 100) * 255)}`);
}

// Posição
const currentAnchor = ref("bottom-right");
const currentOffsetX = ref(20);
const currentOffsetY = ref(20);
const currentWidth = ref(200);
const currentHeight = ref(300);

const anchorOptions = computed(() => [
  {
    value: "bottom-left",
    icon: ICONS.UI.ARROW_BOTTOM_LEFT,
    label: t("accessibility.avatar.anchor_left"),
  },
  {
    value: "bottom-center",
    icon: ICONS.UI.ARROW_DOWN,
    label: t("accessibility.avatar.anchor_center"),
  },
  {
    value: "bottom-right",
    icon: ICONS.UI.ARROW_BOTTOM_RIGHT,
    label: t("accessibility.avatar.anchor_right"),
  },
]);

function setAnchor(value: string) {
  currentAnchor.value = value;
  $userdata.set(KEYS.MODULES.LIBRAS.ANCHOR, value);
}

function setOffsetX(value: number) {
  currentOffsetX.value = value;
  $userdata.set(KEYS.MODULES.LIBRAS.OFFSET_X, value);
}

function setOffsetY(value: number) {
  currentOffsetY.value = value;
  $userdata.set(KEYS.MODULES.LIBRAS.OFFSET_Y, value);
}

function setWidth(value: number) {
  currentWidth.value = value;
  $userdata.set(KEYS.MODULES.LIBRAS.WIDTH, value);
}

function setHeight(value: number) {
  currentHeight.value = value;
  $userdata.set(KEYS.MODULES.LIBRAS.HEIGHT, value);
}

// ─── Computed ───────────────────────────────────────────────────────────────

const hasAnySelection = computed(
  () => selectedAlbums.value.size > 0 || selectedHymnal.value || selectedHymnal1996.value
);

const hasPendingRemovals = computed<boolean>(() => {
  for (const id of cachedAlbumsBaseline.value) {
    if (!selectedAlbums.value.has(id)) return true;
  }
  if (cachedHymnalBaseline.value && !selectedHymnal.value) return true;
  if (cachedHymnal1996Baseline.value && !selectedHymnal1996.value) return true;
  return false;
});

const bibleHasPendingRemovals = computed<boolean>(() => {
  if (cachedBibleBaseline.value.size === 0) return false;
  for (const id of cachedBibleBaseline.value) {
    if (!selectedBibleVersions.value.has(id)) return true;
  }
  return false;
});

// ─── Init ───────────────────────────────────────────────────────────────────

onMounted(async () => {
  selectedAvatar.value = localStorage.getItem("libras_avatar") || "icaro";
  librasEnabled.value = localStorage.getItem("libras_enabled") === "true";
  librasMusicsEnabled.value = localStorage.getItem("libras_musics_enabled") !== "false";
  librasBibleEnabled.value = localStorage.getItem("libras_bible_enabled") !== "false";
  showOnObs.value = localStorage.getItem("libras_show_on_obs") === "true";
  currentAnchor.value =
    $userdata.get<string>(KEYS.MODULES.LIBRAS.ANCHOR, "bottom-right") || "bottom-right";
  currentOffsetX.value = $userdata.get<number>(KEYS.MODULES.LIBRAS.OFFSET_X, -20) as number;
  currentOffsetY.value = $userdata.get<number>(KEYS.MODULES.LIBRAS.OFFSET_Y, -20) as number;
  currentWidth.value = $userdata.get<number>(KEYS.MODULES.LIBRAS.WIDTH, 450) || 200;
  currentHeight.value = $userdata.get<number>(KEYS.MODULES.LIBRAS.HEIGHT, 400) as number;
  showBorder.value = $userdata.get<boolean>(KEYS.MODULES.LIBRAS.SHOW_BORDER, false) || false;
  currentSpeed.value = $userdata.get<number>(KEYS.MODULES.LIBRAS.SPEED, 1) || 1;
  currentEmotion.value = $userdata.get<string>(KEYS.MODULES.LIBRAS.EMOTION, "default") || "default";
  currentRegion.value = $userdata.get<string>(KEYS.MODULES.LIBRAS.REGION, "BR") || "BR";
  currentAnimation.value = $userdata.get<string>(KEYS.MODULES.LIBRAS.ANIMATION, "fade") || "fade";
  currentExitAnimation.value =
    $userdata.get<string>(KEYS.MODULES.LIBRAS.EXIT_ANIMATION, "fade") || "fade";
  currentAnimationDuration.value =
    $userdata.get<number>(KEYS.MODULES.LIBRAS.ANIMATION_DURATION, 1500) || 1500;
  currentExitAnimationDuration.value =
    $userdata.get<number>(KEYS.MODULES.LIBRAS.EXIT_ANIMATION_DURATION, 1000) || 1000;
  const savedBg =
    $userdata.get<string>(KEYS.MODULES.LIBRAS.BACKGROUND_COLOR, "transparent") || "transparent";
  transparentBg.value = savedBg === "transparent";
  if (!transparentBg.value) {
    if (savedBg.startsWith("#")) {
      bgColor.value = savedBg.length === 9 ? savedBg : `${savedBg}ff`;
    } else {
      const match = savedBg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+),?\s*([\d.]+)\)/);
      if (match) {
        const r = +match[1],
          g = +match[2],
          b = +match[3],
          a = +match[4];
        const hex = `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
        const alphaHex = Math.round(a * 255)
          .toString(16)
          .padStart(2, "0");
        bgColor.value = `${hex}${alphaHex}`;
      }
    }
  }
  // Carregar catálogo e versões antes das stats (refreshStats depende de categories e bibleVersions)
  await Promise.all([loadCatalog(), loadBibleVersions()]);
  await refreshStats();

  // Restaurar estado de download a partir do bgTasks (sobrevive ao fechar/reabrir menu)
  if (findTask("libras-music")) {
    translating.value = true;
  }
  if (findTask("libras-bible")) {
    translatingBible.value = true;
  }
});

watch(activeTab, (tab) => {
  if (tab === "musics" || tab === "bible") {
    refreshStats();
  }
});

watch(currentRegion, () => {
  refreshStats();
});

// Sincronizar estado de translating com bgTasks (download pode terminar com menu fechado)
watch(
  () => bgTasks.tasks.value.length,
  () => {
    if (!findTask("libras-music") && translating.value) {
      translating.value = false;
    }
    if (!findTask("libras-bible") && translatingBible.value) {
      translatingBible.value = false;
    }
  }
);

// ─── Stats ──────────────────────────────────────────────────────────────────

async function refreshStats(): Promise<void> {
  statsLoading.value = true;
  try {
    stats.value = await Libras.getCacheStats();
    const cached = await Libras.listCached();
    const region = currentRegion.value;

    // Filtrar entries pela região atual
    const regionSuffix = `_${region}`;
    const cachedMusicEntries = cached.filter(
      (e) => e.type === "music" && e.id.endsWith(regionSuffix)
    );
    const cachedBibleEntries = cached.filter(
      (e) => e.type === "bible" && e.id.endsWith(regionSuffix)
    );

    // Extrair music IDs das entries cacheadas
    const cachedMusicIds = new Set(
      cachedMusicEntries.map((e) => parseInt(e.ref_id, 10)).filter((id) => !isNaN(id))
    );

    // Mapear music IDs → album IDs usando o catálogo (paralelo)
    const allAlbums = categories.value.flatMap((cat) => cat.albums || []);
    const albumEntries = await Promise.all(
      allAlbums.map(async (album) => {
        const data = await $database.get<{ musics?: { id_music: number }[] }>(
          `album_${album.id_album}`
        );
        return { id: album.id_album, musics: data?.musics };
      })
    );

    const albumIdSet = new Set<number>();
    for (const { id, musics } of albumEntries) {
      if (musics && musics.length > 0) {
        const allCached = musics.every((m) => cachedMusicIds.has(Number(m.id_music)));
        if (allCached) albumIdSet.add(id);
      }
    }
    cachedAlbumIds.value = albumIdSet;

    // Calcular hinários cacheados
    isHymnalCached.value =
      hymnalIds.value.length > 0 && hymnalIds.value.every((id) => cachedMusicIds.has(id));
    isHymnal1996Cached.value =
      hymnal1996Ids.value.length > 0 && hymnal1996Ids.value.every((id) => cachedMusicIds.has(id));

    // Mapear bible version abbreviation → id_bible_version
    const versionByAbbrev = new Map<string, number>();
    for (const v of bibleVersions.value) {
      if (v.abbreviation) versionByAbbrev.set(v.abbreviation, v.id_bible_version);
    }
    cachedBibleVersionIds.value = new Set(
      cachedBibleEntries
        .map((e) => {
          const parts = e.ref_id.split("_");
          return versionByAbbrev.get(parts[0]) ?? NaN;
        })
        .filter((id) => !isNaN(id))
    );

    // Pre-selecionar itens cacheados + salvar baselines
    selectedAlbums.value = new Set(albumIdSet);
    cachedAlbumsBaseline.value = new Set(albumIdSet);
    selectedHymnal.value = isHymnalCached.value;
    cachedHymnalBaseline.value = isHymnalCached.value;
    selectedHymnal1996.value = isHymnal1996Cached.value;
    cachedHymnal1996Baseline.value = isHymnal1996Cached.value;
    selectedBibleVersions.value = new Set(cachedBibleVersionIds.value);
    cachedBibleBaseline.value = new Set(cachedBibleVersionIds.value);
  } finally {
    statsLoading.value = false;
  }
}

// ─── Músicas ────────────────────────────────────────────────────────────────

function isAlbumCached(idAlbum: number): boolean {
  return cachedAlbumIds.value.has(idAlbum);
}

function isCategoryFullySelected(cat: Category): boolean {
  if (!cat.albums?.length) return false;
  return cat.albums.every((a) => selectedAlbums.value.has(a.id_album));
}

function isCategoryPartiallySelected(cat: Category): boolean {
  if (!cat.albums?.length) return false;
  const sel = cat.albums.filter((a) => selectedAlbums.value.has(a.id_album)).length;
  return sel > 0 && sel < cat.albums.length;
}

function toggleCategory(cat: Category, checked: boolean): void {
  cat.albums?.forEach((a) => {
    if (checked) selectedAlbums.value.add(a.id_album);
    else selectedAlbums.value.delete(a.id_album);
  });
  selectedAlbums.value = new Set(selectedAlbums.value);
}

function toggleAlbum(id: number, checked: boolean): void {
  if (checked) selectedAlbums.value.add(id);
  else selectedAlbums.value.delete(id);
  selectedAlbums.value = new Set(selectedAlbums.value);
}

function selectAll(): void {
  const all = new Set<number>();
  categories.value.forEach((c) => c.albums?.forEach((a) => all.add(a.id_album)));
  selectedAlbums.value = all;
  if (hymnalIds.value.length) selectedHymnal.value = true;
  if (hymnal1996Ids.value.length) selectedHymnal1996.value = true;
}

function deselectAll(): void {
  selectedAlbums.value = new Set();
  selectedHymnal.value = false;
  selectedHymnal1996.value = false;
}

async function loadCatalog(): Promise<void> {
  loadingCatalog.value = true;
  try {
    hymnal1996Enabled.value = false;
    try {
      const { moduleShowInMainMenu } = await import("@/constants/UserDataKeys");
      const $userdata = (await import("@/helpers/UserData")).default;
      hymnal1996Enabled.value =
        $userdata.get<boolean>(moduleShowInMainMenu("hymnal_1996"), false) === true;
    } catch (_) {
      /* ignore */
    }

    const result = await sync.loadCatalog(locale.value);
    categories.value = result.categories as Category[];
    hymnalIds.value = result.hymnalIds;
    hymnal1996Ids.value = result.hymnal1996Ids;
  } catch (e) {
    console.error("[Acessibilidade] loadCatalog:", e);
  } finally {
    loadingCatalog.value = false;
  }
}

async function translateSelected(): Promise<void> {
  if (!hasAnySelection.value) return;

  translating.value = true;
  completedMsg.value = "";
  try {
    const count = await sync.startLibrasMusicDownloads(
      selectedHymnal.value ? hymnalIds.value : [],
      selectedHymnal1996.value ? hymnal1996Ids.value : [],
      selectedAlbums.value,
      currentRegion.value
    );
    completedMsg.value = t("accessibility.musics.completed", { count });
    selectedAlbums.value = new Set();
    selectedHymnal.value = false;
    selectedHymnal1996.value = false;
  } catch (e) {
    console.error("[Acessibilidade] Erro ao traduzir músicas:", e);
  } finally {
    translating.value = false;
    await refreshStats();
  }
}

// ─── Bíblia ─────────────────────────────────────────────────────────────────

async function loadBibleVersions(): Promise<void> {
  loadingBible.value = true;
  try {
    const versions = await $database.get<BibleVersion[]>("pt_bible_version");
    if (versions) bibleVersions.value = versions;
  } finally {
    loadingBible.value = false;
  }
}

function isBibleVersionCached(versionId: number): boolean {
  return cachedBibleVersionIds.value.has(versionId);
}

function toggleBibleVersion(id: number, checked: boolean): void {
  if (checked) selectedBibleVersions.value.add(id);
  else selectedBibleVersions.value.delete(id);
  selectedBibleVersions.value = new Set(selectedBibleVersions.value);
}

async function translateSelectedBibles(): Promise<void> {
  if (selectedBibleVersions.value.size === 0) return;

  translatingBible.value = true;
  bibleCompletedMsg.value = "";
  try {
    const books = await $database.get<BibleBook[]>("pt_bible_book");
    if (!books) return;

    const count = await sync.startLibrasBibleDownloads(
      Array.from(selectedBibleVersions.value),
      bibleVersions.value,
      books,
      locale.value,
      currentRegion.value
    );
    bibleCompletedMsg.value = t("accessibility.bible.completed", { count });
    selectedBibleVersions.value = new Set();
  } catch (e) {
    console.error("[Acessibilidade] Erro ao traduzir bíblia:", e);
  } finally {
    translatingBible.value = false;
    await refreshStats();
  }
}

// ─── Remoção de traduções ───────────────────────────────────────────────────

async function saveSelection(): Promise<void> {
  if (!hasPendingRemovals.value) return;

  saving.value = true;
  let removedAlbums = 0;
  let removedHymnal = false;
  let removedHymnal1996 = false;

  try {
    const region = currentRegion.value;
    const albumsToRemove = [...cachedAlbumsBaseline.value].filter(
      (id) => !selectedAlbums.value.has(id)
    );

    for (const id of albumsToRemove) {
      const albumData = await $database.get<{ musics?: { id_music: number }[] }>(`album_${id}`);
      if (albumData?.musics) {
        for (const m of albumData.musics) {
          await Libras.removeCached(Libras.musicCacheId(Number(m.id_music), region), "music");
        }
      }
      cachedAlbumsBaseline.value.delete(id);
      removedAlbums += 1;
    }
    cachedAlbumsBaseline.value = new Set(cachedAlbumsBaseline.value);

    if (cachedHymnalBaseline.value && !selectedHymnal.value) {
      for (const id of hymnalIds.value) {
        await Libras.removeCached(Libras.musicCacheId(id, region), "music");
      }
      cachedHymnalBaseline.value = false;
      removedHymnal = true;
    }

    if (cachedHymnal1996Baseline.value && !selectedHymnal1996.value) {
      for (const id of hymnal1996Ids.value) {
        await Libras.removeCached(Libras.musicCacheId(id, region), "music");
      }
      cachedHymnal1996Baseline.value = false;
      removedHymnal1996 = true;
    }

    const total = removedAlbums + (removedHymnal ? 1 : 0) + (removedHymnal1996 ? 1 : 0);
    if (total > 0) {
      $snackbar.success(t("accessibility.musics.save_done", { count: total }));
    }
  } catch (e) {
    console.error("[Acessibilidade] saveSelection:", e);
    $snackbar.error((e as Error).message);
  } finally {
    saving.value = false;
    await refreshStats();
  }
}

async function saveBibleSelection(): Promise<void> {
  if (!bibleHasPendingRemovals.value) return;

  savingBible.value = true;
  let removed = 0;

  try {
    const region = currentRegion.value;
    const versionsToRemove = [...cachedBibleBaseline.value].filter(
      (id) => !selectedBibleVersions.value.has(id)
    );

    const allBibleEntries = await Libras.listCached("bible");
    const regionSuffix = `_${region}`;

    for (const versionId of versionsToRemove) {
      const version = bibleVersions.value.find((v) => v.id_bible_version === versionId);
      if (!version?.abbreviation) continue;

      const entriesToRemove = allBibleEntries.filter(
        (e) =>
          e.type === "bible" &&
          e.id.endsWith(regionSuffix) &&
          e.ref_id.startsWith(`${version.abbreviation}_`)
      );

      for (const entry of entriesToRemove) {
        await Libras.removeCached(entry.id, "bible");
        removed++;
      }

      cachedBibleBaseline.value.delete(versionId);
    }
    cachedBibleBaseline.value = new Set(cachedBibleBaseline.value);

    if (removed > 0) {
      $snackbar.success(t("accessibility.bible.save_done", { count: removed }));
    }
  } catch (e) {
    console.error("[Acessibilidade] saveBibleSelection:", e);
    $snackbar.error((e as Error).message);
  } finally {
    savingBible.value = false;
    await refreshStats();
  }
}

// ─── Cache ──────────────────────────────────────────────────────────────────

async function clearLibrasCache(): Promise<void> {
  $alert.yesno("accessibility.storage.clear_cache_confirm", (async (btn) => {
    if (btn !== "yes") return;
    await Libras.clearCache();
    $snackbar.success(t("accessibility.storage.clear_cache_done"));
    cachedAlbumIds.value = new Set();
    cachedBibleVersionIds.value = new Set();
    await refreshStats();
  }) as (...args: unknown[]) => unknown);
}
</script>

<style scoped>
/* ─── Ritmo vertical da tela ──────────────────────────────────────────────── */

.acc-hint {
  margin-top: var(--lj-space-4);
}

.acc-tabs {
  margin-top: var(--lj-space-4);
}

.acc-panes {
  margin-top: var(--lj-space-7);
}

/* ─── Colunas ─────────────────────────────────────────────────────────────
   Substituem v-row/v-col: não há primitivo de grade no catálogo. As quebras
   repetem os pontos do Vuetify que estavam em uso (md = 960px, lg = 1280px)
   para a tela continuar dobrando nas mesmas larguras de janela. */

.acc-grid {
  display: grid;
  align-items: start;
  gap: var(--lj-space-6);
}

.acc-grid--3 {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.acc-grid--435 {
  grid-template-columns: 4fr 3fr 5fr;
}

@media (max-width: 1279.98px) {
  .acc-grid--435 {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 959.98px) {
  .acc-grid--3 {
    grid-template-columns: 1fr;
  }
}

/* Dois campos lado a lado (X/Y, largura/altura, animação/duração). */
.acc-pair {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--lj-space-4);
  min-width: 0;
}

.acc-anim {
  display: grid;
  gap: var(--lj-space-8);
  min-width: 0;
}

/* Rótulo que titula um bloco inteiro, e não um campo só. */
.acc-block-label {
  display: block;
  margin-bottom: var(--lj-space-2);
}

.acc-block-label--gap {
  margin-top: var(--lj-space-7);
}

.acc-row--spaced {
  margin-top: var(--lj-space-7);
}

.acc-suffix {
  padding-right: var(--lj-ui-px-md);
  color: var(--lj-text-subtle);
  font-size: var(--lj-ui-font-sm);
}

.acc-loading {
  margin-bottom: var(--lj-space-4);
}

.acc-actions--above {
  margin-top: var(--lj-space-4);
}

.acc-actions--below {
  margin-bottom: var(--lj-space-4);
}

/* Bloco desativado enquanto a API não suporta velocidade/emoção/sotaque.
   Era `d-none` do Vuetify; agora não depende mais do CSS dele. */
.acc-hidden {
  display: none;
}

.acc-select--narrow {
  max-width: 160px;
}

.acc-select--wide {
  max-width: 300px;
}

/* ─── Cor de fundo do avatar ──────────────────────────────────────────────
   Sem primitivo de cor no catálogo: seletor nativo, paleta e alfa em peças
   separadas, sobre os mesmos tokens dos demais controles. */

.acc-color {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-4);
  margin-top: var(--lj-space-4);
  max-width: 340px;
}

.acc-color__pick {
  display: flex;
  align-items: center;
  gap: var(--lj-space-4);
}

.acc-color__value {
  color: var(--lj-text-muted);
  font-family: var(--lj-font-mono);
  font-size: var(--lj-ui-font-sm);
  text-transform: uppercase;
}

.acc-color__swatches {
  display: flex;
  flex-wrap: wrap;
  gap: var(--lj-space-2);
}

.acc-color__swatch {
  width: 22px;
  height: 22px;
  padding: 0;
  border: 1px solid var(--lj-surface-border-strong);
  border-radius: var(--lj-radius-sm);
  cursor: pointer;
  transition: box-shadow var(--lj-transition-fast);
}

.acc-color__swatch:hover {
  border-color: var(--lj-ui-accent);
}

.acc-color__swatch:focus-visible {
  outline: none;
  box-shadow: var(--lj-ui-focus);
}

.acc-color__swatch--active {
  border-color: var(--lj-ui-accent);
  box-shadow: var(--lj-ui-focus);
}

/* O campo numérico nasce com a largura natural do <input>; dentro da grade ele
   precisa ocupar a coluna. O gatilho é renderizado pelo primitivo, então a
   regra sai daqui via :deep(). */
.acc-pair :deep(.lj-input) {
  width: 100%;
}

/* ─── Listas de seleção ───────────────────────────────────────────────────── */

.opt-cat {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--lj-surface-border);
}
.opt-cat:last-child {
  border-bottom: 0;
}
.opt-cat-header {
  font-size: var(--lj-text-base);
}
.opt-cat-albums {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-left: 24px;
}
.opt-album {
  font-size: var(--lj-text-sm);
}
.opt-divider {
  height: 1px;
  background: var(--lj-surface-border);
  margin: 12px 0;
}
.libras-progress {
  margin-top: 12px;
}

/* ─── Âncora da projeção ──────────────────────────────────────────────────── */

.position-options {
  display: flex;
  gap: 6px;
}
.position-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--lj-space-2);
  padding: 6px 12px;
  border: 2px solid var(--lj-surface-border-strong);
  border-radius: var(--lj-radius-md);
  background: transparent;
  cursor: pointer;
  transition: all var(--lj-transition-fast);
  color: var(--lj-text-muted);
  font-size: var(--lj-text-sm);
}
.position-btn:hover {
  border-color: var(--lj-ui-accent);
  color: var(--lj-text);
}
.position-btn:focus-visible {
  outline: none;
  box-shadow: var(--lj-ui-focus);
}
/* O hover já pinta a borda de acento; sem preencher, "selecionado" e "sob o
   ponteiro" ficavam quase iguais e a escolha atual sumia. */
.position-btn--active {
  border-color: var(--lj-ui-accent);
  background: var(--lj-ui-accent);
  color: var(--lj-ui-accent-fg);
  font-weight: var(--lj-weight-semibold);
}
</style>
