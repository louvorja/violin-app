<template>
  <div ref="root" class="mmt">
    <template v-if="!compact">
      <template v-if="showQuickActions">
        <template v-for="btn in buttons" :key="btn.testid">
          <span v-if="btn.placeholder" class="mmt-slot" aria-hidden="true" />
          <LjButton
            v-else
            size="md"
            variant="ghost"
            icon-only
            :icon="btn.icon"
            :class="{ 'mmt-btn--star': btn.icon === ICONS.UI.STAR }"
            :style="colorStyle"
            :disabled="btn.disabled"
            :title="btn.title"
            :data-testid="'mmt-btn-' + btn.testid"
            @click="btn.click"
          />
        </template>
      </template>
      <span v-else class="mmt-reserve" :style="{ '--mmt-quick-count': quickActionCount }" />
    </template>

    <LjMenu v-if="showMenu" side="left" align="start" lazy-content>
      <template #trigger>
        <LjButton
          size="md"
          variant="ghost"
          icon-only
          :icon="ICONS.UI.DOTS_VERTICAL"
          :title="menuTitle"
          :aria-label="menuTitle"
        />
      </template>

      <!-- No modo compacto os botões rápidos saem da linha e entram no menu.
           Cada um é um item do menu (`as-child`):
           é o que mantém a navegação por teclado e o fechamento ao acionar. -->
      <template v-if="compact">
        <div class="mmt-quick">
          <DropdownMenuItem
            v-for="btn in menuButtons"
            :key="btn.testid"
            as-child
            :disabled="btn.disabled"
            @select="btn.click()"
          >
            <LjButton
              size="md"
              variant="ghost"
              icon-only
              :icon="btn.icon"
              :disabled="btn.disabled"
              :title="btn.title"
              :data-testid="'mmt-btn-' + btn.testid"
            />
          </DropdownMenuItem>
        </div>
        <DropdownMenuSeparator class="lj-menu__separator" />
      </template>

      <DropdownMenuSub v-for="(item, key) in menu" :key="key">
        <DropdownMenuSubTrigger class="lj-menu__item">
          <span class="lj-menu__mark">
            <LjIcon :icon="ICONS.UI.MENU_LEFT" :size="15" />
          </span>
          <span class="lj-menu__text">{{ item.title }}</span>
          <LjIcon :icon="item.icon" :size="15" class="mmt-sub__icon" />
        </DropdownMenuSubTrigger>

        <DropdownMenuPortal>
          <DropdownMenuSubContent class="lj-ui-float lj-menu" :side-offset="4">
            <template v-for="(subitem, subkey) in item.menu" :key="subkey">
              <DropdownMenuSeparator v-if="subitem.title === '-'" class="lj-menu__separator" />
              <DropdownMenuItem
                v-else
                class="lj-menu__item"
                :disabled="subitem.disabled ? subitem.disabled : false"
                @select="subitem.click?.()"
              >
                <span class="lj-menu__mark">
                  <LjIcon v-if="subitem.icon" :icon="subitem.icon" :size="13" />
                </span>
                <span class="lj-menu__text">{{ subitem.title }}</span>
              </DropdownMenuItem>
            </template>
          </DropdownMenuSubContent>
        </DropdownMenuPortal>
      </DropdownMenuSub>
    </LjMenu>
  </div>
</template>

<script setup lang="ts">
/**
 * Widget de ações por linha de tabela de músicas: botões rápidos (favorito, cantar,
 * playback, sem áudio, letra) + menu dropdown com submenus. O sufixo "Table" no nome
 * indica o contexto onde é renderizado, não a presença de lógica de tabela — não há
 * duplicação com DataTable.vue.
 *
 * O catálogo não tem primitivo de submenu, e o `LjMenu` expõe o slot padrão dentro
 * do próprio conteúdo flutuante: os níveis aninhados são montados ali com as peças
 * do Reka UI que o `LjMenu` já usa, reaproveitando as classes `lj-menu__*`.
 */
