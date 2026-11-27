<template>
  <div class="lit-row">
    <div
      class="lit-card"
      :class="{
        'lit-card--checked': checked,
        'lit-card--locked': locked,
      }"
      :style="{ '--item-color': itemColor }"
    >
      <span
        v-if="!locked"
        class="lit-card-grip"
        data-handle="true"
        :title="t('actions.drag')"
        aria-hidden="true"
      >
        <LjIcon :icon="ICONS.ACTIONS.DRAG" :size="14" />
      </span>

      <!-- Checkbox usa o acento do tema para garantir contraste nos temas claro e escuro. -->
      <span class="lit-card-check">
        <LjCheckbox
          :model-value="checked"
          :aria-label="t('actions.mark_done')"
          @update:model-value="$emit('toggle-checked', element)"
        />
      </span>

      <span
        class="lit-card-badge"
        :class="{ 'lit-card-icon--checked': checked }"
        aria-hidden="true"
      >
        <LjIcon :icon="$liturgy.iconForItem(element)" :size="20" class="lit-card-icon" />
      </span>

      <!-- Texto — também é o punho de arraste (data-handle) do vuedraggable -->
      <button type="button" class="lit-card-text" data-handle="true" @click="onCardClick">
        <span class="lit-card-title">
          {{ element.item || t("placeholders.untitled") }}
        </span>
        <span v-if="subtitleParsed.text || chip || linkedOverlay" class="lit-card-meta">
          <span v-if="subtitleParsed.text" class="lit-card-subtitle">
            <LjIcon
              v-if="subtitleParsed.icon"
              :icon="subtitleParsed.icon"
              :size="13"
              class="lit-card-sub-icon"
            />
            <span class="lit-card-subtitle-text">{{ subtitleParsed.text }}</span>
          </span>
          <span v-if="chip || linkedOverlay" class="lit-card-chips">
            <LjChip
              v-if="chip"
              variant="primary"
              size="sm"
              :icon="chip.icon"
              class="lit-card-sub-chip lit-card-sub-chip--colored"
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
        </span>
      </button>

      <LjChip
        v-if="Number(element.duration) > 0"
        variant="neutral"
        size="sm"
        :icon="ICONS.TIMER.CLOCK"
        class="lit-card-duration"
        :class="{ 'lit-card-icon--checked': checked }"
      >
        {{ element.duration }} {{ t("units.min") }}
      </LjChip>

      <!-- Ações desktop: editar + duplicar + excluir -->
      <div v-if="!locked" class="lit-card-end lit-card-end--desktop">
        <LjTooltip :text="t('actions.edit')" :delay="500">
          <LjButton
            size="sm"
            variant="ghost"
            icon-only
            :icon="ICONS.ACTIONS.EDIT"
            :aria-label="t('actions.edit')"
            @click.stop="$emit('edit', index)"
          />
        </LjTooltip>

        <LjTooltip :text="t('actions.clone')" :delay="500">
          <LjButton
            size="sm"
            variant="ghost"
            icon-only
            :icon="ICONS.ACTIONS.COPY"
            :aria-label="t('actions.clone')"
            @click.stop="$emit('clone', index)"
          />
        </LjTooltip>

        <LjTooltip :text="t('actions.delete')" :delay="500">
          <LjButton
            size="sm"
            variant="ghost"
            icon-only
            class="lit-card-action--danger"
            :icon="ICONS.ACTIONS.DELETE"
            :aria-label="t('actions.delete')"
            @click.stop="$emit('confirm-remove', index)"
          />
        </LjTooltip>
      </div>

      <!-- Ações mobile: menu compacto com alvo de toque 44px -->
      <div v-if="!locked" class="lit-card-end lit-card-end--mobile">
        <LjMenu :items="mobileMenuItems" align="end" lazy-content>
          <template #trigger>
            <LjButton
              variant="ghost"
              icon-only
              class="lit-card-mobile-menu"
              :icon="ICONS.UI.DOTS_VERTICAL"
              :aria-label="t('actions.more')"
              @click.stop
            />
          </template>
        </LjMenu>
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
          <LjIcon :icon="opt.icon" :size="22" :color="opt.color" />
          <span class="lit-version__label">{{ t(opt.labelKey) }}</span>
        </button>
      </div>
    </LjDialog>
  </div>
