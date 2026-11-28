<template>
  <div class="pm-ovl" data-testid="pm-library-online-videos">
    <aside class="pm-ovl__side">
      <div class="pm-ovl__search">
        <LjInput
          v-model="search"
          size="sm"
          :icon="ICONS.ACTIONS.SEARCH"
          :placeholder="tm('library.online_search')"
          clearable
          data-testid="pm-ovl-search"
        />
      </div>

      <div class="pm-ovl__add">
        <LjButton
          block
          size="sm"
          variant="subtle"
          :icon="ICONS.ACTIONS.ADD"
          data-testid="pm-ovl-add-video"
          @click="addOpen = true"
        >
          {{ tm("library.online_add") }}
        </LjButton>
      </div>

      <div ref="groupsBox" class="pm-ovl__groups">
        <section class="pm-ovl__group">
          <button
            type="button"
            class="pm-ovl__group-title pm-ovl__group-title--toggle"
            :aria-expanded="channelsOpen"
            @click="channelsOpen = !channelsOpen"
          >
            <LjIcon
              :icon="channelsOpen ? ICONS.UI.CHEVRON_UP : ICONS.UI.CHEVRON_RIGHT"
              :size="10"
            />
            {{ tm("library.online_videos") }}
          </button>
          <div
            class="pm-collapse"
            :class="{ 'pm-collapse--open': channelsOpen }"
            :inert="!channelsOpen"
          >
            <div class="pm-collapse__inner">
              <CategoryListItem
                category-id="*"
                :name="tm('library.online_all_videos')"
                :icon="ICONS.MEDIA.YOUTUBE"
                icon-type="icon"
                color="#e74c3c"
                :count="catalog.allVideos.value.length"
                :active="selection.kind === 'catalog-all'"
                :show-menu="false"
                data-testid="pm-ovl-all"
                @select="selectAll"
              />
              <CategoryListItem
                v-for="row in channelRows"
                :key="row.channel.channel_id"
                :category-id="row.channel.channel_id"
                :name="row.channel.title"
                :icon="channelIcon(row.channel)"
                :icon-type="channelIconType(row.channel)"
                color="#e74c3c"
                :count="row.count"
                :active="isChannelActive(row.channel.channel_id)"
                :show-menu="false"
                :data-testid="`pm-ovl-channel-${row.channel.channel_id}`"
                @select="selectChannel(row.channel)"
              />
            </div>
          </div>
        </section>

        <section class="pm-ovl__group">
          <button
            type="button"
            class="pm-ovl__group-title pm-ovl__group-title--toggle"
            :aria-expanded="myVideosOpen"
            @click="myVideosOpen = !myVideosOpen"
          >
            <LjIcon
              :icon="myVideosOpen ? ICONS.UI.CHEVRON_UP : ICONS.UI.CHEVRON_RIGHT"
              :size="10"
            />
            {{ tm("library.online_my_videos") }}
          </button>
          <div
            class="pm-collapse"
            :class="{ 'pm-collapse--open': myVideosOpen }"
            :inert="!myVideosOpen"
          >
            <div class="pm-collapse__inner">
              <CategoryListItem
                category-id="*"
                :name="tm('library.online_all_my_videos')"
                :icon="ICONS.MEDIA.YOUTUBE"
                icon-type="icon"
                color="#9b59b6"
                :count="custom.videos.value.length"
                :active="isCustomAllActive()"
                :show-menu="false"
                data-testid="pm-ovl-custom-all"
                @select="selectCustomAll"
              />
              <CategoryListItem
                category-id=""
                :name="t('shell.category.uncategorized')"
                :icon="ICONS.MEDIA.YOUTUBE"
                icon-type="icon"
                color="#607d8b"
                :count="custom.countOf('')"
                :active="isCategoryActive('')"
                :show-menu="false"
                data-testid="pm-ovl-uncategorized"
                @select="selectCustom('')"
              />
              <CategoryListItem
                v-for="row in categoryRows"
                :key="row.category.id"
                :category-id="row.category.id"
                :name="row.category.name"
                :icon="customCategoryIcon(row.category)"
                :icon-type="customCategoryIconType(row.category)"
                :color="row.category.color || '#9b59b6'"
                :count="row.count"
                :active="isCategoryActive(row.category.id)"
                :show-menu="false"
                :data-testid="`pm-ovl-category-${row.category.id}`"
                @select="selectCustom(row.category.id)"
              />
            </div>
          </div>
        </section>
      </div>
    </aside>

    <section class="pm-ovl__content">
      <header class="pm-ovl__head">
        <LjButton
          v-if="canGoBack"
          size="sm"
          variant="ghost"
          icon-only
          :icon="ICONS.UI.ARROW_LEFT"
          :title="t('actions.back')"
          :aria-label="t('actions.back')"
          data-testid="pm-ovl-back"
          @click="goBack"
        />
        <img
          v-if="selectedChannelImage"
          :src="selectedChannelImage"
          alt=""
          class="pm-ovl__avatar"
        />
        <div class="pm-ovl__titles">
          <span class="pm-ovl__title">{{ contentTitle }}</span>
          <span class="pm-ovl__sub">{{ contentSubtitle }}</span>
        </div>
        <span class="pm-ovl__spacer" />
        <LjButton
          size="sm"
          variant="ghost"
          icon-only
          :icon="ICONS.ACTIONS.REFRESH"
          :title="t('actions.refresh')"
          :disabled="catalog.loading.value || custom.loading.value"
          data-testid="pm-ovl-refresh"
          @click="refresh"
        />
      </header>

      <div class="pm-ovl__body">
        <div v-if="selection.kind === 'none'" class="pm-ovl__blank">
          <button
            type="button"
            class="pm-ovl__welcome"
            data-testid="pm-ovl-welcome"
            @click="focusSidebar"
          >
            <span class="pm-ovl__welcome-icon">
              <LjIcon :icon="ICONS.MEDIA.YOUTUBE" :size="38" />
            </span>
            <span class="pm-ovl__welcome-title">{{ tm("library.online_pick_title") }}</span>
            <span class="pm-ovl__welcome-text">{{ tm("library.online_pick_hint") }}</span>
            <span class="pm-ovl__welcome-action">
              <LjIcon :icon="ICONS.UI.ARROW_LEFT" :size="13" />
              {{ tm("library.online_pick_action") }}
            </span>
          </button>
        </div>

        <p v-else-if="contentLoading" class="pm-ovl__empty">{{ tm("library.loading") }}</p>

        <div
          v-else-if="contentError"
          class="pm-ovl__empty pm-ovl__empty--error"
          data-testid="pm-ovl-error"
        >
          <p>{{ tm("library.online_load_error") }}</p>
          <LjButton size="sm" :icon="ICONS.ACTIONS.REFRESH" @click="refresh">
            {{ t("alert.retry") }}
          </LjButton>
        </div>

        <div v-else-if="showPlaylists" class="pm-ovl__playlist-grid">
          <LjContextMenu
            v-for="row in playlistRows"
            :key="row.playlist.playlist_id"
            v-bind="playlistMenu(row.playlist)"
          >
            <OnlineVideoCard
              :entity="row.entity"
              variant="playlist"
              :subtitle="tm('library.online_video_count', { n: row.count })"
              :first-video-id="row.firstVideoId"
              :data-testid="`pm-ovl-playlist-${row.playlist.playlist_id}`"
              @select="openPlaylist(row.playlist)"
            />
          </LjContextMenu>
          <p v-if="!playlistRows.length" class="pm-ovl__empty">
            {{ tm("library.online_empty") }}
          </p>
        </div>

        <div v-else-if="videoCards.length" class="pm-ovl__grid" data-testid="pm-ovl-grid">
          <LjContextMenu v-for="card in videoCards" :key="card.videoId" v-bind="videoMenu(card)">
            <div
              class="pm-ovl__video"
              :data-testid="`pm-ovl-card-${card.videoId}`"
              @click="onVideoClick($event, card)"
            >
              <OnlineVideoCard
                :entity="card.entity"
                variant="video"
                :subtitle="card.subtitle"
                :active="card.videoId === liveVideoId"
              />
              <div class="pm-ovl__video-actions">
                <LjButton
                  size="sm"
                  variant="primary"
                  icon-only
                  :icon="ICONS.PLAYER.PLAY"
                  :title="tm('library.play')"
                  :aria-label="tm('library.play')"
                  :data-testid="`pm-ovl-play-${card.videoId}`"
                  @click.stop="play(card)"
                  @keydown.stop
                />
                <LjButton
                  size="sm"
                  variant="ghost"
                  icon-only
                  :icon="ICONS.ACTIONS.ADD"
                  :title="tm('library.add_to_program')"
                  :aria-label="tm('library.add_to_program')"
                  :data-testid="`pm-ovl-add-${card.videoId}`"
                  @click.stop="add(card)"
                  @keydown.stop
                />
              </div>
            </div>
          </LjContextMenu>
        </div>

        <p v-else class="pm-ovl__empty">
          {{ query ? tm("library.online_no_results") : tm("library.online_empty") }}
        </p>
      </div>

      <footer class="pm-ovl__foot">
        <LjIcon :icon="ICONS.MEDIA.YOUTUBE" :size="12" />
        <span>{{ countLabel }}</span>
        <span class="pm-ovl__spacer" />
        <LjButton
          size="sm"
          variant="ghost"
          :icon="ICONS.UI.OPEN_IN_NEW"
          data-testid="pm-ovl-manage"
          @click="openManage"
        >
          {{ manageLabel }}
        </LjButton>
      </footer>
    </section>

    <OnlineVideoAddDialog
      v-model="addOpen"
      :categories="categoryOptions"
      :default-category-id="addDefaultCategory"
      :saving="adding"
      @save="saveVideo"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onActivated, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { LjButton, LjContextMenu, LjIcon, LjInput, type LjMenuItem } from "@/components/ui";
