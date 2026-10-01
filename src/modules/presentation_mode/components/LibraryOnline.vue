<template>
  <div class="pm-online" data-testid="pm-library-online">
    <nav class="pm-online__nav" :aria-label="tm('online.favorites')">
      <button
        type="button"
        class="pm-online__src"
        :class="{ 'pm-online__src--active': online.openId.value === VIDEOS }"
        data-testid="pm-online-videos"
        @click="online.open(VIDEOS)"
      >
        <LjIcon :icon="ICONS.MEDIA.YOUTUBE" :size="15" />
        <span class="pm-online__src-label">{{ tm("online.videos") }}</span>
        <span class="pm-online__src-count">{{ online.videos.value.length || "" }}</span>
      </button>
      <span v-if="online.collections.value.length" class="pm-online__group">
        {{ tm("online.collections") }}
      </span>
      <draggable
        :model-value="online.collections.value"
        item-key="id"
        tag="div"
        class="pm-online__list"
        :animation="150"
        ghost-class="pm-online__src--ghost"
        @update:model-value="(list: OnlineCollectionFavorite[]) => online.reorder(list)"
      >
        <template #item="{ element: fav }">
          <div
            class="pm-online__src pm-online__src--user"
            :class="{ 'pm-online__src--active': online.openId.value === fav.id }"
            role="button"
            tabindex="0"
            :title="
              fav.channel && fav.kind === 'playlist' ? `${fav.title} · ${fav.channel}` : fav.title
            "
            :data-testid="`pm-online-src-${fav.ytId}`"
            @click="online.open(fav.id, locale)"
            @keydown.enter.self="online.open(fav.id, locale)"
          >
            <img
              v-if="fav.kind === 'channel' && fav.thumbnail"
              :src="fav.thumbnail"
              alt=""
              class="pm-online__avatar"
            />
            <LjIcon
              v-else
              :icon="fav.kind === 'channel' ? ICONS.UI.ACCOUNT : ICONS.MEDIA.PLAYLIST"
              :size="15"
            />
            <span class="pm-online__src-label">{{ fav.title }}</span>
            <button
              type="button"
              class="pm-online__remove"
              :title="tm('online.remove')"
              :aria-label="tm('online.remove')"
              @click.stop="confirmRemove(fav)"
            >
              <LjIcon :icon="ICONS.ACTIONS.CLOSE" :size="11" />
            </button>
          </div>
        </template>
      </draggable>
      <button
        type="button"
        class="pm-online__src pm-online__src--add"
        data-testid="pm-online-add"
        @click="startAdding"
      >
        <LjIcon :icon="ICONS.UI.LINK" :size="15" />
        <span class="pm-online__src-label">{{ tm("online.add") }}</span>
      </button>
    </nav>

    <div class="pm-online__main">
      <header class="pm-online__head">
        <form v-if="adding" class="pm-online__form" @submit.prevent="submit">
          <LjInput
            ref="urlInput"
            v-model="url"
            size="sm"
            :icon="ICONS.UI.LINK"
            :placeholder="tm('online.paste')"
            :disabled="saving"
            data-testid="pm-online-url"
            @keydown.esc.stop="adding = false"
          />
          <LjButton
            size="sm"
            variant="primary"
            type="submit"
            :loading="saving"
            data-testid="pm-online-save"
          >
            {{ tm("online.save") }}
          </LjButton>
          <LjButton size="sm" variant="ghost" :disabled="saving" @click="adding = false">
            {{ $t("actions.cancel") }}
          </LjButton>
        </form>
        <template v-else>
          <img
            v-if="current?.kind === 'channel' && current.thumbnail"
            :src="current.thumbnail"
            alt=""
            class="pm-online__avatar pm-online__avatar--lg"
          />
          <span class="pm-online__title">{{ current?.title ?? tm("online.videos") }}</span>
          <span v-if="current" class="pm-online__sub">
            {{ current.kind === "channel" ? tm("online.channel_order") : current.channel }}
          </span>
          <LjButton
            v-if="current"
            size="sm"
            variant="ghost"
            icon-only
            :icon="ICONS.ACTIONS.REFRESH"
            :title="tm('online.refresh')"
            :disabled="online.loading.value"
            data-testid="pm-online-refresh"
            @click="online.open(current.id, locale, true)"
          />
        </template>
      </header>

      <div v-if="online.error.value && !online.entries.value.length" class="pm-online__empty">
        <p>{{ tm(`online.${online.error.value}`) }}</p>
        <LjButton
          v-if="current"
          size="sm"
          :icon="ICONS.ACTIONS.REFRESH"
          @click="online.open(current.id, locale, true)"
        >
          {{ tm("online.retry") }}
        </LjButton>
      </div>
      <p v-else-if="online.loading.value && !online.entries.value.length" class="pm-online__empty">
        {{ tm("library.loading") }}
      </p>
      <div v-else-if="!online.entries.value.length" class="pm-online__empty">
        <p>{{ tm("online.empty") }}</p>
        <LjButton size="sm" :icon="ICONS.UI.LINK" @click="startAdding">
          {{ tm("online.add") }}
        </LjButton>
      </div>
      <div
        v-else
        ref="grid"
        class="pm-online__grid"
        data-testid="pm-online-grid"
        @scroll.passive="onScroll"
      >
        <LjContextMenu
          v-for="video in online.entries.value"
          :key="video.id"
          :items="menuFor(video)"
        >
          <div
            class="pm-online__card"
            :class="{
              'pm-online__card--selected': video.id === selectedId,
              'pm-online__card--live': video.id === liveVideoId,
            }"
            role="button"
            tabindex="0"
            :title="video.title"
            :data-testid="`pm-online-video-${video.id}`"
            @click="select(video)"
            @dblclick="emit('play', onlinePlayable(video))"
            @keydown.enter.self="emit('play', onlinePlayable(video))"
          >
            <span class="pm-online__thumb">
              <img :src="youtubeThumb(video.id)" alt="" loading="lazy" />
              <span v-if="video.duration" class="pm-online__badge">
                {{ DateTime.shortTime(video.duration) }}
              </span>
              <LjTooltip :text="video.id === liveVideoId ? tm('library.stop') : tm('library.play')">
                <button
                  type="button"
                  class="pm-online__action"
                  :aria-label="video.id === liveVideoId ? tm('library.stop') : tm('library.play')"
                  :data-testid="`pm-online-play-${video.id}`"
                  @click.stop="
                    video.id === liveVideoId ? emit('stop') : emit('play', onlinePlayable(video))
                  "
                  @dblclick.stop
                >
                  <LjIcon
                    :icon="video.id === liveVideoId ? ICONS.ACTIONS.CLOSE : ICONS.PLAYER.PLAY"
                    :size="26"
                  />
                </button>
              </LjTooltip>
              <LjTooltip :text="tm('library.add_to_program')">
                <button
                  type="button"
                  class="pm-online__add"
                  :aria-label="tm('library.add_to_program')"
                  :data-testid="`pm-online-addprog-${video.id}`"
                  @click.stop="emit('add', onlineItem(video))"
                  @dblclick.stop
                >
                  <LjIcon :icon="ICONS.ACTIONS.ADD" :size="14" />
                </button>
              </LjTooltip>
            </span>
            <span class="pm-online__name">{{ video.title }}</span>
            <span v-if="video.channel && !current" class="pm-online__channel">
              {{ video.channel }}
            </span>
          </div>
        </LjContextMenu>
        <p v-if="online.loading.value" class="pm-online__more">{{ tm("library.loading") }}</p>
        <LjButton
          v-else-if="online.hasMore.value"
          class="pm-online__more"
          size="sm"
          variant="ghost"
          data-testid="pm-online-more"
          @click="online.loadMore(locale)"
        >
          {{ tm("online.load_more") }}
        </LjButton>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onMounted, ref } from "vue";