</template>

<script setup lang="ts">
import { useLiturgyI18n } from "../i18n";
import { computed, ref, toRef } from "vue";
import type { LiturgyItem } from "@/types/Liturgy";
import type { OverlaySlot } from "@/types/Overlay";
import { ICONS } from "@/config/Icons";
import {
  LjButton,
  LjCheckbox,
  LjChip,
  LjDialog,
  LjIcon,
  LjMenu,
  LjTooltip,
  type LjMenuItem,
} from "@/components/ui";
import { MUSIC_ACTION, MusicAction } from "@/config/MusicAction";
import { MusicActionEnum } from "@/enums/MusicActionEnum";
import $liturgy from "@/helpers/Liturgy";
import { canLinkOverlay } from "../overlayLink";
import { parseSubitem } from "../agenda";
import { LiturgyItemTypeEnum } from "@/enums/LiturgyItemTypeEnum";
import Platform from "@/helpers/Platform";
import $userdata from "@/helpers/UserData";
import { KEYS } from "@/constants/UserDataKeys";

interface ActionOption {
  action: string;
  icon: string;
  color: string;
  labelKey: string;
}

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
  const scheduled =
    props.element.tipo === LiturgyItemTypeEnum.ITENS_AGENDADOS
      ? $liturgy.findScheduledForToday(
          props.element.ref_id || props.element.id,
          $liturgy.getActiveDate()
        )
      : null;
  if (
    !canLinkOverlay(props.element, {
      scheduledPath: typeof scheduled?.arquivo === "string" ? scheduled.arquivo : "",
      systemMediaPlayer:
        Platform.isDesktop &&
        $userdata.get<boolean>(KEYS.OPTIONS.USE_SYSTEM_MEDIA_PLAYER, false) === true,
    })
  )
    return null;
  return props.overlaySlots.find((s) => s.id === props.element.linked_overlay_id) || null;
});

