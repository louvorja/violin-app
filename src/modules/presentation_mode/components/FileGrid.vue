<template>
  <div class="pm-files__grid">
    <LjContextMenu v-for="entry in entries" :key="entry.path" v-bind="menuFor(entry)">
      <div
        class="pm-file"
        :class="{
          'pm-file--selected': entry.path === selectedPath,
          'pm-file--live': entry.path === livePath,
          'pm-file--return': entry.path === returnPath,
          'pm-file--played': !!playedOn(entry),
        }"
        role="button"
        tabindex="0"
        :title="entry.name"
        :aria-current="entry.path === livePath ? 'true' : undefined"
        :data-testid="`pm-file-${entry.name}`"
        @click="emit('select', entry)"
        @dblclick="emit('open', entry)"
        @keydown.enter.self="emit('open', entry)"
      >
        <span class="pm-file__thumb">
          <img v-if="thumbOf(entry)" :src="thumbOf(entry)" alt="" loading="lazy" />
          <LjIcon v-else :icon="iconOf(entry)" :size="22" class="pm-file__icon" />
          <span v-if="durationOf(entry)" class="pm-file__badge">{{ durationOf(entry) }}</span>
          <span
            v-if="playedOn(entry)"
            class="pm-file__series"
            :title="tm('series.played_at', { date: playedOn(entry) })"
          >
            <LjIcon :icon="ICONS.UI.CHECK" :size="10" />
            {{ playedOn(entry) }}
          </span>
          <span v-else-if="entry.name === nextName" class="pm-file__series pm-file__series--next">
            {{ tm("series.next_badge") }}
          </span>
          <span v-if="entry.path === returnPath" class="pm-file__return">
            {{ tm("library.on_return") }}
          </span>
          <span
            v-else-if="cloudOf(entry)"
            class="pm-file__cloud"
            :title="
              cloudOf(entry) === 'cloud' ? tm('cloud.only_cloud') : tm('cloud.downloading_badge')
            "
            :data-testid="`pm-file-cloud-${entry.name}`"
          >
            <LjIcon :icon="ICONS.ACTIONS.CLOUD_DOWNLOAD" :size="11" />
            {{
              cloudOf(entry) === "cloud"
                ? tm("cloud.badge")
                : `${cloud.progress.get(entry.path) ?? 0}%`
            }}
          </span>
          <template v-if="!entry.isDir">
            <LjTooltip :text="entry.path === livePath ? tm('library.stop') : tm('library.play')">
              <button
                type="button"
                class="pm-file__action"
                :aria-label="entry.path === livePath ? tm('library.stop') : tm('library.play')"
                :data-testid="`pm-file-action-${entry.name}`"
                @click.stop="entry.path === livePath ? emit('stop') : emit('play', entry)"
                @dblclick.stop
              >
                <LjIcon
                  :icon="entry.path === livePath ? ICONS.ACTIONS.CLOSE : ICONS.PLAYER.PLAY"
                  :size="26"
                />
              </button>
            </LjTooltip>
            <LjTooltip v-if="!noDetails" :text="tm('library.details')">
              <button
                type="button"
                class="pm-file__info"
                :aria-label="tm('library.details')"
                :data-testid="`pm-file-info-${entry.name}`"
                @click.stop="emit('details', entry)"
                @dblclick.stop
              >
                <LjIcon :icon="ICONS.UI.INFORMATION_OUTLINE" :size="14" />
              </button>
            </LjTooltip>
          </template>
        </span>
        <span class="pm-file__name">{{ entry.name }}</span>
      </div>
    </LjContextMenu>
  </div>
</template>

<script setup lang="ts">
import { watch } from "vue";
import { LjContextMenu, LjIcon, LjTooltip, type LjMenuItem } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { ModuleEnum } from "@/enums/ModuleEnum";
import DateTime from "@/helpers/DateTime";
import Platform from "@/helpers/Platform";
import { useModuleI18n } from "@/composables/useModuleI18n";
import type { ProgramItem } from "@/types/Presentation";
import { fileKind, useFileLibrary, type LibraryEntry } from "../composables/useFileLibrary";
import { useMediaMeta } from "../composables/useMediaMeta";
import { useCloudFiles } from "../composables/useCloudFiles";
import { useMoments } from "../composables/useMoments";
import { fileItem, folderItem } from "../program/items";
import type { PlayOptions } from "../program/playable";

