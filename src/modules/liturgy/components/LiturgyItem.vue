<template>
  <div class="lit-row">
    <div
      class="lit-card"
      :class="{
        'lit-card--checked': checked,
        'lit-card--locked': locked,
      }"
    >
      <!-- Checkbox + Icon -->
      <!-- A cor do item vira o acento do controle: o primitivo não expõe `color`,
           e a variável cascateia para dentro dele sem precisar de :deep(). -->
      <span class="lit-card-check" :style="{ '--lj-ui-accent': itemColor }">
        <LjCheckbox :model-value="checked" @update:model-value="$emit('toggle-checked', element)" />
      </span>

      <LjChip
        variant="primary"
        :icon="ICONS.TIMER.CLOCK"
        class="lit-card-duration"
        :class="{ 'lit-card-icon--checked': checked }"
      >
        {{ props.element.duration }} {{ t("units.min") }}
      </LjChip>
      <Icon
        :icon="$liturgy.iconForItem(element)"
        size="40"
        :color="itemColor"
        class="lit-card-icon"
        :class="{ 'lit-card-icon--checked': checked }"
      />

      <!-- Texto — também é o punho de arraste (data-handle) do vuedraggable -->
      <button class="lit-card-text" data-handle="true" @click="onCardClick">
        <span class="lit-card-title">
          {{ element.item || t("placeholders.untitled") }}
        </span>
        <span v-if="subtitleFor(element)" class="lit-card-subtitle">
          <template v-if="parsedSubtitle(element).icon">
            <Icon :icon="parsedSubtitle(element).icon" :size="14" class="lit-card-sub-icon" />
          </template>
          {{ parsedSubtitle(element).text }}
          <LjChip
            v-if="chip"
            variant="primary"
            :icon="chip.icon"
            class="lit-card-sub-chip"
            :style="chipColorVars(chip.color)"
          >
            {{ t(`inputs.music_version_${chip.action}`) }}
          </LjChip>
          <LjChip
            v-if="linkedOverlay"
            variant="primary"
            size="sm"
            :icon="ICONS.MODULES.OVERLAY"
            class="lit-card-sub-chip"
          >
            {{ linkedOverlay.name }}
          </LjChip>
        </span>
      </button>

      <!-- Ação de vídeo on-line -->
      <div v-if="element.tipo === 'video-online'" class="lit-card-music-actions">
        <LjTooltip :text="t('video.play')" :delay="700">
          <button class="lit-music-btn lit-music-btn--play" @click.stop="$emit('execute', element)">
            <Icon :icon="ICONS.PLAYER.PLAY" :size="SIZE_ICON_MEDIA" />
          </button>
        </LjTooltip>
      </div>

      <!-- Ações: editar + reordenar (sem X — exclusão pelo ribbon "Apagar Selecionados") -->
      <div class="lit-card-end">
        <LjTooltip v-if="!locked" :text="t('actions.edit')" :delay="500">
          <button class="lit-card-action" @click.stop="$emit('edit', index)">
            <Icon :icon="ICONS.ACTIONS.EDIT" :size="SIZE_ICON_TOOLS" />
          </button>
        </LjTooltip>

        <LjTooltip v-if="!locked" :text="t('actions.clone')" :delay="500">
          <button class="lit-card-action" @click.stop="$emit('clone', index)">
            <Icon :icon="ICONS.ACTIONS.COPY" :size="SIZE_ICON_TOOLS" />
          </button>
        </LjTooltip>

        <LjTooltip v-if="!locked" :text="t('actions.delete')" :delay="500">
          <button
            class="lit-card-action lit-card-action--danger"
            @click.stop="$emit('confirm-remove', index)"
          >
            <Icon :icon="ICONS.ACTIONS.DELETE" :size="SIZE_ICON_TOOLS" />
          </button>
        </LjTooltip>
      </div>
    </div>

    <LjDialog v-model="versionPickerOpen" :title="element.item" size="sm">
      <div class="lit-versions">
        <button
          v-for="opt in availableActions"
          :key="opt.action"
          type="button"
          class="lit-version"
          @click="playVersion(opt.action)"
        >
          <Icon :icon="opt.icon" :size="22" :color="opt.color" />
          <span class="lit-version__label">{{ t(opt.labelKey) }}</span>
        </button>
      </div>
    </LjDialog>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, toRef } from "vue";