import { computed, inject, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useViewport } from "@/composables/useViewport";
import { useRowReveal } from "@/composables/useRowReveal";
import {
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "reka-ui";
import Favorites from "@/helpers/Favorites";
import Liturgy from "@/helpers/Liturgy";
import Media from "@/composables/useMedia";
import { openCustomMusic } from "@/helpers/CustomMusicCatalog";
import $snackbar from "@/helpers/Snackbar";
import { LjButton, LjIcon, LjMenu } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { MUSIC_EXECUTIONS, canExecute, type MusicExecution } from "@/config/MusicAction";
import { MusicActionEnum } from "@/enums/MusicActionEnum";
import { usePlaylists } from "@/modules/musics/composables/usePlaylists";
import type { PlaylistSong } from "@/types/Music";

interface ButtonItem {
  testid: string;
  disabled: boolean;
  title: string;
  icon: string;
  click: () => void;
  /** Só guarda o lugar: ação que esta música não tem. */
  placeholder?: boolean;
}

interface MenuItem {
  title: string;
  icon: string;
  menu: MenuSubItem[];
}
interface MenuSubItem {
  title: string;
  icon?: string;
  click?: () => void;
  disabled?: boolean;
}
interface ExtraMenuItem {
  title: string;
  icon: string;
  click?: () => void;
  /** Com submenu, o item abre as opções em vez de executar `click`. */
  menu?: MenuSubItem[];
}

const props = withDefaults(
  defineProps<{
    id_music: number;
    name: string;
    albumId?: number | null;
    musicSubtitle?: string;
    has_instrumental_music: boolean | number;
    /** UUID da música personalizada: os botões passam a executá-la, sem favorito nem letra. */
    customSongId?: string;
    /** A música personalizada pode não ter a faixa cantada; no acervo toda música tem. */
    hasAudio?: boolean;
    /** Guarda o lugar das ações que a música personalizada não tem, para a coluna bater com a do acervo. */
    alignWithCatalog?: boolean;
    color?: string;
    extraMenu?: ExtraMenuItem[];
    showPlaylistMenu?: boolean;
    /** Largura máxima para recolher os atalhos no menu; pode variar com a tabela. */
    compactBreakpoint?: number;
    /** Monta ações rápidas apenas quando a linha é explorada, reduzindo o custo da tabela. */
    deferQuickActions?: boolean;
    /**
     * Quem usa a tabela decide como tocar (o modo apresentação toca pelo palco dele).
     * Sem isto, a música vai direto para o player.
     */
    runAction?: (action: MusicActionEnum) => void;
  }>(),
  {
    albumId: null,
    alignWithCatalog: true,
    compactBreakpoint: 550,
    customSongId: "",
    deferQuickActions: true,
    hasAudio: true,
    musicSubtitle: "",
  }
);

// Quantos botões rápidos `buttons` devolve; o espaço reservado antes de montá-los
// depende disso, e o E2E `row-actions` acusa se a tabela deslocar.
const QUICK_ACTION_COUNT = 7;
// Favorito e letra não existem para a música personalizada.
const CATALOG_ONLY_ACTIONS = 2;

const { t } = useI18n();
const menuTitle = computed(() =>
  props.name.trim() ? `${t("shell.appmenu")}: ${props.name}` : t("shell.appmenu")
);
const { width } = useViewport();
const root = ref<HTMLElement | null>(null);
const revealed = useRowReveal(root);

const closeSpotlight = inject<() => void>("close-spotlight", () => {});

const is_favorite = computed(() => Favorites.isFavorite(props.id_music));
const compact = computed(() => width.value <= props.compactBreakpoint);
const showQuickActions = computed(() => !props.deferQuickActions || revealed.value);
const quickActionCount = computed(() =>
  props.customSongId && !props.alignWithCatalog
    ? QUICK_ACTION_COUNT - CATALOG_ONLY_ACTIONS
    : QUICK_ACTION_COUNT
);

/**
 * Consumidores que usam superfícies próprias podem ajustar a cor do botão.
 * O valor entra pelos tokens que o botão fantasma já lê para preservar o hover.
 */
const colorStyle = computed(() =>
  props.color ? { "--lj-text-muted": props.color, "--lj-text": props.color } : undefined
);

function openLyric(): void {
  Media.openLyric(
    props.albumId != null ? { id_music: props.id_music, id_album: props.albumId } : props.id_music
  );
}

/** Executa a música no modo pedido: a do acervo pelo id, a personalizada pelo UUID. */
function execute(action: MusicActionEnum): void {
  if (props.runAction) {
    props.runAction(action);
    return;
  }
  if (props.customSongId) {
    void openCustomMusic(props.customSongId, action);
    return;
  }
  switch (action) {
    case MusicActionEnum.AUDIO_ONLY:
      Media.openAudio(props.id_music);
      break;
    case MusicActionEnum.PLAYBACK_ONLY:
      Media.openAudio({ id_music: props.id_music, mode: MusicActionEnum.INSTRUMENTAL });
      break;
    case MusicActionEnum.NO_AUDIO:
      Media.open(props.id_music);
      break;
    default:
      Media.open({ id_music: props.id_music, mode: action });
  }
}

function quickExecute(action: MusicActionEnum): void {
  closeSpotlight();
  execute(action);
}

/** Ação só do acervo: na música personalizada some, ou fica só o lugar dela. */
function catalogOnly(button: ButtonItem): ButtonItem[] {
  if (!props.customSongId) return [button];
  return props.alignWithCatalog ? [{ ...button, placeholder: true }] : [];
}

const tracks = computed(() => ({
  sung: props.hasAudio,
  playback: !!props.has_instrumental_music,
}));

function executionButton(item: MusicExecution): ButtonItem {
  return {
    testid: item.id,
    disabled: !canExecute(item, tracks.value),
    title: t(item.label),
    icon: item.icon,
    click: () => quickExecute(item.action),
  };
}

const buttons = computed<ButtonItem[]>(() => [
  ...catalogOnly({
    testid: "favorite",
    disabled: false,
    title: is_favorite.value
      ? t("components.music_menu.remove_from_favorites")
      : t("components.music_menu.add_to_favorites"),
    icon: is_favorite.value ? ICONS.UI.STAR : ICONS.UI.STAR_OUTLINE,
    click: () => Favorites.toggle(props.id_music, props.name, !!props.has_instrumental_music),
  }),
  ...MUSIC_EXECUTIONS.filter((item) => !item.audioOnly).map(executionButton),
  ...catalogOnly({
    testid: "lyric",
    disabled: false,
    title: t("ribbon.btn.lyric"),
    icon: ICONS.MUSIC.LYRIC,
    click: openLyric,
  }),
  ...MUSIC_EXECUTIONS.filter((item) => item.audioOnly).map(executionButton),
]);

const menuButtons = computed(() => buttons.value.filter((btn) => !btn.placeholder));

// Na música personalizada o menu só tem a execução: com os botões já à vista ele os repetiria.
const showMenu = computed(
  () =>
    !props.customSongId ||
    props.alignWithCatalog ||
    props.deferQuickActions ||
    compact.value ||
    !!props.extraMenu?.length
);

const { playlists, addSong, isSongInPlaylist } = usePlaylists();

// Favoritos, liturgia e playlists guardam o id do acervo, que a música personalizada não tem.
const catalogMenu = computed<MenuItem[]>(() => [
  {
    title: t("components.music_menu.add_to"),
    icon: ICONS.ACTIONS.ADD,
    menu: [
      {
        title: is_favorite.value
          ? t("components.music_menu.remove_from_favorites")
          : t("components.music_menu.add_to_favorites"),
        icon: is_favorite.value ? ICONS.UI.STAR_OFF : ICONS.UI.STAR,
        click: () => Favorites.toggle(props.id_music, props.name, !!props.has_instrumental_music),
      },
      {
        title: t("components.music_menu.add_to_liturgy"),
        icon: ICONS.UI.VIEW_LIST,
        click: () =>
          Liturgy.addMusic(
            props.id_music,
            props.name,
            !!props.has_instrumental_music,
            undefined,
            undefined,
            props.musicSubtitle
          ),
      },
    ],
  },
  ...(props.showPlaylistMenu && playlists.value.length > 0
    ? [
        {
          title: t("components.music_menu.add_to_playlist"),
          icon: ICONS.PLAYER.PLAYLIST_PLUS,
          menu: playlists.value.map((p) => ({
            title: p.name,
            icon: isSongInPlaylist(p.id, props.id_music) ? ICONS.UI.CHECK : ICONS.PLAYER.PLAYLIST,
            disabled: isSongInPlaylist(p.id, props.id_music),
            click: () => {
              const song: PlaylistSong = {
                id_music: props.id_music,
                name: props.name,
                duration: 0,
                has_instrumental_music: !!props.has_instrumental_music,
              };
              addSong(p.id, song);
              $snackbar.show(t("playlists.song_added"));
            },
          })),
        },
      ]
    : []),
]);

function executionEntry(item: MusicExecution): MenuSubItem {
  return {
    title: t(item.menuLabel || item.label),
    icon: item.icon,
    click: () => execute(item.action),
    disabled: !canExecute(item, tracks.value),
  };
}

const menu = computed<MenuItem[]>(() => [
  ...(props.customSongId ? [] : catalogMenu.value),
  {
    title: t("components.music_menu.execute"),
    icon: ICONS.PLAYER.PLAYER,
    menu: [
      ...MUSIC_EXECUTIONS.filter((item) => !item.audioOnly).map(executionEntry),
      ...(props.customSongId
        ? []
        : [{ title: t("ribbon.btn.lyric"), icon: ICONS.MUSIC.LYRIC, click: openLyric }]),
      { title: "-" },
      ...MUSIC_EXECUTIONS.filter((item) => item.audioOnly).map(executionEntry),
    ],
  },
  ...(props.extraMenu?.map((item) => ({
    title: item.title,
    icon: item.icon,
    menu: item.menu ?? [{ title: item.title, icon: item.icon, click: item.click }],
  })) ?? []),
]);
</script>

<!-- Sem `scoped`: os submenus e a fileira compacta são renderizados dentro do
     portal do LjMenu, fora da árvore do componente, e não recebem o atributo de
     escopo. O isolamento vem do prefixo `mmt-`. -->
<style>
.mmt {
  display: flex;
  align-items: center;
  gap: var(--lj-space-1);
  flex-wrap: nowrap;
}

/* Guarda o lugar dos botões rápidos até serem montados: sem isso a tabela inteira desloca ao passar o mouse. */
.mmt-reserve {
  flex: none;
  width: calc(
    var(--mmt-quick-count) * var(--lj-ui-h-md) + (var(--mmt-quick-count) - 1) * var(--lj-space-1)
  );
}

/* Lugar de uma ação que esta música não tem: mantém as demais na coluna de sempre. */
.mmt-slot {
  flex: none;
  width: var(--lj-ui-h-md);
}

/*
 * Estrela do favorito. A cor entra pelos tokens que o botão fantasma consome,
 * e não por uma regra de `color`: assim não há disputa de especificidade com o
 * CSS do primitivo, e o `color` vindo do consumidor (estilo inline) continua
 * tendo a última palavra.
 */
.mmt-btn--star {
  --lj-text-muted: var(--lj-color-cover-gold);
  --lj-text: var(--lj-orange-darker);
  --lj-surface-bg-hover: var(--lj-orange-alpha-12);
}

/* Fileira de botões rápidos dentro do menu (larguras estreitas) */
.mmt-quick {
  --lj-text-muted: var(--lj-ui-accent-text);

  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--lj-space-1);
  padding: var(--lj-space-1);
}

/* Ícone do grupo, à direita do rótulo — a seta de submenu fica à esquerda */
.mmt-sub__icon {
  flex-shrink: 0;
  color: var(--lj-text-muted);
}
</style>