const availableActions = computed((): ActionOption[] => {
  const hasMusicRef = !!(
    props.element?.id_music ||
    (props.element?.musica && props.element?.musica !== -1 && props.element?.musica !== 0)
  );
  if (!hasMusicRef) {
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

  // `action` é a versão da liturgia que o `playMusic` entende, não a ação do player:
  // aqui "audio" é "Somente áudio", e a cantada é "sung".
  const hasInstrumental = props.element?.has_instrumental_music !== false;
  const options: ActionOption[] = [
    {
      action: "sung",
      icon: MUSIC_ACTION[MusicActionEnum.AUDIO].icon || ICONS.MUSIC.SING,
      color: MUSIC_ACTION[MusicActionEnum.AUDIO].color || "#c0392b",
      labelKey: "inputs.music_version_sung",
    },
  ];
  if (hasInstrumental) {
    options.push({
      action: "pb",
      icon: MUSIC_ACTION[MusicActionEnum.PLAYBACK].icon || ICONS.MUSIC.PLAYBACK,
      color: MUSIC_ACTION[MusicActionEnum.PLAYBACK].color || "#1b4f8a",
      labelKey: "inputs.music_version_pb",
    });
  }
  options.push(
    {
      action: "lyric",
      icon: MUSIC_ACTION[MusicActionEnum.LYRIC].icon || ICONS.MUSIC.LYRIC,
      color: MUSIC_ACTION[MusicActionEnum.LYRIC].color || "#7f8c8d",
      labelKey: "inputs.music_version_lyric",
    },
    {
      action: "audio",
      icon: MUSIC_ACTION[MusicActionEnum.AUDIO_ONLY].icon || ICONS.MUSIC.AUDIO_PLAYBACK,
      color: MUSIC_ACTION[MusicActionEnum.AUDIO_ONLY].color || "#27ae60",
      labelKey: "inputs.music_version_audio-only",
    }
  );
  if (hasInstrumental) {
    options.push({
      action: "audio_pb",
      icon: MUSIC_ACTION[MusicActionEnum.PLAYBACK_ONLY].icon || ICONS.MUSIC.NO_AUDIO,
      color: MUSIC_ACTION[MusicActionEnum.PLAYBACK_ONLY].color || "#8e44ad",
      labelKey: "inputs.music_version_playback-only",
    });
  }
  return options;
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

const props = withDefaults(
  defineProps<{
    element: LiturgyItem;
    index: number;
    locked?: boolean;
    defaultColor?: string;
    checked?: boolean;
    subtitleFor: (item: LiturgyItem) => string;
    overlaySlots?: OverlaySlot[];
  }>(),
  { locked: false, defaultColor: "#00004F", overlaySlots: () => [] }
);
const element = toRef(props, "element");

/** Cor do item — usada no emblema do ícone. */
const itemColor = computed(() => props.element.cor || props.defaultColor);

const subtitleParsed = computed(() => parseSubitem(props.subtitleFor(props.element)));

const mobileMenuItems = computed<LjMenuItem[]>(() => [
  {
    label: t("actions.edit"),
    icon: ICONS.ACTIONS.EDIT,
    action: () => emit("edit", props.index),
  },
  {
    label: t("actions.clone"),
    icon: ICONS.ACTIONS.COPY,
    action: () => emit("clone", props.index),
  },
  { separator: true },
  {
    label: t("actions.delete"),
    icon: ICONS.ACTIONS.DELETE,
    action: () => emit("confirm-remove", props.index),
  },
]);

/**
 * A cor de uma versão de música é um dado (vem de `MUSIC_ACTION`), não um token.
 * Ela entra no chip pelas variáveis de acento do primitivo, preservando o
 * contrato visual: fundo tonal + texto na cor.
 */
function chipColorVars(color: string): Record<string, string> {
  return {
    "--chip-color": color,
    "--lj-ui-accent-soft": `color-mix(in oklab, ${color} 15%, transparent)`,
    "--lj-ui-accent-text": color,
  };
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

const { t } = useLiturgyI18n();
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
  gap: var(--lj-space-3);
  flex: 1;
  min-width: 0;
  background: var(--lj-surface-bg);
  border-radius: var(--lj-radius-lg);
  box-shadow: var(--lj-shadow-1);
  min-height: 48px;
  padding: 0 var(--lj-space-2) 0 var(--lj-space-3);
  border: 1px solid var(--lj-surface-border);
  transition:
    background-color var(--lj-transition-fast),
    border-color var(--lj-transition-fast),
    box-shadow var(--lj-transition-fast);
  overflow: hidden;
  position: relative;
}

.lit-card:hover {
  background: var(--lj-surface-bg-hover);
  border-color: var(--lj-surface-border-strong);
}

.lit-card--checked {
  background: var(--lj-ui-accent-soft);
  border-color: color-mix(in oklab, var(--lj-ui-accent) 25%, var(--lj-surface-border));
}

.lit-card-grip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--lj-text-subtle);
  cursor: grab;
  opacity: 0.45;
  flex-shrink: 0;
  padding: var(--lj-space-1) 0;
  transition: opacity var(--lj-transition-fast);
}

.lit-card:hover .lit-card-grip {
  opacity: 0.9;
}

.lit-card-grip:active {
  cursor: grabbing;
}

.lit-card-check {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
}

.lit-card-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: var(--lj-radius-md);
  background: color-mix(in oklab, var(--item-color) 11%, transparent);
  color: var(--item-color);
  flex-shrink: 0;
}

.lit-card-icon--checked {
  opacity: 0.55;
}