import { useI18n } from "vue-i18n";
import pt from "../lang/pt.json";
import es from "../lang/es.json";
import type { LiturgyItem } from "@/types/Liturgy";
import type { OverlaySlot } from "@/types/Overlay";
import { ICONS } from "@/config/Icons";
import Icon from "@/components/Icon.vue";
import { LjCheckbox, LjChip, LjDialog, LjTooltip } from "@/components/ui";
import { MUSIC_ACTION, MusicAction } from "@/config/MusicAction";
import { MusicActionEnum } from "@/enums/MusicActionEnum";
import $liturgy from "@/helpers/Liturgy";

interface ActionOption {
  action: string;
  icon: string;
  color: string;
  labelKey: string;
}

const TRANSLATIONS: Record<string, Record<string, unknown>> = { pt, es };
const SIZE_ICON_TOOLS = "16";
const SIZE_ICON_MEDIA = "20";

const versionPickerOpen = ref(false);

const LITURGY_TO_ACTION_KEY: Record<string, string> = {
  audio: "audio-only",
  audio_pb: "playback-only",
};

const chip = computed((): MusicAction | null => {
  if (props.element?.tipo !== "musica" || props.element?.escolha) return null;
  const sub = props.element.subtipo;
  if (!sub) return null;
  const key = LITURGY_TO_ACTION_KEY[sub] || sub;
  return MUSIC_ACTION[key] || null;
});

const linkedOverlay = computed((): OverlaySlot | null => {
  if (!props.element?.linked_overlay_id) return null;
  return props.overlaySlots.find((s) => s.id === props.element.linked_overlay_id) || null;
});

const availableActions = computed((): ActionOption[] => {
  const canPlayback = !!(
    props.element?.id_music ||
    (props.element?.musica && props.element?.musica > 0)
  );
  if (!canPlayback) {
    return [
      {
        action: "sung",
        icon: MUSIC_ACTION.sung?.icon || ICONS.MUSIC.SING,
        color: MUSIC_ACTION.sung?.color || "#c0392b",
        labelKey: "inputs.music_version_sung",
      },
      {
        action: "lyric",
        icon: MUSIC_ACTION.lyric?.icon || ICONS.MUSIC.LYRIC,
        color: MUSIC_ACTION.lyric?.color || "#7f8c8d",
        labelKey: "inputs.music_version_lyric",
      },
    ];
  }

  return [
    {
      action: MUSIC_ACTION[MusicActionEnum.AUDIO].action,
      icon: MUSIC_ACTION[MusicActionEnum.AUDIO].icon || ICONS.MUSIC.SING,
      color: MUSIC_ACTION[MusicActionEnum.AUDIO].color || "#c0392b",
      labelKey: "inputs.music_version_sung",
    },
    {
      action: MUSIC_ACTION[MusicActionEnum.PLAYBACK].action,
      icon: MUSIC_ACTION[MusicActionEnum.PLAYBACK].icon || ICONS.MUSIC.PLAYBACK,
      color: MUSIC_ACTION[MusicActionEnum.PLAYBACK].color || "#1b4f8a",
      labelKey: "inputs.music_version_pb",
    },
    {
      action: MUSIC_ACTION[MusicActionEnum.LYRIC].action,
      icon: MUSIC_ACTION[MusicActionEnum.LYRIC].icon || ICONS.MUSIC.LYRIC,
      color: MUSIC_ACTION[MusicActionEnum.LYRIC].color || "#7f8c8d",
      labelKey: "inputs.music_version_lyric",
    },
    {
      action: MUSIC_ACTION[MusicActionEnum.AUDIO_ONLY].action,
      icon: MUSIC_ACTION[MusicActionEnum.AUDIO_ONLY].icon || ICONS.MUSIC.AUDIO_PLAYBACK,
      color: MUSIC_ACTION[MusicActionEnum.AUDIO_ONLY].color || "#27ae60",
      labelKey: "inputs.music_version_audio-only",
    },
    {
      action: MUSIC_ACTION[MusicActionEnum.PLAYBACK_ONLY].action,
      icon: MUSIC_ACTION[MusicActionEnum.PLAYBACK_ONLY].icon || ICONS.MUSIC.NO_AUDIO,
      color: MUSIC_ACTION[MusicActionEnum.PLAYBACK_ONLY].color || "#8e44ad",
      labelKey: "inputs.music_version_playback-only",
    },
  ];
});