import draggable from "vuedraggable";
import {
  LjButton,
  LjContextMenu,
  LjIcon,
  LjInput,
  LjTooltip,
  type LjMenuItem,
} from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { ModuleEnum } from "@/enums/ModuleEnum";
import $alert from "@/helpers/Alert";
import DateTime from "@/helpers/DateTime";
import $snackbar from "@/helpers/Snackbar";
import { prepare as prepareOnlineVideo, youtubeThumb } from "@/helpers/OnlineVideo";
import { useModuleI18n } from "@/composables/useModuleI18n";
import type { ProgramItem } from "@/types/Presentation";
import { onlineItem } from "../program/items";
import type { Playable } from "../program/playable";
import { onlinePlayable } from "../composables/useOnlinePlayback";
import {
  useOnlineLibrary,
  VIDEOS,
  type OnlineCollectionFavorite,
  type OnlineEntry,
  type OnlineFavorite,
} from "../composables/useOnlineLibrary";

/**
 * Aba Vídeos on-line da biblioteca: vídeos, playlists e canais do YouTube que
 * o operador favoritou. Um clique leva o vídeo para a prévia do palco; ▶ ou
 * duplo clique projeta; + põe no programa. O canal lista do mais recente ao
 * mais antigo, e a lista continua ao rolar até o fim.
 */