/**
 * A grade de arquivos de uma pasta: miniatura, duração, selos (no ar, no
 * retorno, já passou na série, na nuvem) e o menu de contexto completo. Serve
 * à aba Arquivos e à pasta do programa no palco — os mesmos cartões e as
 * mesmas ações nos dois lugares.
 */

const props = defineProps<{
  entries: LibraryEntry[];
  selectedPath: string | null;
  /** Caminho do arquivo que está no ar, para a borda de destaque e o ✕. */
  livePath: string | null;
  returnPath: string | null;
  /** Data em que passou na série ("24/09"); "" se não passou. */
  playedAt?: (entry: LibraryEntry) => string;
  /** Nome do próximo arquivo da série. */
  nextName?: string | null;
  /** Ações a mais no fim do menu (marcar na série...). */
  extraMenu?: (entry: LibraryEntry) => LjMenuItem[];
  /** Sem o painel de detalhes por perto (palco): some o (i) e o "Detalhes" do menu. */
  noDetails?: boolean;
}>();

const emit = defineEmits<{
  /** Clique: o arquivo vai para a prévia. */
  select: [entry: LibraryEntry];
  /** Duplo clique: entra na pasta ou projeta o arquivo. */
  open: [entry: LibraryEntry];
  play: [entry: LibraryEntry, options?: PlayOptions];
  stop: [];
  details: [entry: LibraryEntry];
  add: [item: ProgramItem];
  /** Imagem ou vídeo só no retorno de palco; `null` tira. */
  "show-on-return": [entry: LibraryEntry | null];
}>();

const { tm } = useModuleI18n(ModuleEnum.PRESENTATION_MODE);
const lib = useFileLibrary();
const { meta, request } = useMediaMeta();
const cloud = useCloudFiles();

const playedOn = (entry: LibraryEntry): string => props.playedAt?.(entry) ?? "";

const KIND_ICON: Record<string, string> = {
  image: ICONS.MEDIA.IMAGE,
  video: ICONS.MEDIA.VIDEO_FILE,
  audio: ICONS.MUSIC.AUDIO,
  pdf: ICONS.UI.FILE_PDF,
  powerpoint: ICONS.PROJECTION.PRESENTATION,
  slja: ICONS.PROJECTION.PRESENT,
};

function iconOf(entry: LibraryEntry): string {
  if (entry.isDir) return ICONS.UI.FOLDER;
  return KIND_ICON[fileKind(entry.ext) ?? ""] ?? ICONS.UI.FILE;
}

function thumbOf(entry: LibraryEntry): string | undefined {
  return entry.isDir ? undefined : meta.get(entry.path)?.thumb;
}

function durationOf(entry: LibraryEntry): string {
  const d = meta.get(entry.path)?.duration;
  return d ? DateTime.shortTime(d) : "";
}

/** "cloud" ou "downloading"; nada para o que já está no computador. */
function cloudOf(entry: LibraryEntry): "cloud" | "downloading" | undefined {
  const state = entry.isDir ? undefined : cloud.stateOf(entry.path);
  return state === "local" ? undefined : state;
}

async function downloadFolder(entry: LibraryEntry): Promise<void> {
  const res = await Platform.listDir(entry.path).catch(() => null);
  const files = res?.ok
    ? (res.entries as LibraryEntry[]).filter((e) => !e.isDir).map((e) => e.path)
    : [];
  void cloud.downloadAll(files, tm("cloud.task", { where: entry.name }));
}

/** O menu de um cartão: as ações mais usadas em cima (ícones grandes), o resto embaixo. */
interface EntryMenu {
  quick: LjMenuItem[];
  items: LjMenuItem[];
}