import CategoryListItem from "./CategoryListItem.vue";
import OnlineVideoAddDialog from "./OnlineVideoAddDialog.vue";
import OnlineVideoCard, {
  type OnlineVideo as OnlineVideoCardEntity,
  type Playlist as OnlineVideoCardPlaylist,
} from "@/modules/online_videos/components/OnlineVideoCard.vue";
import { ICONS } from "@/config/Icons";
import { ModuleEnum } from "@/enums/ModuleEnum";
import $alert from "@/helpers/Alert";
import Modules from "@/helpers/Modules";
import $snackbar from "@/helpers/Snackbar";
import Strings from "@/helpers/Strings";
import { prepare as prepareOnlineVideo } from "@/helpers/OnlineVideo";
import { useModuleI18n } from "@/composables/useModuleI18n";
import { useOnlineVideoDownloads } from "@/composables/useOnlineVideoDownloads";
import type { ProgramItem } from "@/types/Presentation";
import type { Playable, PlayOptions } from "../program/playable";
import { onlineItem } from "../program/items";
import { onlinePlayable } from "../composables/useOnlinePlayback";
import { useHasStageMonitor } from "../composables/useOutputs";
import { onlineReturnPath } from "../composables/returnTarget";
import {
  useOnlineCatalog,
  type OnlineCatalogChannel,
  type OnlineCatalogPlaylist,
  type OnlineCatalogVideo,
} from "../composables/useOnlineCatalog";
import {
  useCustomOnlineVideos,
  type CustomOnlineCategory,
  type CustomOnlineVideo,
} from "../composables/useCustomOnlineVideos";
import { useOnlineVideosSelection } from "../composables/useOnlineVideosSelection";