defineProps<{ liveVideoId: string | null }>();
const emit = defineEmits<{
  preview: [playable: Playable];
  play: [playable: Playable];
  add: [item: ProgramItem];
  stop: [];
}>();

const { tm, locale } = useModuleI18n(ModuleEnum.PRESENTATION_MODE);
const alertKey = (key: string) => `modules.${ModuleEnum.PRESENTATION_MODE}.${key}`;
const online = useOnlineLibrary();
const current = online.openFavorite;

const selectedId = ref<string | null>(null);
function select(video: OnlineEntry): void {
  selectedId.value = video.id;
  emit("preview", onlinePlayable(video));
}

const favoriteVideo = (id: string) => online.videos.value.find((f) => f.ytId === id) ?? null;

function menuFor(video: OnlineEntry): LjMenuItem[] {
  const fav = favoriteVideo(video.id);
  return [
    {
      label: tm("library.play"),
      icon: ICONS.PLAYER.PLAY,
      action: () => emit("play", onlinePlayable(video)),
    },
    {
      label: tm("library.add_to_program"),
      icon: ICONS.ACTIONS.ADD,
      action: () => emit("add", onlineItem(video)),
    },
    { separator: true },
    fav
      ? { label: tm("online.remove"), icon: ICONS.ACTIONS.DELETE, action: () => confirmRemove(fav) }
      : {
          label: tm("online.favorite_video"),
          icon: ICONS.UI.STAR,
          action: () => void save(`https://www.youtube.com/watch?v=${video.id}`),
        },
  ];
}

/* ─── Adicionar ─── */

const adding = ref(false);
const saving = ref(false);
const url = ref("");
const urlInput = ref<{ focus?: () => void } | null>(null);

async function startAdding(): Promise<void> {
  adding.value = true;
  url.value = "";
  await nextTick();
  urlInput.value?.focus?.();
}

async function save(link: string): Promise<boolean> {
  saving.value = true;
  try {
    const { result, favorite } = await online.addFromUrl(link, locale.value);
    if (result === "added" || result === "exists") {
      $snackbar.success(tm(result === "added" ? "online.added" : "online.exists"));
      if (favorite && favorite.kind !== "video") void online.open(favorite.id, locale.value);
      return true;
    }
    $snackbar.error(tm(`online.${result}`));
    return false;
  } finally {
    saving.value = false;
  }
}

async function submit(): Promise<void> {
  if (!url.value.trim()) return;
  if (await save(url.value)) adding.value = false;
}

function confirmRemove(fav: OnlineFavorite): void {
  $alert.yesno(
    { title: alertKey("online.remove_title"), text: alertKey(`online.remove_${fav.kind}`) },
    (resp?: string) => {
      if (resp === "yes") void online.remove(fav.id);
    }
  );
}

/* ─── Rolagem ─── */

const grid = ref<HTMLElement | null>(null);
function onScroll(): void {
  const el = grid.value;
  if (el && el.scrollTop + el.clientHeight >= el.scrollHeight - 160)
    void online.loadMore(locale.value);
}

onMounted(() => {
  void online.ensureLoaded();
  // Instala o yt-dlp de antemão: o primeiro vídeo não paga a instalação.
  prepareOnlineVideo();
});
</script>

<style scoped>
.pm-online {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 168px minmax(0, 1fr);
}

.pm-online__nav {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow-y: auto;
  border-right: 1px solid var(--lj-surface-border);
}

.pm-online__group {
  padding: 8px 9px 3px 12px;
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  color: var(--lj-text-subtle);
}

.pm-online__list {
  display: flex;
  flex-direction: column;
}

.pm-online__src {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 27px;
  flex-shrink: 0;
  padding: 0 8px 0 9px;
  border: none;
  border-left: 3px solid transparent;
  background: transparent;
  color: var(--lj-text);
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
  transition: background 120ms var(--lj-ease);
}

.pm-online__src:hover {
  background: var(--lj-hover-bg);
}