function menuFor(entry: LibraryEntry): EntryMenu {
  if (entry.isDir) {
    return {
      quick: [
        { label: tm("menu.open"), icon: ICONS.UI.FOLDER_OPEN, action: () => emit("open", entry) },
        {
          label: tm("menu.to_program"),
          icon: ICONS.ACTIONS.ADD,
          action: () => emit("add", folderItem(entry.path, entry.name)),
        },
      ],
      items: [
        {
          label: tm("cloud.download_folder"),
          icon: ICONS.ACTIONS.CLOUD_DOWNLOAD,
          action: () => void downloadFolder(entry),
        },
      ],
    };
  }
  const live = entry.path === props.livePath;
  const kind = fileKind(entry.ext);
  const play: LjMenuItem = live
    ? { label: tm("library.stop"), icon: ICONS.ACTIONS.CLOSE, action: () => emit("stop") }
    : { label: tm("library.play"), icon: ICONS.PLAYER.PLAY, action: () => emit("play", entry) };
  const preview: LjMenuItem = {
    label: tm("library.preview"),
    icon: ICONS.UI.EYE,
    action: () => emit("select", entry),
  };
  // Só na nuvem: baixar é o mais urgente, e vai para cima no lugar da prévia.
  const cloudOnly = cloudOf(entry) === "cloud";
  const quick = cloudOnly
    ? [
        {
          label: tm("menu.download"),
          icon: ICONS.ACTIONS.CLOUD_DOWNLOAD,
          action: () => void cloud.download(entry.path),
        },
        play,
      ]
    : [play, preview];
  return {
    quick,
    items: [
      ...(cloudOnly ? [preview] : []),
      ...(kind === "video" && !live
        ? [
            {
              label: tm("library.play_muted"),
              icon: ICONS.PLAYER.VOLUME_MUTE,
              action: () => emit("play", entry, { muted: true }),
            },
          ]
        : []),
      ...(kind === "image" || kind === "video"
        ? [
            entry.path === props.returnPath
              ? {
                  label: tm("library.remove_from_return"),
                  icon: ICONS.PROJECTION.RETURN,
                  action: () => emit("show-on-return", null),
                }
              : {
                  label: tm("library.play_on_return"),
                  icon: ICONS.PROJECTION.RETURN,
                  action: () => emit("show-on-return", entry),
                },
          ]
        : []),
      { separator: true },
      {
        label: tm("library.add_to_program"),
        icon: ICONS.ACTIONS.ADD,
        action: () => emit("add", fileItem(entry, meta.get(entry.path) ?? null)),
      },
      ...momentMenu(entry),
      { separator: true },
      {
        label: lib.isFavorite(entry) ? tm("library.unfavorite") : tm("library.favorite"),
        icon: lib.isFavorite(entry) ? ICONS.UI.STAR : ICONS.UI.STAR_OUTLINE,
        action: () => lib.toggleFavorite(entry),
      },
      ...(props.noDetails
        ? []
        : [
            {
              label: tm("library.details"),
              icon: ICONS.UI.INFORMATION_OUTLINE,
              action: () => emit("details", entry),
            },
          ]),
      ...(props.extraMenu?.(entry) ?? []),
    ],
  };
}

/* ─── Momentos do programa: destino de fotos, vídeos e PDFs ─── */

const momentTargets = useMoments(tm);

/** "Adicionar ao momento ▸": os momentos ficam no segundo nível — a lista cresce. */
function momentMenu(entry: LibraryEntry): LjMenuItem[] {
  if (entry.isDir || !momentTargets.accepts(entry.path)) return [];
  const title = entry.name.replace(/\.[^.]+$/, "");
  return [
    {
      label: tm("moment.add_to"),
      icon: ICONS.MEDIA.PLAYLIST,
      children: [
        ...momentTargets.moments.value.map((m) => ({
          label: m.title,
          icon: ICONS.MEDIA.PLAYLIST,
          action: () => momentTargets.addTo(m, [entry.path]),
        })),
        ...(momentTargets.moments.value.length ? [{ separator: true }] : []),
        {
          label: tm("moment.new_moment"),
          icon: ICONS.ACTIONS.ADD,
          action: () => emit("add", momentTargets.newMoment([entry.path], title)),
        },
      ],
    },
  ];
}

