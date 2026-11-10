<template>
  <ModuleContainer :manifest="manifest" :style="{ minWidth: '260px' }" @close="close()">
    <div class="mod-shell">
      <ModuleFormatDrawer v-model="show_format" :module-id="'counter'" :manifest="manifest" />
      <div ref="container" class="counter-stage" :style="rootStyle">
        <ModuleBackgroundMedia
          v-if="bgImage"
          :src="bgImage"
          class="counter-bg-img"
          :style="imageStyle"
        />
        <div class="counter-display" :style="textStyle">{{ count }}</div>
      </div>
    </div>
  </ModuleContainer>
</template>

<script setup>
import { ref, watch } from "vue";
import { module as manifest } from "../manifest";
import ModuleContainer from "@/components/ModuleContainer.vue";
import ModuleBackgroundMedia from "@/components/ModuleBackgroundMedia.vue";
import ModuleFormatDrawer from "@/components/ModuleFormatDrawer.vue";
import { useModuleProjection } from "@/composables/useModuleProjection";
import { useModuleFormat } from "@/composables/useModuleFormat";
import { useModuleBodyStyle } from "@/composables/useModuleBodyStyle";
import { COUNTER_START } from "../projectionText";

const { show_format } = useModuleFormat("counter", manifest);

const { rootStyle, textStyle, bgImage, imageStyle, container } = useModuleBodyStyle("counter");

const projection = useModuleProjection("counter", {
  onAction(action) {
    if (action === "increment") increment();
    else if (action === "decrement") decrement();
    else if (action === "reset") reset();
    else if (action === "toggle_format") show_format.value = !show_format.value;
  },
});

const count = ref(COUNTER_START);

watch(
  count,
  (n) => {
    projection.emit({ text: String(n), active: true });
  },
  { immediate: true }
);

function increment() {
  count.value++;
}
function decrement() {
  count.value--;
}
function reset() {
  count.value = COUNTER_START;
}
function close() {
  count.value = COUNTER_START;
}
</script>

<style scoped>
.mod-shell {
  display: flex;
  height: 100%;
}

.counter-stage {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex-grow: 1;
  gap: var(--lj-space-6);
}

.counter-display {
  position: relative;
  z-index: 1;
  font-size: 5rem;
  font-weight: 200;
  font-variant-numeric: tabular-nums;
  min-width: 3ch;
  text-align: center;
}
.counter-bg-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 0;
  pointer-events: none;
}
</style>
