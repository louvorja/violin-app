<template>
  <LjDialog
    :model-value="Boolean(module.show)"
    :title="t('title')"
    :accessible-title="albumName"
    allow-global-hotkeys
    size="lg"
    @update:model-value="onDialogChange"
  >
    <div class="album-detail">
      <div class="album-summary">
        <div class="album-cover" aria-hidden="true">
          <img v-if="coverUrl && !coverFailed" :src="coverUrl" alt="" @error="coverFailed = true" />
          <LjIcon v-else :icon="ICONS.MUSIC.ALBUM" :size="34" />
        </div>
        <div class="album-summary__copy">
          <h2 class="album-summary__name">{{ albumName }}</h2>
          <p v-if="!loading" class="album-summary__count">{{ trackCountLabel }}</p>
        </div>
      </div>

      <div v-if="!loading && tracks.length && canDownload" class="album-download">
        <p class="album-download__hint">{{ t("download_hint") }}</p>
        <LjButton size="sm" :icon="ICONS.ACTIONS.DOWNLOAD" @click="goDownload">
          {{ t("download") }}
        </LjButton>
      </div>

      <LjProgress v-if="loading" indeterminate :label="t('loading')" />
      <LjEmpty v-else-if="!tracks.length" :icon="ICONS.MUSIC.NOTE" :title="t('empty')" />
      <LjTable
        v-else
        sticky
        hover
        class="album-tracks"
        max-height="min(52vh, 520px)"
        :aria-label="t('tracks_region')"
      >
        <colgroup>
          <col class="album-col-track" />
          <col />
          <col class="album-col-duration" />
          <col class="album-col-actions" />
        </colgroup>
        <thead>
          <tr>
            <th scope="col" class="album-track-number">{{ t("table.track") }}</th>
            <th scope="col">{{ t("table.music_name") }}</th>
            <th scope="col" class="album-duration">{{ t("table.duration") }}</th>
            <th scope="col" class="album-actions-heading">
              <span class="album-visually-hidden">{{ t("table.actions") }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in tracks" :key="item.id_music">
            <td class="album-track-number">{{ item.track ?? "" }}</td>
            <td>
              <span class="album-track-name">{{ item.name }}</span>
            </td>
            <td class="album-duration">{{ $datetime.shortTime(item.duration) }}</td>
            <td>
              <div class="album-actions">
                <MusicMenuTable
                  :id_music="Number(item.id_music)"
                  :name="item.name"
                  :has_instrumental_music="!!item.has_instrumental_music"
                  :compact-breakpoint="760"
                  defer-quick-actions
                />
              </div>
            </td>
          </tr>
        </tbody>
      </LjTable>
    </div>
  </LjDialog>
</template>

<script setup>
import { computed, ref, watch } from "vue";
import { module as manifest } from "../manifest";
import { useModule } from "@/composables/useModule";
import { useAlbum } from "@/composables/useAlbum";
import { LjButton, LjDialog, LjEmpty, LjIcon, LjProgress, LjTable } from "@/components/ui";
import Platform from "@/helpers/Platform";
import { requestAlbumDownload } from "@/helpers/SyncIntent";
import { ICONS } from "@/config/Icons";
import MusicMenuTable from "@/components/MusicMenuTable.vue";
import { useDisabledAlbums } from "@/composables/useMusicCatalog";
import { isAlbumEnabled } from "@root/config/musicCatalog.mjs";

const { module, t, $path, $datetime } = useModule(manifest);
const { loading, close: closeAlbum } = useAlbum();
const album = computed(() => module.value?.data ?? {});
const albumName = computed(() =>
  typeof album.value.name === "string" && album.value.name.trim() ? album.value.name : t("title")
);
const tracks = computed(() =>
  Array.isArray(album.value.musics)
    ? album.value.musics.filter(
        (item) =>
          item &&
          typeof item === "object" &&
          typeof item.name === "string" &&
          Number.isInteger(Number(item.id_music)) &&
          Number(item.id_music) > 0
      )
    : []
);
const trackCountLabel = computed(
  () => `${tracks.value.length} ${t(tracks.value.length === 1 ? "track_one" : "track_many")}`
);
const coverUrl = computed(() => {
  if (typeof album.value.url_image !== "string" || !album.value.url_image.trim()) return "";
  try {
    return $path.file(album.value.url_image);
  } catch {
    return "";
  }
});
const coverFailed = ref(false);
watch(coverUrl, () => {
  coverFailed.value = false;
});

// Download é centralizado em Opções → Sincronizar; aqui só leva o álbum até lá.
const canDownload = computed(() => Boolean(Platform.download && Platform.storage?.checkLocal));

function goDownload() {
  const id = album.value.id_album;
  closeAlbum();
  requestAlbumDownload(id);
}

function onDialogChange(open) {
  if (!open) closeAlbum();
}

const disabledAlbums = useDisabledAlbums();
watch(disabledAlbums, (disabled) => {
  if (album.value.id_album && !isAlbumEnabled(album.value.id_album, disabled)) closeAlbum();
});
</script>

<style scoped>
.album-detail {
  min-width: 0;
}

.album-summary {
  display: flex;
  align-items: center;
  gap: var(--lj-space-6);
  min-width: 0;
  margin-bottom: var(--lj-space-6);
}

.album-cover {
  display: grid;
  flex: 0 0 96px;
  width: 96px;
  height: 96px;
  place-items: center;
  overflow: hidden;
  border: 1px solid var(--lj-surface-border);
  border-radius: var(--lj-radius-md);
  background: var(--lj-surface-bg-soft);
  color: var(--lj-text-muted);
}

.album-cover img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.album-summary__copy {
  min-width: 0;
}

.album-summary__name {
  margin: 0;
  color: var(--lj-text);
  font-size: var(--lj-text-2xl);
  font-weight: var(--lj-weight-semibold);
  line-height: 1.25;
  overflow-wrap: anywhere;
}

.album-summary__count {
  margin: var(--lj-space-3) 0 0;
  color: var(--lj-text-muted);
  font-size: var(--lj-text-base);
}

.album-download {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--lj-space-4);
  margin-bottom: var(--lj-space-6);
  padding: var(--lj-space-4) var(--lj-space-5);
  border: 1px solid var(--lj-surface-border);
  border-radius: var(--lj-radius-md);
  background: var(--lj-surface-bg-soft);
}

.album-download__hint {
  flex: 1 1 200px;
  margin: 0;
  color: var(--lj-text-muted);
  font-size: var(--lj-text-sm);
}

.album-tracks {
  --album-actions-width: 260px;
}

.album-tracks :deep(.lj-table__table) {
  table-layout: fixed;
}

.album-col-track {
  width: 62px;
}

.album-col-duration {
  width: 82px;
}

.album-col-actions {
  width: var(--album-actions-width);
}

.album-track-number,
.album-duration {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.album-duration {
  white-space: nowrap;
}

.album-track-name {
  line-height: 1.35;
  overflow-wrap: anywhere;
}

.album-actions {
  display: flex;
  justify-content: flex-end;
}

.album-visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

@media (max-width: 760px) {
  .album-tracks {
    --album-actions-width: 44px;
  }
}

@media (max-width: 520px) {
  .album-summary {
    gap: var(--lj-space-5);
  }

  .album-cover {
    flex-basis: 72px;
    width: 72px;
    height: 72px;
  }

  .album-summary__name {
    font-size: var(--lj-text-xl);
  }

  .album-col-track {
    width: 46px;
  }

  .album-col-duration {
    width: 66px;
  }
}
</style>
