import { computed, onScopeDispose, shallowRef, toValue, watch, type MaybeRefOrGetter } from "vue";
import { useI18n } from "vue-i18n";
import Database from "@/helpers/Database";
import UserData from "@/helpers/UserData";
import { KEYS } from "@/constants/UserDataKeys";
import { albumYears, prepareMusicCatalog } from "@root/config/musicCatalog.mjs";
import type { LiturgyMusicItem } from "@/types/Liturgy";

export function getDisabledAlbums() {
  // `disabled_albums` é a fonte única. O toggle `hymnal_1996.show_in_main_menu`
  // controla só a visibilidade do módulo no desktop — o acervo (inclusive os
  // hinos de 1996) continua disponível para busca e navegação.
  const saved = UserData.get<(number | string)[]>(KEYS.OPTIONS.DISABLED_ALBUMS, []);
  return Array.isArray(saved) ? [...saved] : [];
}

export function useDisabledAlbums() {
  return computed(getDisabledAlbums);
}

export function useMusicCatalog<
  T extends Pick<LiturgyMusicItem, "name" | "albums" | "albums_names" | "custom_song_id">,
>(source: MaybeRefOrGetter<T[]>, enabled: MaybeRefOrGetter<boolean> = true) {
  const { locale } = useI18n();
  const disabledAlbums = useDisabledAlbums();
  const years = shallowRef<Map<string, number>>(new Map());
  let revision = 0;
  onScopeDispose(() => {
    revision++;
  });

  watch(
    [locale, () => toValue(enabled)],
    async ([language, active]) => {
      const current = ++revision;
      years.value = new Map();
      if (!active) return;
      try {
        const categories = await Database.get(`${language}_categories`, { silent: true });
        if (current === revision) years.value = albumYears(categories);
      } catch {
        // O catálogo continua disponível com anos explícitos e edições conhecidas.
      }
    },
    { immediate: true }
  );

  const musics = computed(() =>
    prepareMusicCatalog(toValue(source), disabledAlbums.value, years.value)
  );
  return { musics, disabledAlbums, years };
}