function onCardClick() {
  if (props.element?.tipo === "musica" && !props.element?.escolha) {
    const sub = props.element.subtipo;
    if (sub && sub !== "ja" && sub !== "div" && sub !== "") {
      emit("play-music", props.element, sub);
    } else {
      versionPickerOpen.value = true;
    }
  } else {
    emit("execute", props.element);
  }
}

function playVersion(action: string) {
  versionPickerOpen.value = false;
  emit("play-music", props.element, action);
}

function _t(key: string, locale: string): string {
  const dict = TRANSLATIONS[locale] ?? TRANSLATIONS.pt;
  const path = key.split(".");
  let cur: unknown = dict;
  for (const k of path) {
    if (cur && typeof cur === "object" && k in cur) cur = (cur as Record<string, unknown>)[k];
    else return key;
  }
  return typeof cur === "string" ? cur : key;
}

const props = withDefaults(
  defineProps<{
    element: LiturgyItem;
    index: number;
    locked?: boolean;
    defaultColor?: string;
    hideCheckbox?: boolean;
    checked?: boolean;
    subtitleFor: (item: LiturgyItem) => string;
    overlaySlots?: OverlaySlot[];
  }>(),
  { locked: false, defaultColor: "#00004F", hideCheckbox: false, overlaySlots: () => [] }
);
const element = toRef(props, "element");

/** Cor do item — usada no ícone e como acento da caixa de seleção. */
const itemColor = computed(() => props.element.cor || props.defaultColor);

/**
 * A cor de uma versão de música é um dado (vem de `MUSIC_ACTION`), não um token.
 * Ela entra no chip pelas variáveis de acento do primitivo, preservando o
 * contrato visual: fundo tonal + texto na cor.
 */
function chipColorVars(color: string): Record<string, string> {
  return {
    "--lj-ui-accent-soft": `color-mix(in srgb, ${color} 15%, transparent)`,
    "--lj-ui-accent-text": color,
  };
}

/** Parse o subitem: se contém "|||", separa icon path do texto. */
function parsedSubtitle(item: LiturgyItem): { icon: string; text: string } {
  const sub = props.subtitleFor(item) || "";
  const idx = sub.indexOf("|||");
  if (idx >= 0) {
    return { icon: sub.slice(0, idx), text: sub.slice(idx + 3) };
  }
  return { icon: "", text: sub };
}

const emit = defineEmits<{
  edit: [index: number];
  clone: [index: number];
  "confirm-remove": [index: number];
  execute: [item: LiturgyItem];
  "play-music": [item: LiturgyItem, mode: string];
  "open-lyric": [musica: number];
  "change-color": [index: number];
  "toggle-checked": [element: LiturgyItem];
}>();

const { locale } = useI18n();
const t = (key: string) => _t(key, locale.value);
</script>

<style scoped>
.lit-row {
  display: flex;
  width: 100%;
}