/**
 * Aba Vídeos online: a coletânea do módulo Vídeos On-line (canais → playlists
 * → vídeos) e os links de Meus Vídeos Online, cada grupo na lateral esquerda.
 */

interface PlaylistRow {
  playlist: OnlineCatalogPlaylist;
  entity: OnlineVideoCardPlaylist;
  count: number;
  firstVideoId: string;
}

interface VideoCardEntry {
  entity: OnlineVideoCardEntity;
  videoId: string;
  title: string;
  subtitle?: string;
}

const props = defineProps<{
  liveVideoId: string | null;
  returnPath?: string | null;
}>();
const emit = defineEmits<{
  preview: [playable: Playable];
  play: [playable: Playable, options?: PlayOptions];
  add: [item: ProgramItem];
  "show-on-return": [target: Playable | null];
}>();

const { t, tm, locale } = useModuleI18n(ModuleEnum.PRESENTATION_MODE);
const hasStageMonitor = useHasStageMonitor();
const catalog = useOnlineCatalog();
const custom = useCustomOnlineVideos();
const downloads = useOnlineVideoDownloads();

const { selection, channelsOpen, myVideosOpen } = useOnlineVideosSelection();
const search = ref("");
const addOpen = ref(false);
const adding = ref(false);
const groupsBox = ref<HTMLElement | null>(null);

