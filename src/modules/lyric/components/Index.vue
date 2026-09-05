<template>
  <Window
    v-model="module_.show"
    :title="lyConfig.title"
    :subtitle="
      lyConfig.subtitle + (lyConfig.track > 0 ? ' | ' + t('track') + ' ' + lyConfig.track : '')
    "
    :image="lyConfig.image ? lyricImageUrl : ''"
    closable
    size="small"
    @close="closeLyric()"
  >
    <div v-if="lyLoading" class="ly-skeleton">
      <LjSkeleton v-for="n in 5" :key="n" height="14px" />
    </div>
    <div v-else>
      <div v-for="line in lyLines" :key="line.id_lyric">
        <b v-if="line.aux_lyric">{{ line.aux_lyric }}</b>
        {{ line.lyric }}&nbsp;
      </div>
    </div>
  </Window>
</template>

<script setup>
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { module as manifest } from "../manifest";
import Window from "@/components/Window.vue";
import { LjSkeleton } from "@/components/ui";
import { useLyric } from "@/composables/useLyric";
import Modules from "@/helpers/Modules";
import Path from "@/helpers/Path";
import Media from "@/composables/useMedia";

const { t: i18nT } = useI18n();
const moduleId = manifest.id;
const module_ = computed(() => Modules.get(moduleId));

const ly = useLyric();
const lyLoading = ly.loading;
const lyConfig = ly.config;
const lyLines = ly.lyric;

const lyricImageUrl = computed(() =>
  lyConfig.value?.image ? Path.file(lyConfig.value.image) : ""
);

const t = (text) => i18nT(`modules.${moduleId}.${text}`);

function closeLyric() {
  Media.closeLyric();
}
</script>

<style scoped>
.ly-skeleton {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-5);
}
</style>
