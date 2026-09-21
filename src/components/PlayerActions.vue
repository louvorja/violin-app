<template>
  <div class="player-actions">
    <!-- Modo de reprodução (cantada / instrumental / sem áudio / letra) -->
    <LjMenu
      v-if="location !== 'fullscreen' && viewport.width.value > 350"
      :items="modeItems"
      side="bottom"
      align="end"
    >
      <template #trigger>
        <LjButton
          size="md"
          variant="ghost"
          icon-only
          :icon="mode.tray_icon"
          :style="modeStyle"
          :aria-label="$t('shell.player.mode')"
        />
      </template>
    </LjMenu>

    <!-- Índice do slide atual: atalho para saltar direto a outro slide -->
    <LjMenu v-if="minimized && !compact" :items="slideItems" side="bottom" align="end">
      <template #trigger>
        <button
          type="button"
          class="lj-ui-control lj-ui-size-sm pa-index"
          :aria-label="$t('shell.player.go_to_slide')"
        >
          {{ slideIndex + 1 }}
        </button>
      </template>
    </LjMenu>

    <LjButton
      v-if="minimized"
      size="md"
      variant="ghost"
      icon-only
      :icon="ICONS.UI.OPEN_IN_APP"
      :aria-label="$t('shell.player.maximize')"
      @click="emit('maximize')"
    />
    <LjButton
      v-if="location === 'fullscreen'"
      size="md"
      variant="ghost"
      icon-only
      :icon="ICONS.PLAYER.FULLSCREEN_EXIT"
      :aria-label="$t('shell.player.fullscreen_exit')"
      @click="emit('fullscreen', false)"
    />
    <LjButton
      v-else-if="location === 'window'"
      size="md"
      variant="ghost"
      icon-only
      :icon="ICONS.PLAYER.FULLSCREEN"
      :aria-label="$t('shell.player.fullscreen')"
      @click="emit('fullscreen', true)"
    />
    <LScreenBtn v-if="location !== 'fullscreen'" :media="mediaOnAir" />

    <!-- Atalhos para abrir as janelas auxiliares (replica fmMusica + fmMusicaRetorno + fmMusicaOperador do Delphi) -->
    <LjMenu v-if="location !== 'fullscreen'" :items="projectionItems" side="bottom" align="end">
      <template #trigger>
        <LjButton
          size="md"
          variant="ghost"
          icon-only
          :icon="ICONS.UI.MONITORS"
          :title="$t('shell.proj_windows')"
          :aria-label="$t('shell.proj_windows')"
        />
      </template>
    </LjMenu>

    <LjMenu
      v-if="location !== 'fullscreen' && compact"
      :items="compactItems"
      side="bottom"
      align="end"
    >
      <template #trigger>
        <LjButton
          size="md"
          variant="ghost"
          icon-only
          :icon="ICONS.UI.MENU"
          :aria-label="$t('shell.player.more_actions')"
        />
      </template>
    </LjMenu>

    <LjButton
      v-if="minimized"
      size="md"
      variant="ghost"
      icon-only
      :icon="ICONS.ACTIONS.CLOSE"
      :aria-label="$t('shell.player.close')"
      @click="emit('close')"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useViewport } from "@/composables/useViewport";
import LScreenBtn from "@/components/buttons/Screen.vue";
import { LjButton, LjMenu, type LjMenuItem } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import {
  currentMediaKind,
  openMediaWindow,
  type MediaKind,
  type WindowKind,
} from "@/helpers/ProjectionWindows";
import type { MenuMode, PlayerButton, Slide } from "@/composables/usePlayerState";

const props = withDefaults(
  defineProps<{
    location?: string;
    minimized?: boolean;
    compact?: boolean;
    loading?: boolean;
    slideIndex?: number;
    mode?: MenuMode;
    menuModes?: MenuMode[];
    slides?: Slide[];
    compactButtons?: PlayerButton[];
  }>(),
  {
    location: "",
    minimized: false,
    compact: false,
    loading: false,
    slideIndex: 0,
    mode: () => ({ title: "" }),
    menuModes: () => [],
    slides: () => [],
    compactButtons: () => [],
  }
);

const emit = defineEmits<{
  "go-to-slide": [index: number];
  maximize: [];
  fullscreen: [value: boolean];
  close: [];
}>();

const { t } = useI18n();
const viewport = useViewport();

/**
 * `menu_modes` carrega a cor no vocabulário do Vuetify (info/success/error).
 * Aqui ela vira token: o botão fica sobre o chrome escuro do player, então usa
 * as variantes claras das cores funcionais.
 */
