<template>
  <div class="pm-online" data-testid="pm-library-online">
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
          v-bind="menuFor(video)"
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
import DateTime from "@/helpers/DateTime";
import $snackbar from "@/helpers/Snackbar";
import { prepare as prepareOnlineVideo, youtubeThumb } from "@/helpers/OnlineVideo";
import { useModuleI18n } from "@/composables/useModuleI18n";
import type { ProgramItem } from "@/types/Presentation";
import { onlineItem } from "../program/items";
import type { Playable, PlayOptions } from "../program/playable";
import { onlinePlayable } from "../composables/useOnlinePlayback";
import { onlineReturnPath } from "../composables/returnTarget";
import {
  confirmRemoveFavorite,
  useOnlineLibrary,
  type OnlineEntry,
} from "../composables/useOnlineLibrary";

/**
 * A grade on-line da aba Mídia (a barra lateral é o OnlineSources): vídeos,
 * playlists e canais do YouTube que o operador favoritou. Um clique leva o vídeo para a prévia do palco; ▶ ou
 * duplo clique projeta; + põe no programa. O canal lista do mais recente ao
 * mais antigo, e a lista continua ao rolar até o fim.
 */

const props = defineProps<{
  liveVideoId: string | null;
  /** O que está só no retorno de palco (`youtube:<id>` para vídeo on-line). */
  returnPath: string | null;
}>();
const emit = defineEmits<{
  preview: [playable: Playable];
  play: [playable: Playable, options?: PlayOptions];
  add: [item: ProgramItem];
  stop: [];
  "show-on-return": [target: Playable | null];
}>();

const { tm, locale } = useModuleI18n(ModuleEnum.PRESENTATION_MODE);
const online = useOnlineLibrary();
const current = online.openFavorite;

const selectedId = ref<string | null>(null);
function select(video: OnlineEntry): void {
  selectedId.value = video.id;
  emit("preview", onlinePlayable(video));
}

const favoriteVideo = (id: string) => online.videos.value.find((f) => f.ytId === id) ?? null;

/** Menu do vídeo: reproduzir e pré-visualizar em cima; o resto embaixo. */
function menuFor(video: OnlineEntry): { quick: LjMenuItem[]; items: LjMenuItem[] } {
  const fav = favoriteVideo(video.id);
  return {
    quick: [
      {
        label: tm("library.play"),
        icon: ICONS.PLAYER.PLAY,
        action: () => emit("play", onlinePlayable(video)),
      },
      { label: tm("library.preview"), icon: ICONS.UI.EYE, action: () => select(video) },
    ],
    items: [
      {
        label: tm("library.play_muted"),
        icon: ICONS.PLAYER.VOLUME_MUTE,
        action: () => emit("play", onlinePlayable(video), { muted: true }),
      },
      props.returnPath === onlineReturnPath(video.id)
        ? {
            label: tm("library.remove_from_return"),
            icon: ICONS.PROJECTION.RETURN,
            action: () => emit("show-on-return", null),
          }
        : {
            label: tm("library.play_on_return"),
            icon: ICONS.PROJECTION.RETURN,
            action: () => emit("show-on-return", onlinePlayable(video)),
          },
      { separator: true },
      {
        label: tm("library.add_to_program"),
        icon: ICONS.ACTIONS.ADD,
        action: () => emit("add", onlineItem(video)),
      },
      { separator: true },
      fav
        ? {
            label: tm("online.remove"),
            icon: ICONS.ACTIONS.DELETE,
            action: () => confirmRemoveFavorite(fav),
          }
        : {
            label: tm("online.favorite_video"),
            icon: ICONS.UI.STAR,
            action: () => void save(`https://www.youtube.com/watch?v=${video.id}`),
          },
    ],
  };
}

/* ─── Adicionar ─── */

const adding = ref(false);
const saving = ref(false);
const url = ref("");
const urlInput = ref<{ focus?: () => void } | null>(null);

/** O "Adicionar link" da barra lateral abre o campo aqui em cima. */
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

/* ─── Rolagem ─── */

const grid = ref<HTMLElement | null>(null);
function onScroll(): void {
  const el = grid.value;
  if (el && el.scrollTop + el.clientHeight >= el.scrollHeight - 160)
    void online.loadMore(locale.value);
}

defineExpose({ startAdding });

onMounted(() => {
  void online.ensureLoaded();
  // Instala o yt-dlp de antemão: o primeiro vídeo não paga a instalação.
  prepareOnlineVideo();
});
</script>

<style scoped>
.pm-online {
  display: flex;
  min-width: 0;
  min-height: 0;
}

.pm-online__main {
  flex: 1;
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
  border-color: var(--lj-live-select);
}

.pm-online__card--live .pm-online__thumb {
  border-color: var(--lj-orange);
  box-shadow: 0 0 0 2px var(--lj-orange);
}

.pm-online__card--selected:not(.pm-online__card--live) .pm-online__thumb {
  border-color: var(--lj-live-select);
  box-shadow: inset 0 0 0 2px var(--lj-live-select);
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
