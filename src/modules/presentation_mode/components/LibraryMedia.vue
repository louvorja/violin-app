<template>
  <LibraryFiles
    scope="media"
    :live-path="livePath"
    :return-path="returnPath"
    :pane-active="onlineOpen"
    v-bind="relay"
    @stop="emit('stop')"
    @show-on-return="
      (e: LibraryEntry | null) => emit('show-on-return', e && { type: 'file', entry: e })
    "
    @source-opened="onlineOpen = false"
  >
    <template #nav-extra>
      <OnlineSources :active="onlineOpen" @open="onlineOpen = true" @add="addLink" />
    </template>
    <template #pane>
      <LibraryOnline
        ref="onlinePane"
        :live-video-id="liveVideoId"
        :return-path="returnPath"
        v-bind="relay"
        @stop="emit('stop')"
        @show-on-return="(t: Playable | null) => emit('show-on-return', t)"
      />
    </template>
  </LibraryFiles>
</template>

<script lang="ts">
import { ref } from "vue";

/** Fica entre as visitas à aba: voltar à Mídia reabre o que estava à vista. */
const onlineOpen = ref(false);
</script>

<script setup lang="ts">
import { nextTick } from "vue";
import LibraryFiles from "./LibraryFiles.vue";
import LibraryOnline from "./LibraryOnline.vue";
import OnlineSources from "./OnlineSources.vue";
import type { ProgramItem } from "@/types/Presentation";
import type { LibraryEntry } from "../composables/useFileLibrary";
import type { Playable, PlayOptions } from "../program/playable";

/**
 * Aba Mídia: fotos e vídeos das pastas da biblioteca e, no grupo Online, os
 * vídeos, playlists e canais do YouTube — como a aba Mídia do FreeShow.
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

async function addLink(): Promise<void> {
  onlineOpen.value = true;
  await nextTick();
  await onlinePane.value?.startAdding();
}
</script>
