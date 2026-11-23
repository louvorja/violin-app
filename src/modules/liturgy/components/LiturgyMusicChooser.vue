<template>
  <MusicSpotlight
    v-model="open"
    mode="pick"
    custom-songs
    :on-music-action="onAction"
    @pick="onPicked"
  />
</template>

<script setup lang="ts">
/**
 * Busca do item "Escolher na hora do culto" — a mesma no módulo Liturgia e na
 * liturgia lateral. Eram duas montagens do `MusicSpotlight`: a lateral não
 * listava as músicas personalizadas, e a do módulo listava mas não as tocava.
 */
import { ref } from "vue";
import MusicSpotlight from "@/components/MusicSpotlight.vue";
import { ACTION_LITURGY_VERSION } from "@/config/MusicAction";
import type { MusicActionEnum } from "@/enums/MusicActionEnum";
import type { LiturgyItem } from "@/types/Liturgy";
import type { SearchMusicItem } from "@/types/Music";
import { chosenMusicItem } from "../chosenMusic";

const emit = defineEmits<{
  /** `executable` vai para o `playMusic`; `item` é o da liturgia, para marcar. */
  (e: "chosen", executable: LiturgyItem, mode: string, item: LiturgyItem): void;
}>();

const open = ref(false);
let pending: LiturgyItem | null = null;
let pendingMode = "sung";

/** `mode` é a versão do botão clicado no item; vale quando a busca não diz outra. */
function choose(item: LiturgyItem, mode = "sung"): void {
  pending = item;
  pendingMode = mode;
  open.value = true;
}

function onPicked(music: SearchMusicItem, mode = pendingMode): void {
  const item = pending;
  pending = null;
  const executable = item && chosenMusicItem(item, music);
  if (item && executable) emit("chosen", executable, mode, item);
}

function onAction(music: SearchMusicItem, action: MusicActionEnum): void {
  onPicked(music, ACTION_LITURGY_VERSION[action] ?? pendingMode);
}

defineExpose({ choose });
</script>