const MODE_COLOR: Record<string, string> = {
  info: "var(--lj-info-light)",
  success: "var(--lj-success)",
  error: "var(--lj-danger-light)",
};

const modeStyle = computed(() => {
  const color = MODE_COLOR[props.mode?.color ?? ""];
  return color ? { color } : undefined;
});

/** Separador do menu chega como um item de título "-". */
function isSeparator(item: MenuMode): boolean {
  return item.title === "-";
}

function modeItem(item: MenuMode): LjMenuItem {
  return {
    label: item.title,
    icon: item.icon,
    // `active` é undefined no item de letra: sem marca de seleção, item comum.
    checked: item.active,
    disabled: item.disabled,
    action: item.click,
  };
}

const modeItems = computed<LjMenuItem[]>(() =>
  props.menuModes.map((item) => (isSeparator(item) ? { separator: true } : modeItem(item)))
);

/** A letra do slide vem como HTML; no menu ela precisa ser texto puro. */
function slideLabel(slide: Slide): string {
  return String(slide.lyric ?? "")
    .replace(/<br\s*\/?>/gi, " / ")
    .replace(/<[^>]*>/g, "")
    .trim();
}

const slideItems = computed<LjMenuItem[]>(() =>
  props.slides.map((slide, index) => ({
    label: slideLabel(slide),
    shortcut: String(index + 1),
    checked: index === props.slideIndex,
    action: () => emit("go-to-slide", index),
  }))
);

/** O que o player tem no ar. As janelas de música não tocam arquivo nem vídeo, então cada mídia abre as suas. */
const mediaOnAir = computed<MediaKind>(() => currentMediaKind());

/** Mesma função da abertura automática ao dar play: a janela que abre é a mesma. */
function openWindow(kind: WindowKind): void {
  void openMediaWindow(kind, mediaOnAir.value, { explicit: true });
}

const projectionItems = computed<LjMenuItem[]>(() => [
  {
    label: t("shell.proj_open_projection"),
    icon: ICONS.PROJECTION.START,
    action: () => openWindow("projection"),
  },
  {
    label: t("shell.proj_open_return"),
    icon: ICONS.PROJECTION.RETURN,
    action: () => openWindow("return"),
  },
  {
    label: t("shell.proj_open_operator"),
    icon: ICONS.UI.VIEW_GRID_OUTLINE,
    action: () => openWindow("operator"),
  },
]);

/**
 * Menu "hambúrguer" das larguras estreitas: os botões que saíram da barra e,
 * abaixo de 350px, também os modos de reprodução.
 */
const compactItems = computed<LjMenuItem[]>(() => {
  const items: LjMenuItem[] = props.compactButtons.map((button) => ({
    icon: button.icon,
    disabled: props.loading || button.disabled,
    action: button.click,
  }));

  if (viewport.width.value <= 350) {
    items.push({ separator: true });
    for (const item of props.menuModes) {
      // O rótulo fica: quando o item está marcado o LjMenu troca o ícone pela
      // marca de seleção, então sem texto a linha ficaria completamente vazia.
      items.push(isSeparator(item) ? { separator: true } : modeItem(item));
    }
  }

  return items;
});
</script>

<style scoped>
/*
 * O Player inteiro vive num cartão `theme="dark"` do Vuetify — é chrome escuro
 * independentemente do tema do app. Em vez de disputar especificidade com o CSS
 * dos primitivos, redefinimos aqui os tokens que eles consomem: a cascata de
 * custom properties faz o resto, e o menu (que vai para um portal no body)
 * continua com a paleta normal da superfície.
 */
.player-actions {
  --lj-text: var(--lj-text-on-navy);
  --lj-text-muted: var(--lj-text-on-navy-muted);
  --lj-surface-bg-hover: var(--lj-white-alpha-10);
  --lj-surface-bg-active: var(--lj-white-alpha-18);

  display: flex;
  flex: 1 1 auto;
  align-items: center;
  justify-content: flex-end;
  gap: var(--lj-space-2);
  padding: var(--lj-space-2);
}

/* Pastilha com o número do slide atual — único controle claro da barra, para
   ler como contador e não como mais um botão de ação. */
.pa-index {
  min-width: var(--lj-ui-h-sm);
  justify-content: center;
  padding-inline: var(--lj-space-3);
  background: var(--lj-white);
  border-color: var(--lj-white);
  color: var(--lj-gray-900);
  font-weight: var(--lj-weight-semibold);
  cursor: pointer;
}

.pa-index:hover {
  background: var(--lj-gray-100);
  border-color: var(--lj-gray-100);
}
</style>