const query = computed(() => Strings.fold(search.value.trim()));

const channelRows = computed(() =>
  catalog.channels.value.map((channel) => ({
    channel,
    count: catalog.videosOfChannel(channel.channel_id).length,
  }))
);

const categoryRows = computed(() =>
  custom.categories.value.map((category) => ({
    category,
    count: custom.countOf(category.id),
  }))
);

const categoryOptions = computed(() =>
  custom.categories.value.map((category) => ({ id: category.id, name: category.name }))
);

const selectedChannel = computed<OnlineCatalogChannel | null>(() => {
  if (selection.value.kind !== "catalog-channel" && selection.value.kind !== "catalog-playlist")
    return null;
  return catalog.channelById.value.get(selection.value.channelId) ?? null;
});

const selectedChannelImage = computed(() =>
  selectedChannel.value
    ? safeImage(selectedChannel.value.default_image_base64, selectedChannel.value.default_image)
    : ""
);

const selectedPlaylist = computed<OnlineCatalogPlaylist | null>(() => {
  if (selection.value.kind !== "catalog-playlist") return null;
  return catalog.playlistById.value.get(selection.value.playlistId) ?? null;
});

const selectedCategory = computed<CustomOnlineCategory | null>(() => {
  const current = selection.value;
  if (current.kind !== "custom") return null;
  return custom.categories.value.find((category) => category.id === current.categoryId) ?? null;
});

const isCustomSelection = computed(
  () => selection.value.kind === "custom" || selection.value.kind === "custom-all"
);

const canGoBack = computed(
  () => selection.value.kind === "catalog-channel" || selection.value.kind === "catalog-playlist"
);

const showPlaylists = computed(() => selection.value.kind === "catalog-channel" && !query.value);

const playlistRows = computed<PlaylistRow[]>(() => {
  if (selection.value.kind !== "catalog-channel") return [];
  return catalog.playlistsOfChannel(selection.value.channelId).map((playlist) => {
    const videos = catalog.videosOfPlaylist(playlist.playlist_id);
    return {
      playlist,
      entity: { ...playlist, default_image: playlist.default_image || "" },
      count: videos.length,
      firstVideoId: catalog.firstVideoIdOfPlaylist(playlist.playlist_id),
    };
  });
});

function safeImage(...values: (string | undefined)[]): string {
  return values.find((value) => /^(data:image\/|https?:\/\/|blob:)/i.test(value || "")) || "";
}

function catalogVideoCard(video: OnlineCatalogVideo): VideoCardEntry {
  const entity: OnlineVideoCardEntity = {
    ...video,
    sequence: video.sequence ?? 0,
    default_image: video.default_image || "",
  };
  return {
    entity,
    videoId: video.video_id,
    title: video.title,
    subtitle: catalog.channelTitleOfVideo(video),
  };
}

function customVideoCard(video: CustomOnlineVideo): VideoCardEntry | null {
  const videoId = custom.youtubeIdOf(video.url);
  if (!videoId) return null;
  const category = custom.categoryOf(video);
  const title = custom.displayName(video);
  return {
    entity: {
      video_id: videoId,
      playlist_id: "",
      title,
      sequence: 0,
      // Miniatura do cache local entra como último recurso da cadeia de
      // qualidade do card do módulo de Vídeos On-line.
      default_image: custom.thumbOf(video),
    },
    videoId,
    title,
    subtitle: category?.name || t("shell.category.uncategorized"),
  };
}

function matches(...values: (string | undefined)[]): boolean {
  if (!query.value) return true;
  return values.some((value) => Strings.fold(value || "").includes(query.value));
}

const sourceVideos = computed<VideoCardEntry[]>(() => {
  switch (selection.value.kind) {
    case "catalog-all":
      return catalog.allVideos.value.map(catalogVideoCard);
    case "catalog-channel":
      return catalog.videosOfChannel(selection.value.channelId).map(catalogVideoCard);
    case "catalog-playlist":
      return catalog.videosOfPlaylist(selection.value.playlistId).map(catalogVideoCard);
    case "custom-all":
      return custom.videos.value
        .map(customVideoCard)
        .filter((card): card is VideoCardEntry => card !== null);
    case "custom":
      return custom
        .videosOfCategory(selection.value.categoryId)
        .map(customVideoCard)
        .filter((card): card is VideoCardEntry => card !== null);
    default:
      return [];
  }
});