.pm-online__src :deep(svg) {
  flex-shrink: 0;
  color: var(--lj-orange);
}

.pm-online__src--active {
  background: var(--lj-live-active-bg);
  border-left-color: var(--lj-orange);
}

.pm-online__src--user {
  cursor: grab;
}

.pm-online__src--ghost {
  opacity: 0.5;
}

.pm-online__src--add {
  color: var(--lj-orange);
}

.pm-online__src-label {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pm-online__src-count {
  flex-shrink: 0;
  font-family: var(--lj-font-mono);
  font-size: 10px;
  color: var(--lj-text-subtle);
}

.pm-online__avatar {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  border-radius: 50%;
  object-fit: cover;
}

.pm-online__avatar--lg {
  width: 22px;
  height: 22px;
}

.pm-online__remove {
  display: none;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  padding: 0;
  border: none;
  border-radius: 3px;
  background: transparent;
  color: var(--lj-text-muted);
  cursor: pointer;
}

.pm-online__src--user:hover .pm-online__remove,
.pm-online__remove:focus-visible {
  display: flex;
}

.pm-online__main {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.pm-online__head {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 39px;
  padding: 4px 8px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--lj-surface-border);
}

.pm-online__form {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
}

.pm-online__form > :first-child {
  flex: 1;
  max-width: 460px;
}

.pm-online__title {
  min-width: 0;
  font-weight: var(--lj-weight-semibold);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pm-online__sub {
  flex: 1;
  min-width: 0;
  font-size: 11px;
  color: var(--lj-text-subtle);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pm-online__empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--lj-space-3);
  margin: 0;
  padding: var(--lj-space-4);
  color: var(--lj-text-subtle);
  text-align: center;
}

.pm-online__empty p {
  margin: 0;
  max-width: 420px;
}

.pm-online__grid {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 8px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 10px 8px;
  align-content: start;
}

.pm-online__more {
  grid-column: 1 / -1;
  justify-self: center;
  margin: 4px 0;
  color: var(--lj-text-subtle);
}

.pm-online__card {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  color: var(--lj-text);
  cursor: pointer;
}

.pm-online__card:focus-visible {
  outline: none;
}

.pm-online__card:focus-visible .pm-online__thumb {
  box-shadow: var(--lj-ui-focus);
}

.pm-online__thumb {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  border: 1px solid var(--lj-surface-border);
  border-radius: 3px;
  background: var(--lj-live-stage-bg);
  transition: box-shadow 120ms var(--lj-ease);
}

.pm-online__thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.pm-online__card:hover .pm-online__thumb {
  border-color: var(--lj-navy-active);
}

.pm-online__card--live .pm-online__thumb {
  border-color: var(--lj-orange);
  box-shadow: 0 0 0 2px var(--lj-orange);
}

.pm-online__card--selected:not(.pm-online__card--live) .pm-online__thumb {
  border-color: var(--lj-navy-active);
  box-shadow: inset 0 0 0 2px var(--lj-navy-active);
}

.pm-online__badge {
  position: absolute;
  right: 4px;
  bottom: 4px;
  padding: 0 4px;
  border-radius: 2px;
  background: var(--lj-black-alpha-75);
  color: var(--lj-white);
  font-family: var(--lj-font-mono);
  font-size: 10px;
}

.pm-online__action,
.pm-online__add {
  position: absolute;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  color: var(--lj-white);
  background: var(--lj-black-alpha-40);
  cursor: pointer;
  opacity: 0;
  transition:
    opacity 120ms var(--lj-ease),
    background 120ms var(--lj-ease);
}

.pm-online__action {
  top: 50%;
  left: 50%;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  transform: translate(-50%, -50%);
}

.pm-online__add {
  top: 4px;
  right: 4px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
}

.pm-online__card:hover .pm-online__action,
.pm-online__card:hover .pm-online__add,
.pm-online__card:focus-within .pm-online__action,
.pm-online__card:focus-within .pm-online__add {
  opacity: 1;
}

.pm-online__action:hover,
.pm-online__add:hover {
  background: var(--lj-black-alpha-75);
}

.pm-online__action:focus-visible,
.pm-online__add:focus-visible {
  outline: none;
  box-shadow: var(--lj-ui-focus);
}

.pm-online__name {
  display: -webkit-box;
  overflow: hidden;
  font-size: 11.5px;
  line-height: 1.3;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.pm-online__channel {
  font-size: 10.5px;
  color: var(--lj-text-subtle);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