.lit-card-text {
  flex: 1;
  text-align: left;
  background: transparent;
  border: none;
  padding: var(--lj-space-3) var(--lj-space-2);
  cursor: pointer;
  touch-action: pan-y;
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-width: 0;
  color: var(--lj-text);
  font-family: inherit;
}

.lit-card-title {
  font-weight: var(--lj-weight-semibold);
  font-size: var(--lj-text-lg);
  line-height: 1.3;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.lit-card--checked .lit-card-title {
  text-decoration: line-through;
  opacity: 0.6;
}

.lit-card-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--lj-space-2) var(--lj-space-3);
  margin-top: var(--lj-space-1);
  min-width: 0;
}

.lit-card-subtitle {
  display: inline-flex;
  align-items: center;
  gap: var(--lj-space-2);
  min-width: 0;
  max-width: 100%;
  font-size: var(--lj-text-sm);
  color: var(--lj-text-muted);
}

.lit-card-subtitle-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lit-card-sub-icon {
  flex-shrink: 0;
}

.lit-card-chips {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--lj-space-2);
  flex-shrink: 0;
}

.lit-card--checked .lit-card-subtitle {
  text-decoration: line-through;
  opacity: 0.7;
}

.lit-card-duration {
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}

.lit-card-end {
  display: flex;
  align-items: center;
  gap: var(--lj-space-1);
  flex-shrink: 0;
}

.lit-card-end--desktop {
  opacity: 0.45;
  transition: opacity var(--lj-transition-fast);
}

.lit-card:hover .lit-card-end--desktop,
.lit-card:focus-within .lit-card-end--desktop {
  opacity: 1;
}

@media (hover: none) {
  .lit-card-end--desktop {
    opacity: 1;
  }
}

.lit-card-end--mobile {
  display: none;
}

.lit-card-text:focus-visible {
  outline: none;
  box-shadow: inset var(--lj-ui-focus);
}

@media (forced-colors: active) {
  .lit-card-text:focus-visible {
    outline: 2px solid Highlight;
    outline-offset: -2px;
  }
}

.lit-card-end .lit-card-action--danger:hover,
.lit-card-end .lit-card-action--danger:focus-visible {
  background: var(--lj-danger-soft);
  color: var(--lj-danger);
}

@media (max-width: 600px) {
  .lit-card {
    gap: var(--lj-space-2);
    padding-left: var(--lj-space-3);
  }

  .lit-card-grip,
  .lit-card-end--desktop {
    display: none;
  }

  .lit-card-end--mobile {
    display: flex;
    border-left: 0;
    padding: 0 var(--lj-space-1);
  }

  .lit-card-mobile-menu {
    min-width: 44px;
    min-height: 44px;
  }

  .lit-card-badge {
    width: 30px;
    height: 30px;
  }

  .lit-card-duration {
    display: none;
  }
}
</style>

<!-- Sem `scoped`: regras do tema escuro e corpo do diálogo (portal no <body>).
     O Vue SFC não preserva seletores após `:global([data-theme="dark"])` dentro de
     `<style scoped>`, então o tema escuro fica aqui com o prefixo `lit-`. -->
<style>
html[data-theme="dark"] .lit-card-badge {
  background: color-mix(in oklab, var(--item-color) 24%, var(--lj-surface-bg-active));
  color: color-mix(in oklab, var(--item-color) 42%, var(--lj-white));
}

html[data-theme="dark"] .lit-card-sub-chip--colored {
  --lj-ui-accent-soft: color-mix(in oklab, var(--chip-color) 24%, var(--lj-surface-bg-active));
  --lj-ui-accent-text: color-mix(in oklab, var(--chip-color) 45%, var(--lj-white));
}

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
  transition: background-color var(--lj-transition-fast);
}
.lit-version:hover {
  background: var(--lj-surface-bg-hover);
}
.lit-version:focus-visible {
  outline: none;
  box-shadow: var(--lj-ui-focus);
}
</style>