const videoCards = computed(() =>
  sourceVideos.value.filter((card) => matches(card.title, card.subtitle))
);

const contentTitle = computed(() => {
  switch (selection.value.kind) {
    case "catalog-all":
      return tm("library.online_all_videos");
    case "catalog-channel":
      return selectedChannel.value?.title || tm("library.online_channels");
    case "catalog-playlist":
      return selectedPlaylist.value?.title || tm("library.online_playlists");
    case "custom-all":
      return tm("library.online_all_my_videos");
    case "custom":
      return selectedCategory.value?.name || t("shell.category.uncategorized");
    default:
      return tm("library.online_videos");
  }
});

const contentSubtitle = computed(() => {
  if (selection.value.kind === "none") return tm("library.online_pick_header");
  return showPlaylists.value
    ? tm("library.online_playlists_count", { n: playlistRows.value.length })
    : tm("library.online_video_count", { n: videoCards.value.length });
});

const contentLoading = computed(() => {
  if (selection.value.kind === "none") return false;
  if (isCustomSelection.value) return custom.loading.value && !custom.loaded.value;
  return catalog.loading.value && !catalog.loaded.value;
});

const contentError = computed(() => {
  if (selection.value.kind === "none") return false;
  if (isCustomSelection.value) {
    return (
      custom.error.value &&
      !custom.loading.value &&
      !custom.videos.value.length &&
      !custom.categories.value.length
    );
  }
  return (
    catalog.error.value &&
    !catalog.loading.value &&
    !catalog.channels.value.length &&
    !catalog.allVideos.value.length
  );
});

const countLabel = computed(() => {
  if (selection.value.kind === "none") return tm("library.online_pick_footer");
  return showPlaylists.value
    ? tm("library.online_playlists_count", { n: playlistRows.value.length })
    : tm("library.online_video_count", { n: videoCards.value.length });
});

const manageLabel = computed(() =>
  isCustomSelection.value ? tm("library.online_manage_custom") : tm("library.online_manage_catalog")
);

const addDefaultCategory = computed(() => {
  const current = selection.value;
  return current.kind === "custom" ? current.categoryId : "";
});

function channelIcon(channel: OnlineCatalogChannel): string {
  return safeImage(channel.default_image_base64, channel.default_image) || ICONS.UI.ACCOUNT;
}

function channelIconType(channel: OnlineCatalogChannel): "icon" | "image" {
  return safeImage(channel.default_image_base64, channel.default_image) ? "image" : "icon";
}

function customCategoryIcon(category: CustomOnlineCategory): string {
  const image = custom.categoryImageOf(category);
  if (image) return image;
  return category.iconType === "image" ? ICONS.MEDIA.YOUTUBE : category.icon || ICONS.MEDIA.YOUTUBE;
}

function customCategoryIconType(category: CustomOnlineCategory): "icon" | "image" {
  return custom.categoryImageOf(category) ? "image" : "icon";
}

function isChannelActive(channelId: string): boolean {
  return (
    (selection.value.kind === "catalog-channel" || selection.value.kind === "catalog-playlist") &&
    selection.value.channelId === channelId
  );
}

function isCategoryActive(categoryId: string): boolean {
  return selection.value.kind === "custom" && selection.value.categoryId === categoryId;
}

function isCustomAllActive(): boolean {
  return selection.value.kind === "custom-all";
}

function selectAll(): void {
  selection.value = { kind: "catalog-all" };
  search.value = "";
}

function selectChannel(channel: OnlineCatalogChannel): void {
  selection.value = { kind: "catalog-channel", channelId: channel.channel_id };
  search.value = "";
}

function selectCustomAll(): void {
  selection.value = { kind: "custom-all" };
  search.value = "";
}

function selectCustom(categoryId: string): void {
  selection.value = { kind: "custom", categoryId };
  search.value = "";
}

function openPlaylist(playlist: OnlineCatalogPlaylist): void {
  selection.value = {
    kind: "catalog-playlist",
    channelId: playlist.channel_id,
    playlistId: playlist.playlist_id,
  };
  search.value = "";
}

