<template>
  <div class="pm-moment" :class="{ 'pm-moment--strip': strip }" data-testid="pm-moment">
    <div v-if="!item.children?.length" class="pm-moment__empty">{{ tm("moment.empty") }}</div>
    <div v-else ref="grid" class="pm-moment__grid">
      <button
        v-for="(child, i) in item.children"
        :key="child.id"
        type="button"
        class="pm-moment__tile"
        :class="{
          'pm-moment__tile--live': child.id === liveChildId,
          'pm-moment__tile--next': i === liveIndex + 1 && liveIndex >= 0,
        }"
        :disabled="locked"
        :title="child.title"
        :data-testid="`pm-moment-${i}`"
        @click="emit('pick', child.id)"
      >
        <span class="pm-moment__thumb">
          <img v-if="child.path && thumbOf(child.path)" :src="thumbOf(child.path)" alt="" />
          <LjIcon v-else :icon="KIND_ICONS[child.kind]" :size="strip ? 18 : 26" />
          <LjIcon
            v-if="child.kind === 'video'"
            :icon="ICONS.PLAYER.PLAY"
            :size="14"
            class="pm-moment__video"
          />
        </span>
        <span class="pm-moment__label">
          <span class="pm-moment__n">{{ i + 1 }}</span>
          <span class="pm-moment__title">{{ child.title }}</span>
        </span>
      </button>
    </div>
    <p v-if="!strip && item.children?.length" class="pm-moment__hint">
      {{ tm("moment.grid_hint") }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { LjIcon } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { ModuleEnum } from "@/enums/ModuleEnum";
import { useModuleI18n } from "@/composables/useModuleI18n";
import type { ProgramItem } from "@/types/Presentation";
import { useMediaMeta } from "../composables/useMediaMeta";
import { KIND_ICONS } from "../program/kinds";

/**
 * Os arquivos de um momento do programa no palco, como os slides de uma
 * música: clicar manda ao ar; o que está no ar fica em laranja e o próximo em
 * azul. Com um vídeo no ar, vira uma faixa abaixo dos controles do vídeo.
 */

const props = defineProps<{
  item: ProgramItem;
  liveChildId: string | null;
  locked: boolean;
  /** Uma linha só, abaixo do vídeo no ar. */
  strip?: boolean;
}>();
const emit = defineEmits<{ pick: [childId: string] }>();

const { tm } = useModuleI18n(ModuleEnum.PRESENTATION_MODE);
const { thumbOf } = useMediaMeta();

const liveIndex = computed(
  () => props.item.children?.findIndex((c) => c.id === props.liveChildId) ?? -1
);

// O passador anda pela lista: o arquivo no ar não pode sumir da vista.
const grid = ref<HTMLElement | null>(null);
watch(liveIndex, async (i) => {
  if (i < 0) return;
  await nextTick();
  grid.value
    ?.querySelectorAll(".pm-moment__tile")
    [i]?.scrollIntoView({ block: "nearest", inline: "nearest" });
});
</script>

<style scoped>
.pm-moment {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.pm-moment--strip {
  flex: 0 0 auto;
  border-top: 1px solid var(--lj-white-alpha-10);
}

.pm-moment__empty {
  margin: auto;
  padding: var(--lj-space-6);
  max-width: 420px;
  text-align: center;
  color: var(--lj-white-alpha-50);
}

.pm-moment__grid {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 10px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(168px, 1fr));
  gap: 10px;
  align-content: start;
}

.pm-moment--strip .pm-moment__grid {
  display: flex;
  overflow-x: auto;
  overflow-y: hidden;
  padding: 6px 10px;
  gap: 8px;
}

.pm-moment--strip .pm-moment__tile {
  width: 120px;
  flex-shrink: 0;
}

.pm-moment__tile {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  padding: 0;
  border: none;
  background: none;
  color: var(--lj-white);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.pm-moment__tile:disabled {
  cursor: default;
  opacity: 0.6;
}

.pm-moment__thumb {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  border: 2px solid var(--lj-white-alpha-20);
  border-radius: 3px;
  background: var(--lj-live-stage-bg);
  color: var(--lj-white-alpha-50);
}

.pm-moment__thumb img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.pm-moment__video {
  position: absolute;
  right: 4px;
  bottom: 4px;
  padding: 2px;
  border-radius: 50%;
  background: var(--lj-black-alpha-75);
  color: var(--lj-white);
}

.pm-moment__tile:hover .pm-moment__thumb,
.pm-moment__tile:focus-visible .pm-moment__thumb {
  border-color: var(--lj-white-alpha-50);
}

.pm-moment__tile:focus-visible {
  outline: none;
}

.pm-moment__tile--live .pm-moment__thumb {
  border-color: var(--lj-orange);
}

.pm-moment__tile--next .pm-moment__thumb {
  border-color: var(--lj-live-select);
}

.pm-moment__label {
  display: flex;
  gap: 6px;
  min-width: 0;
  font-size: 11px;
}

.pm-moment__n {
  flex-shrink: 0;
  font-family: var(--lj-font-mono);
  color: var(--lj-white-alpha-50);
}

.pm-moment__tile--live .pm-moment__n {
  color: var(--lj-orange);
  font-weight: 700;
}

.pm-moment__title {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pm-moment__hint {
  margin: 0;
  padding: 4px 10px;
  flex-shrink: 0;
  font-size: 10.5px;
  color: var(--lj-white-alpha-50);
}
</style>
