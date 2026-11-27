<template>
  <LibraryFiles
    scope="files"
    media-type-tabs
    :live-path="livePath"
    :return-path="returnPath"
    :pane-active="!!pane"
    v-bind="relay"
    @stop="emit('stop')"
    @show-on-return="
      (e: LibraryEntry | null) => emit('show-on-return', e && { type: 'file', entry: e })
    "
    @source-opened="pane = null"
  >
    <template #nav-extra>
      <OnlineSources
        :active="pane === 'native' ? null : pane"
        @open="pane = 'online'"
        @canva="pane = 'canva'"
        @add="addLink"
      />
      <NativeMediaSources :active="pane === 'native'" @select="openNative" />
    </template>
    <template #pane>
      <LibraryCanva
        v-if="pane === 'canva'"
        :live-path="livePath"
        v-bind="relay"
        @stop="emit('stop')"
      />
      <LibraryOnline
        v-else-if="pane === 'online'"
        ref="onlinePane"
        :live-video-id="liveVideoId"
        :return-path="returnPath"
        v-bind="relay"
        @stop="emit('stop')"
        @show-on-return="(t: Playable | null) => emit('show-on-return', t)"
      />
      <LibraryNativeMedia
        v-else
        embedded
        :live-path="livePath"
        :return-path="returnPath"
        v-bind="relay"
        @stop="emit('stop')"
        @show-on-return="
          (e: LibraryEntry | null) => emit('show-on-return', e && { type: 'file', entry: e })
        "
      />
    </template>
  </LibraryFiles>
</template>

<script lang="ts">
import { ref } from "vue";

/** Fica entre as visitas à aba: voltar à Mídia reabre o que estava à vista. */
const pane = ref<"online" | "canva" | "native" | null>(null);
</script>

<script setup lang="ts">
import { nextTick } from "vue";
import LibraryCanva from "./LibraryCanva.vue";
import LibraryFiles from "./LibraryFiles.vue";
import LibraryNativeMedia from "./LibraryNativeMedia.vue";
import LibraryOnline from "./LibraryOnline.vue";
import NativeMediaSources from "./NativeMediaSources.vue";
import OnlineSources from "./OnlineSources.vue";
import { useNativeMediaLibrary } from "../composables/useNativeMediaLibrary";
import type { ProgramItem } from "@/types/Presentation";
import type { LibraryEntry } from "../composables/useFileLibrary";
import type { Playable, PlayOptions } from "../program/playable";

/**
 * Aba Mídia: os arquivos das pastas da biblioteca (com abas por tipo), o grupo
 * Online (YouTube e Canva) e a Biblioteca de Mídia por categorias — como a aba
 * Mídia do FreeShow.
 */

defineProps<{
  livePath: string | null;
  returnPath: string | null;
  liveVideoId: string | null;
}>();

const emit = defineEmits<{
  preview: [playable: Playable];
  play: [playable: Playable, options?: PlayOptions];
  add: [item: ProgramItem];
  stop: [];
  "show-on-return": [target: Playable | null];
}>();

const relay = {
  onPreview: (p: Playable) => emit("preview", p),
  onPlay: (p: Playable, options?: PlayOptions) => emit("play", p, options),
  onAdd: (item: ProgramItem) => emit("add", item),
};

const onlinePane = ref<{ startAdding: () => Promise<void> } | null>(null);
const native = useNativeMediaLibrary();

function openNative(categoryId: string): void {
  native.filter.value = categoryId;
  pane.value = "native";
}

async function addLink(): Promise<void> {
  pane.value = "online";
  await nextTick();
  await onlinePane.value?.startAdding();
}
</script>