function goBack(): void {
  if (selection.value.kind === "catalog-playlist") {
    selection.value = { kind: "catalog-channel", channelId: selection.value.channelId };
  } else if (selection.value.kind === "catalog-channel") {
    selection.value = { kind: "none" };
  }
  search.value = "";
}

function focusSidebar(): void {
  const first = groupsBox.value?.querySelector<HTMLElement>(".pm-category-item");
  if (first) {
    first.scrollIntoView({ block: "nearest" });
    first.focus();
    return;
  }
  groupsBox.value?.querySelector<HTMLElement>(".pm-ovl__group-title--toggle")?.focus();
}

function refresh(): void {
  if (isCustomSelection.value) {
    void custom.load();
  } else {
    void catalog.load(locale.value, true);
  }
  void downloads.refresh().catch(() => {});
}

function onlinePlayableOf(card: VideoCardEntry): Playable {
  return onlinePlayable({
    id: card.videoId,
    title: card.title,
    duration: null,
    channel: card.subtitle,
  });
}

function preview(card: VideoCardEntry): void {
  emit("preview", onlinePlayableOf(card));
}

/** Clique nos controles de download do card não deve abrir a prévia. */
function onVideoClick(event: MouseEvent, card: VideoCardEntry): void {
  const target = event.target as Element | null;
  if (target?.closest(".ov-card-download, .ov-card-download-badge")) return;
  preview(card);
}

function play(card: VideoCardEntry): void {
  emit("play", onlinePlayableOf(card));
}

function add(card: VideoCardEntry): void {
  emit(
    "add",
    onlineItem({
      id: card.videoId,
      title: card.title,
      duration: null,
      channel: card.subtitle,
    })
  );
}

function askRemoveDownload(card: VideoCardEntry): void {
  $alert.yesno({ title: "online_video.download.confirm_remove" }, async (button?: string) => {
    if (button === "yes") await downloads.remove(card.videoId);
  });
}

function downloadMenu(card: VideoCardEntry): LjMenuItem[] {
  if (!downloads.available) return [];
  const state = downloads.stateOf(card.videoId);
  if (state === "downloading") {
    return [
      {
        label: t("online_video.download.cancel"),
        icon: ICONS.ACTIONS.CLOSE,
        action: () => downloads.cancel(card.videoId),
      },
    ];
  }
  if (state === "downloaded") {
    return [
      {
        label: t("online_video.download.remove"),
        icon: ICONS.ACTIONS.DOWNLOAD_OFF,
        action: () => askRemoveDownload(card),
      },
    ];
  }
  return [
    {
      label: t("online_video.download.start"),
      icon: ICONS.ACTIONS.DOWNLOAD,
      action: () => void downloads.download(card.videoId, card.title),
    },
  ];
}

function videoMenu(card: VideoCardEntry): { quick: LjMenuItem[]; items: LjMenuItem[] } {
  const onReturn = !!props.returnPath && props.returnPath === onlineReturnPath(card.videoId);
  return {
    quick: [
      { label: tm("library.play"), icon: ICONS.PLAYER.PLAY, action: () => play(card) },
      { label: tm("library.preview"), icon: ICONS.UI.EYE, action: () => preview(card) },
    ],
    items: [
      {
        label: tm("library.play_muted"),
        icon: ICONS.PLAYER.VOLUME_MUTE,
        action: () => emit("play", onlinePlayableOf(card), { muted: true }),
      },
      ...(onReturn
        ? [
            {
              label: tm("library.remove_from_return"),
              icon: ICONS.PROJECTION.RETURN,
              action: () => emit("show-on-return", null),
            },
          ]
        : hasStageMonitor.value
          ? [
              {
                label: tm("library.play_on_return"),
                icon: ICONS.PROJECTION.RETURN,
                action: () => emit("show-on-return", onlinePlayableOf(card)),
              },
            ]
          : []),
      { separator: true },
      {
        label: tm("library.add_to_program"),
        icon: ICONS.ACTIONS.ADD,
        action: () => add(card),
      },
      ...downloadMenu(card),
      { separator: true },
      {
        label: isCustomSelection.value
          ? tm("library.online_manage_custom")
          : tm("library.online_manage_catalog"),
        icon: ICONS.UI.OPEN_IN_NEW,
        action: openManage,
      },
    ],
  };
}

