<template>
  <div class="video-monitors">
    <div class="video-monitors-field">
      <label class="video-monitors-label">{{ t("ribbon.fields.monitor") }}</label>
      <MonitorSelect :model-value="videoMonitor" @update:model-value="setVideoMonitor" />
      <label class="video-monitors-checkbox">
        <input type="checkbox" :checked="showReturn" @change="toggleReturn" />
        <span>{{ t("ribbon.fields.show_return") }}</span>
      </label>
    </div>
    <div v-if="showReturn" class="video-monitors-field">
      <label class="video-monitors-label">{{ t("ribbon.fields.return_monitor") }}</label>
      <MonitorSelect :model-value="returnMonitor" @update:model-value="setReturnMonitor" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watchEffect } from "vue";
import { useI18n } from "vue-i18n";
import MonitorSelect from "@/components/inputs/MonitorSelect.vue";
import { useDisplays } from "@/composables/useDisplays";
import { useUserDataStore } from "@/stores/userDataStore";
import $userdata from "@/helpers/UserData";
import { KEYS } from "@/constants/UserDataKeys";
import { PROJECTION_TYPE } from "@/constants/Projection";

const { t } = useI18n();
const { getFeatureRole, setFeatureRole } = useDisplays();

const showReturn = ref(false);

watchEffect(() => {
  showReturn.value =
    useUserDataStore().$state.options?.online_video_projection?.show_return === true;
});

// Antes eram passadas chaves de UserData ("options.displays.online_video") onde
// se esperava um nome de feature, então a preferência era gravada numa chave
// que nenhum leitor consultava.
const videoMonitor = ref<string>("");
const returnMonitor = ref<string>("");

onMounted(async () => {
  videoMonitor.value = (await getFeatureRole(PROJECTION_TYPE.ONLINE_VIDEO)) ?? "";
  returnMonitor.value = (await getFeatureRole(PROJECTION_TYPE.ONLINE_VIDEO_RETURN)) ?? "";
});

function setVideoMonitor(val: string) {
  videoMonitor.value = val;
  setFeatureRole(PROJECTION_TYPE.ONLINE_VIDEO, val || null);
}

function setReturnMonitor(val: string) {
  returnMonitor.value = val;
  setFeatureRole(PROJECTION_TYPE.ONLINE_VIDEO_RETURN, val || null);
}

function toggleReturn(e: Event) {
  const checked = (e.target as HTMLInputElement).checked;
  showReturn.value = checked;
  $userdata.set(KEYS.OPTIONS.ONLINE_VIDEO_PROJECTION.SHOW_RETURN, checked);
}
</script>

<style scoped>
.video-monitors {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 8px;
  padding: 4px 6px;
}
.video-monitors-field {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.video-monitors-label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  color: rgba(var(--lj-on-surface-ch), 0.55);
}
.video-monitors-checkbox {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 0;
  font-size: 11px;
  cursor: pointer;
  white-space: nowrap;
  color: var(--lj-text);
}
.video-monitors-checkbox input {
  margin: 0;
}
</style>
