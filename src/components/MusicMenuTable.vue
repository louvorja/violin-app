<template>
  <div class="mmt">
    <template v-if="!compact">
      <LjButton
        v-for="btn in buttons"
        :key="btn.testid"
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

    <LjMenu side="left" align="start">
      <template #trigger>
        <LjButton
          size="md"
          variant="ghost"
          icon-only
          :icon="ICONS.UI.DOTS_VERTICAL"
          :title="t('shell.appmenu')"
          :aria-label="t('shell.appmenu')"
        />
      </template>

      <!-- Nas larguras estreitas os botões rápidos saem da linha e entram no
           menu, como no layout original. Cada um é um item do menu (`as-child`):
           é o que mantém a navegação por teclado e o fechamento ao acionar. -->
      <template v-if="compact">
        <div class="mmt-quick">
          <DropdownMenuItem
            v-for="btn in buttons"
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
            <Icon :icon="ICONS.UI.MENU_LEFT" :size="15" />
          </span>
          <span class="lj-menu__text">{{ item.title }}</span>
          <Icon :icon="item.icon" :size="15" class="mmt-sub__icon" />
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
                  <Icon v-if="subitem.icon" :icon="subitem.icon" :size="13" />
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
import { computed, inject } from "vue";
import { useI18n } from "vue-i18n";
import { useViewport } from "@/composables/useViewport";
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
import $snackbar from "@/helpers/Snackbar";
import Icon from "@/components/Icon.vue";
import { LjButton, LjMenu } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { MusicActionEnum } from "@/enums/MusicActionEnum";
import { usePlaylists } from "@/modules/musics/composables/usePlaylists";
import type { PlaylistSong } from "@/types/Music";

interface ButtonItem {
  testid: string;
  disabled: boolean;
  title: string;
  icon: string;
  click: () => void;
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
  click: () => void;
}

const props = defineProps<{
  id_music: number;
  name: string;
  has_instrumental_music: boolean | number;
  color?: string;
  extraMenu?: ExtraMenuItem[];
  showPlaylistMenu?: boolean;
}>();

const { t } = useI18n();
const { width } = useViewport();

const closeSpotlight = inject<() => void>("close-spotlight", () => {});

const is_favorite = computed(() => Favorites.isFavorite(props.id_music));
const compact = computed(() => width.value <= 550);

/**
 * A cor vem do consumidor (a tabela de álbuns pinta a linha de branco sobre a
 * capa). Em vez de forçar `color`, o valor entra pelos tokens que o botão
 * fantasma já lê — assim o estado de hover continua coerente.
 */
const colorStyle = computed(() =>
  props.color ? { "--lj-text-muted": props.color, "--lj-text": props.color } : undefined
);

const buttons = computed<ButtonItem[]>(() => [
  {
    testid: "favorite",
    disabled: false,
    title: is_favorite.value
      ? t("components.music_menu.remove_from_favorites")
      : t("components.music_menu.add_to_favorites"),
    icon: is_favorite.value ? ICONS.UI.STAR : ICONS.UI.STAR_OUTLINE,
    click: () => Favorites.toggle(props.id_music, props.name, !!props.has_instrumental_music),
  },
  {
    testid: "sing",
    disabled: false,
    title: t("ribbon.btn.sing"),
    icon: ICONS.MUSIC.SING,
    click: () => {
      closeSpotlight();
      Media.open({ id_music: props.id_music, mode: MusicActionEnum.AUDIO });
    },
  },
  {
    testid: "playback",
    disabled: !props.has_instrumental_music,
    title: t("ribbon.btn.playback"),
    icon: ICONS.MUSIC.PLAYBACK,
    click: () => {
      closeSpotlight();
      Media.open({ id_music: props.id_music, mode: MusicActionEnum.INSTRUMENTAL });
    },
  },
  {
    testid: "no-audio",
    disabled: false,
    title: t("ribbon.btn.no_audio"),
    icon: ICONS.MUSIC.NO_AUDIO,
    click: () => {
      closeSpotlight();
      Media.open(props.id_music);
    },
  },
  {
    testid: "lyric",
    disabled: false,
    title: t("ribbon.btn.lyric"),
    icon: ICONS.MUSIC.LYRIC,
    click: () => Media.openLyric(props.id_music),
  },
  {
    testid: "audio-only",
    disabled: false,
    title: t("ribbon.btn.audio_only"),
    icon: ICONS.MUSIC.AUDIO,
    click: () => {
      closeSpotlight();
      Media.openAudio(props.id_music);
    },
  },
  {
    testid: "playback-only",
    disabled: !props.has_instrumental_music,
    title: t("ribbon.btn.playback_only"),
    icon: ICONS.MUSIC.AUDIO_PLAYBACK,
    click: () => {
      closeSpotlight();
      Media.openAudio({ id_music: props.id_music, mode: MusicActionEnum.INSTRUMENTAL });
    },
  },
]);

const { playlists, addSong, isSongInPlaylist } = usePlaylists();

const menu = computed<MenuItem[]>(() => [
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
        click: () => Liturgy.addMusic(props.id_music, props.name, !!props.has_instrumental_music),
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
  {
    title: t("components.music_menu.execute"),
    icon: ICONS.PLAYER.PLAYER,
    menu: [
      {
        title: t("ribbon.btn.sing"),
        icon: ICONS.MUSIC.SING,
        click: () => Media.open({ id_music: props.id_music, mode: MusicActionEnum.AUDIO }),
      },
      {
        title: t("ribbon.btn.playback"),
        icon: ICONS.MUSIC.PLAYBACK,
        click: () => Media.open({ id_music: props.id_music, mode: MusicActionEnum.INSTRUMENTAL }),
        disabled: !props.has_instrumental_music,
      },
      {
        title: t("ribbon.btn.no_audio"),
        icon: ICONS.MUSIC.NO_AUDIO,
        click: () => Media.open(props.id_music),
      },
      {
        title: t("ribbon.btn.lyric"),
        icon: ICONS.MUSIC.LYRIC,
        click: () => Media.openLyric(props.id_music),
      },
      { title: "-" },
      {
        title: t("components.music_menu.file_sing"),
        icon: ICONS.MUSIC.AUDIO,
        click: () => Media.openAudio(props.id_music),
      },
      {
        title: t("components.music_menu.file_playback"),
        icon: ICONS.MUSIC.AUDIO_PLAYBACK,
        click: () =>
          Media.openAudio({ id_music: props.id_music, mode: MusicActionEnum.INSTRUMENTAL }),
        disabled: !props.has_instrumental_music,
      },
    ],
  },
  ...(props.extraMenu?.map((item) => ({
    title: item.title,
    icon: item.icon,
    menu: [{ title: item.title, icon: item.icon, click: item.click }],
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