function playlistMenu(playlist: OnlineCatalogPlaylist): {
  quick: LjMenuItem[];
  items: LjMenuItem[];
} {
  return {
    quick: [
      {
        label: tm("library.online_open_playlist"),
        icon: ICONS.MEDIA.PLAYLIST,
        action: () => openPlaylist(playlist),
      },
    ],
    items: [
      { separator: true },
      {
        label: tm("library.online_manage_catalog"),
        icon: ICONS.UI.OPEN_IN_NEW,
        action: openManage,
      },
    ],
  };
}

async function saveVideo(payload: {
  url: string;
  name: string;
  categoryId: string;
}): Promise<void> {
  if (adding.value) return;
  adding.value = true;
  try {
    const result = await custom.addVideo(payload);
    if (!result.ok) {
      $snackbar.error(
        tm(
          result.error === "duplicate"
            ? "library.online_add_duplicate"
            : "library.online_add_invalid"
        )
      );
      return;
    }
    addOpen.value = false;
    search.value = "";
    selection.value = { kind: "custom", categoryId: result.video.categoryId || "" };
  } catch {
    $snackbar.error(tm("library.online_add_failed"));
  } finally {
    adding.value = false;
  }
}

function openManage(): void {
  Modules.open(
    isCustomSelection.value ? ModuleEnum.CUSTOM_ONLINE_VIDEOS : ModuleEnum.ONLINE_VIDEOS
  );
}

watch(locale, () => {
  selection.value = { kind: "none" };
  search.value = "";
  void catalog.load(locale.value, true);
});

// A busca só faz sentido com um recorte; sem seleção, ela abre o catálogo
// completo. O custo de montar a grade aparece aqui, por ação do operador.
watch(query, (value) => {
  if (value && selection.value.kind === "none") selection.value = { kind: "catalog-all" };
});

// A seleção sobrevive à troca de abas; se o canal/categoria saiu da coletânea
// enquanto a aba estava fechada, volta para o convite em vez de uma grade vazia.
watch(
  [() => catalog.loaded.value, () => custom.loaded.value, selection],
  () => {
    const current = selection.value;
    if (current.kind === "catalog-channel" && catalog.loaded.value) {
      if (!catalog.channelById.value.has(current.channelId)) selection.value = { kind: "none" };
    } else if (current.kind === "catalog-playlist" && catalog.loaded.value) {
      if (!catalog.playlistById.value.has(current.playlistId)) selection.value = { kind: "none" };
    } else if (current.kind === "custom" && current.categoryId && custom.loaded.value) {
      if (!custom.categories.value.some((category) => category.id === current.categoryId)) {
        selection.value = { kind: "none" };
      }
    }
  },
  { immediate: true }
);

onMounted(() => {
  prepareOnlineVideo();
  void catalog.load(locale.value);
  void custom.load();
  if (downloads.available) void downloads.refresh().catch(() => {});
});

onActivated(() => {
  void custom.load();
  if (!catalog.loaded.value) void catalog.load(locale.value);
  if (downloads.available) void downloads.refresh().catch(() => {});
});

onBeforeUnmount(() => custom.disposeThumbs());
</script>

<style scoped>
.pm-ovl {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 168px minmax(0, 1fr);
  overflow: hidden;
}

.pm-ovl__side {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-right: 1px solid var(--lj-surface-border);
}

.pm-ovl__search {
  flex-shrink: 0;
  padding: var(--lj-space-2) var(--lj-space-3) 0;
}

.pm-ovl__search :deep(.lj-input) {
  width: 100%;
  min-width: 0;
}

.pm-ovl__add {
  flex-shrink: 0;
  padding: var(--lj-space-2) var(--lj-space-3);
}

.pm-ovl__groups {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 0 var(--lj-space-3);
  scrollbar-width: none;
}

.pm-ovl__group {
  display: flex;
  flex-direction: column;
  margin-bottom: var(--lj-space-3);
}

