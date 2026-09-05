<template>
  <div class="bgm-ribbon-settings">
    <div class="bgm-ribbon-settings-inner">
      <div class="bgm-ribbon-sliders">
        <div class="bgm-ribbon-row">
          <label class="bgm-ribbon-label">
            {{ t(LANG_PATH + ".fade_in") }}
          </label>
          <LjSlider
            v-model="fadeIn"
            :min="0"
            :max="10000"
            :step="1000"
            class="bgm-ribbon-slider"
            :aria-label="t(LANG_PATH + '.fade_in')"
            @update:model-value="save('fadeIn', $event)"
          />
          <span class="bgm-ribbon-value">{{ fadeIn / 1000 }}s</span>
        </div>
        <div class="bgm-ribbon-row">
          <label class="bgm-ribbon-label">
            {{ t(LANG_PATH + ".fade_out") }}
          </label>
          <LjSlider
            v-model="fadeOut"
            :min="0"
            :max="10000"
            :step="1000"
            class="bgm-ribbon-slider"
            :aria-label="t(LANG_PATH + '.fade_out')"
            @update:model-value="save('fadeOut', $event)"
          />
          <span class="bgm-ribbon-value">{{ fadeOut / 1000 }}s</span>
        </div>
      </div>
      <div class="bgm-ribbon-switches">
        <LjSwitch
          v-model="autoPause"
          :label="t(LANG_PATH + '.auto_pause')"
          @update:model-value="save('autoPause', $event)"
        />
        <LjSwitch
          v-model="repeat_"
          :label="t(LANG_PATH + '.repeat')"
          @update:model-value="save('repeat', $event)"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { LjSlider, LjSwitch } from "@/components/ui";
import { useBackgroundSound } from "@/composables/useBackgroundSound";
import $modules from "@/helpers/Modules";
import { ModuleEnum } from "@/enums/ModuleEnum";
import { getSetting, saveSetting } from "@/helpers/SettingsStorage";
import { BackgroundSoundSettings } from "@/types/Settings";
import { SETTINGS_TABLE } from "@/constants/DbTables";

const { t } = useI18n();

const LANG_PATH = $modules.getPath(ModuleEnum.BACKGROUND_SOUND);

const DEFAULTS: BackgroundSoundSettings = {
  fadeIn: 3000,
  fadeOut: 3000,
  autoPause: true,
  repeat: false,
};

const fadeIn = ref(3000);
const fadeOut = ref(3000);
const autoPause = ref(true);
const repeat_ = ref(false);
const bg = useBackgroundSound();

async function save(key: string, value: unknown): Promise<void> {
  const existing = await getSetting<BackgroundSoundSettings & { id: string }>(
    SETTINGS_TABLE.BACKGROUND_SOUND
  );
  const s = existing ?? { id: SETTINGS_TABLE.BACKGROUND_SOUND };
  (s as any)[key] = value;
  await saveSetting(s);
  if (key === "repeat") bg.repeat.value = value as boolean;
  if (key === "fadeIn") bg.fadeInMs.value = value as number;
  if (key === "fadeOut") bg.fadeOutMs.value = value as number;
}

onMounted(async () => {
  const s = await getSetting<BackgroundSoundSettings & { id: string }>(
    SETTINGS_TABLE.BACKGROUND_SOUND
  );
  const cfg = s ? { ...DEFAULTS, ...s } : DEFAULTS;
  fadeIn.value = cfg.fadeIn;
  fadeOut.value = cfg.fadeOut;
  autoPause.value = cfg.autoPause;
  repeat_.value = cfg.repeat;
});
</script>

<style scoped>
.bgm-ribbon-settings {
  padding: 4px 8px;
  min-width: 300px;
}
.bgm-ribbon-settings-inner {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}
.bgm-ribbon-sliders {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 250px;
}
.bgm-ribbon-switches {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-left: 15px;
}
.bgm-ribbon-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.bgm-ribbon-label {
  font-size: var(--lj-text-sm);
  color: var(--lj-text-muted);
  white-space: nowrap;
  min-width: 50px;
}
.bgm-ribbon-value {
  font-size: var(--lj-text-sm);
  font-weight: 500;
  min-width: 24px;
  text-align: right;
}
.bgm-ribbon-slider {
  flex: 1;
}
</style>