// Miniaturas e durações da pasta mostrada.
// Antes, o estado da nuvem da pasta inteira numa consulta só: a miniatura não
// abre o arquivo que está só na nuvem (abrir seria baixá-lo).
watch(
  () => props.entries,
  async (entries) => {
    await cloud.refresh(entries.filter((e) => !e.isDir).map((e) => e.path));
    entries.forEach((e) => request(e));
  },
  { immediate: true }
);
// Arquivo que acabou de baixar ganha a miniatura que faltava.
watch(
  () => props.entries.filter((e) => cloud.stateOf(e.path) === "local").length,
  () => props.entries.forEach((e) => request(e))
);
</script>

<style scoped>
.pm-files__grid {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 8px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(132px, 1fr));
  gap: 8px;
  align-content: start;
}

.pm-file {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--lj-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.pm-file__thumb {
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

.pm-file__thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.pm-file__icon {
  color: var(--lj-white-alpha-50);
}

.pm-file:hover .pm-file__thumb {
  border-color: var(--lj-navy-active);
}

.pm-file__action,
.pm-file__info {
  position: absolute;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  color: var(--lj-white);
  cursor: pointer;
  opacity: 0;
  transition:
    opacity 120ms var(--lj-ease),
    background 120ms var(--lj-ease);
}

/* ▶ (ou ✕ no que está no ar) no centro; (i) no canto — só no hover ou no foco. */
.pm-file__action {
  top: 50%;
  left: 50%;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: var(--lj-black-alpha-40);
  transform: translate(-50%, -50%);
}

.pm-file__info {
  top: 4px;
  right: 4px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--lj-black-alpha-40);
}

.pm-file:hover .pm-file__action,
.pm-file:hover .pm-file__info,
.pm-file:focus-within .pm-file__action,
.pm-file:focus-within .pm-file__info {
  opacity: 1;
}

.pm-file__action:hover,
.pm-file__info:hover {
  background: var(--lj-black-alpha-75);
}

.pm-file__action:focus-visible,
.pm-file__info:focus-visible {
  outline: none;
  box-shadow: var(--lj-ui-focus);
}

.pm-file__series {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  position: absolute;
  bottom: 4px;
  left: 4px;
  padding: 0 4px;
  border-radius: 2px;
  background: var(--lj-black-alpha-75);
  color: var(--lj-white);
  font-size: 9.5px;
  font-weight: 700;
}

.pm-file__series--next {
  background: var(--lj-orange);
}

/* Já passou neste ciclo: continua clicável, mas recua para o próximo se destacar. */
.pm-file--played .pm-file__thumb img {
  opacity: 0.45;
}

.pm-file__cloud {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  position: absolute;
  top: 4px;
  left: 4px;
  padding: 0 4px;
  border-radius: 2px;
  background: var(--lj-black-alpha-75);
  color: var(--lj-white);
  font-size: 9px;
  font-weight: 700;
}

.pm-file__return {
  position: absolute;
  top: 4px;
  left: 4px;
  padding: 0 4px;
  border-radius: 2px;
  background: var(--lj-color-cover-gold);
  color: var(--lj-color-projection-bg);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.4px;
}

.pm-file--return .pm-file__thumb {
  border-color: var(--lj-color-cover-gold);
}

.pm-file--live .pm-file__thumb {
  border-color: var(--lj-orange);
  box-shadow: 0 0 0 2px var(--lj-orange);
}

/* Em prévia: azul, como o "próximo" do programa. No ar é laranja (acima). */
.pm-file--selected:not(.pm-file--live) .pm-file__thumb {
  box-shadow: inset 0 0 0 2px var(--lj-navy-active);
  border-color: var(--lj-navy-active);
}

.pm-file:focus-visible {
  outline: none;
}

.pm-file:focus-visible .pm-file__thumb {
  box-shadow: var(--lj-ui-focus);
}

.pm-file__badge {
  position: absolute;
  right: 4px;
  bottom: 4px;
  padding: 0 4px;
  border-radius: 2px;
  background: var(--lj-black-alpha-75);
  color: var(--lj-white);
  font-family: var(--lj-font-mono);
  font-size: 9.5px;
}

.pm-file__name {
  font-size: 10.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