.pm-ovl__group-title {
  padding: var(--lj-space-2) var(--lj-space-3) 3px;
  color: var(--lj-text-subtle);
  font-size: 9.5px;
  font-weight: var(--lj-weight-semibold);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.pm-ovl__group-title--toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  border: none;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.pm-collapse {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 180ms var(--lj-ease);
}

.pm-collapse--open {
  grid-template-rows: 1fr;
}

.pm-collapse__inner {
  min-height: 0;
  overflow: hidden;
}

.pm-ovl__content {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.pm-ovl__head {
  display: flex;
  align-items: center;
  gap: var(--lj-space-2);
  flex-shrink: 0;
  padding: var(--lj-space-2) var(--lj-space-4);
  border-bottom: 1px solid var(--lj-surface-border);
}

.pm-ovl__avatar {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
}

.pm-ovl__titles {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.pm-ovl__title {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: var(--lj-text-sm);
  font-weight: var(--lj-weight-semibold);
}

.pm-ovl__sub {
  color: var(--lj-text-subtle);
  font-size: 10px;
}

.pm-ovl__spacer {
  flex: 1;
}

.pm-ovl__body {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  padding: var(--lj-space-3) var(--lj-space-4);
}

.pm-ovl__blank {
  min-height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--lj-space-4);
}

.pm-ovl__welcome {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--lj-space-2);
  max-width: 360px;
  padding: var(--lj-space-5) var(--lj-space-4);
  border: 1px solid color-mix(in srgb, #e74c3c 20%, var(--lj-surface-border));
  border-radius: var(--lj-radius-lg);
  background:
    radial-gradient(
      circle at 50% 0%,
      color-mix(in srgb, #e74c3c 12%, transparent),
      transparent 70%
    ),
    var(--lj-surface-bg-soft);
  color: var(--lj-text);
  text-align: center;
  cursor: pointer;
  transition:
    transform var(--lj-transition-normal),
    border-color var(--lj-transition-normal),
    box-shadow var(--lj-transition-normal);
}

.pm-ovl__welcome:hover,
.pm-ovl__welcome:focus-visible {
  transform: translateY(-2px);
  border-color: color-mix(in srgb, #e74c3c 45%, var(--lj-surface-border));
  box-shadow: 0 10px 30px rgb(0 0 0 / 0.16);
}

.pm-ovl__welcome-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 60px;
  height: 60px;
  border-radius: 50%;
  background: color-mix(in srgb, #e74c3c 14%, var(--lj-surface-bg));
  color: #e74c3c;
  box-shadow: 0 0 0 6px color-mix(in srgb, #e74c3c 7%, transparent);
}

.pm-ovl__welcome-title {
  font-size: var(--lj-text-md);
  font-weight: var(--lj-weight-semibold);
}

.pm-ovl__welcome-text {
  color: var(--lj-text-muted);
  font-size: var(--lj-text-sm);
  line-height: 1.45;
}

.pm-ovl__welcome-action {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-top: var(--lj-space-1);
  color: #e74c3c;
  font-size: var(--lj-text-xs);
  font-weight: var(--lj-weight-semibold);
  transition: gap 160ms var(--lj-ease);
}

.pm-ovl__welcome:hover .pm-ovl__welcome-action {
  gap: 8px;
}

.pm-ovl__grid,
.pm-ovl__playlist-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--lj-space-2);
  align-content: start;
}

.pm-ovl__video {
  position: relative;
  min-width: 0;
}

.pm-ovl__video :deep(.ov-card-play) {
  display: none;
}

.pm-ovl__video-actions {
  position: absolute;
  top: 6px;
  right: 6px;
  z-index: 2;
  display: flex;
  gap: 2px;
}

.pm-ovl__empty {
  margin: 0;
  padding: var(--lj-space-4);
  color: var(--lj-text-subtle);
  font-size: var(--lj-text-sm);
}

.pm-ovl__empty--error {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--lj-space-2);
}

.pm-ovl__empty--error p {
  margin: 0;
}

.pm-ovl__foot {
  display: flex;
  align-items: center;
  gap: var(--lj-space-2);
  flex-shrink: 0;
  padding: var(--lj-space-2) var(--lj-space-4);
  border-top: 1px solid var(--lj-surface-border);
  color: var(--lj-text-subtle);
  font-size: var(--lj-text-sm);
}

@media (max-width: 900px) {
  .pm-ovl__grid,
  .pm-ovl__playlist-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 640px) {
  .pm-ovl {
    grid-template-columns: 148px minmax(0, 1fr);
  }

  .pm-ovl__grid,
  .pm-ovl__playlist-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