/* ====================== Card item normal ====================== */
.lit-card {
  display: flex;
  align-items: center;
  flex: 1;
  background: var(--lj-surface-bg);
  border-radius: 10px;
  box-shadow: var(--lj-shadow-2);
  min-height: 50px;
  transition:
    background 0.15s,
    border-color 0.15s;
  overflow: hidden;
  position: relative;
}
.lit-card:hover {
  background: rgb(var(--lj-navy-ch) / 10%);
}
.lit-card--checked {
  border-color: rgb(var(--lj-navy-ch) / 60%);
  background: rgb(var(--lj-navy-ch) / 20%);
}

.lit-card--locked {
  border-left: 3px solid rgba(var(--lj-navy-ch), 0.3);
}

.lit-card-text {
  flex: 1;
  text-align: left;
  background: transparent;
  border: none;
  padding: 6px 12px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-width: 0;
}

.lit-card-check {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  padding: 0 2px 0 8px;
}
.lit-card-duration {
  margin-left: var(--lj-space-4);
}
.lit-card-icon {
  flex-shrink: 0;
  margin-right: 4px;
  margin-left: 10px;
}
.lit-card-icon--checked {
  text-decoration: line-through;
  opacity: 0.6;
}
.lit-card-title {
  font-weight: 600;
  font-size: 14px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.lit-card--checked .lit-card-title {
  text-decoration: line-through;
  opacity: 0.6;
}

.lit-card-subtitle {
  font-size: 11px;
  color: rgba(var(--lj-on-surface-ch), 0.6);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-top: 2px;
}

.lit-card-sub-icon {
  margin-right: var(--lj-space-2);
}

.lit-card-sub-chip {
  margin-left: var(--lj-space-4);
  vertical-align: middle;
}

.lit-card--checked .lit-card-subtitle {
  text-decoration: line-through;
}

.lit-card-music-actions {
  display: flex;
  align-items: center;
  gap: 1px;
  padding: 0 6px;
  border-left: 1px solid var(--lj-surface-border);
}
.lit-music-btn {
  width: 30px;
  height: 30px;
  border: none;
  background: transparent;
  border-radius: 3px;
  cursor: pointer;
  color: rgba(var(--lj-on-surface-ch), 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
}
.lit-music-btn:hover {
  background: rgba(var(--lj-navy-ch), 0.12);
}
.lit-music-btn--play,
.lit-music-btn--play:hover {
  color: var(--lj-danger);
}

.lit-card-end {
  display: flex;
  align-items: center;
  border-left: 1px solid var(--lj-surface-border);
  padding: 0 4px;
  gap: 2px;
}

.lit-card-grip,
.lit-card-action {
  background: transparent;
  border: none;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 3px;
  color: rgba(var(--lj-on-surface-ch), 0.6);
  padding: 0;
  user-select: none;
  flex-shrink: 0;
}
.lit-card-grip {
  cursor: grab;
}
.lit-card-grip:active {
  cursor: grabbing;
}
.lit-card-action:hover {
  background: rgba(var(--lj-on-surface-ch), 0.08);
  color: var(--lj-text);
}
.lit-card-action--danger,
.lit-card-action--danger:hover {
  color: var(--lj-danger);
}

.lit-category .lit-card-action {
  color: var(--lj-text-on-navy);
}
.lit-category .lit-card-action:hover {
  background: var(--lj-black-alpha-20);
}
</style>

<!-- Sem `scoped`: o corpo do diálogo é emitido num portal no <body> e o Vue não
     propaga o atributo de escopo para lá — regras scoped não casariam. O
     isolamento vem do prefixo `lit-`. -->
<style>
.lit-versions {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-2);
}

.lit-version {
  display: flex;
  align-items: center;
  gap: var(--lj-space-5);
  width: 100%;
  padding: var(--lj-space-4) var(--lj-space-5);
  background: transparent;
  border: none;
  border-radius: var(--lj-ui-radius);
  color: var(--lj-text);
  font-family: var(--lj-font-shell);
  font-size: var(--lj-text-base);
  text-align: left;
  cursor: pointer;
}
.lit-version:hover {
  background: var(--lj-surface-bg-hover);
}
.lit-version:focus-visible {
  outline: none;
  box-shadow: var(--lj-ui-focus);
}
</style>
