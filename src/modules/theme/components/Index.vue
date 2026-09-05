<template>
  <ModuleContainer ref="moduleContainer" :manifest="manifest">
    <div v-for="(group, mode) in themes" :key="mode" class="mb-3">
      <div class="subtitle-1 font-weight-medium">
        {{ mode == "dark" ? t("dark-themes") : t("light-themes") }}
      </div>

      <button
        v-for="(theme, theme_id) in group"
        :key="theme_id"
        type="button"
        class="theme-swatch"
        :class="{ 'is-current': current == theme_id }"
        :aria-pressed="current == theme_id"
        :title="theme_id"
        @click="setTheme(theme_id)"
      >
        <span class="theme-swatch__color" :style="{ background: theme.colors.primary }" />
      </button>
    </div>
  </ModuleContainer>
</template>

<script setup>
/* ########################################################### */
/* ####### INSTALAÇÃO DO MODULO ############################## */
/* ########################################################### */
import { ref, onMounted } from "vue";
import { useTheme } from "vuetify";
import { module as manifest } from "../manifest";
import ModuleContainer from "@/components/ModuleContainer.vue";
import $appdata from "@/helpers/AppData";
import $userdata from "@/helpers/UserData";
const moduleContainer = ref(null);
const t = (key) => {
  return moduleContainer.value?.t(key) || key;
};
/* ########################################################### */
/* ########################################################### */
/* ########################################################### */

const vuetifyTheme = useTheme();

const current = ref("");
const themes = ref({
  light: {},
  dark: {},
});

/* ########################################################### */
/* ###################### METHODS ############################# */
/* ########################################################### */

function setTheme(theme_id) {
  current.value = theme_id;
  vuetifyTheme.global.name.value = current.value;
  $userdata.set("theme", current.value);
  $appdata.set("is_dark", vuetifyTheme.global.current.value.dark);
}

/* ########################################################### */
/* ###################### MOUNTED ############################# */
/* ########################################################### */

onMounted(() => {
  current.value = vuetifyTheme.global.name.value;
  themes.value = { light: {}, dark: {} };

  for (const key in vuetifyTheme.themes.value) {
    const item = vuetifyTheme.themes.value[key];

    if (item.dark) {
      themes.value.dark[key] = item;
    } else {
      themes.value.light[key] = item;
    }
  }
});
</script>

<style scoped>
.theme-swatch {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--lj-ui-h-lg);
  height: var(--lj-ui-h-lg);
  margin-inline: var(--lj-space-2);
  padding: 0;
  background: transparent;
  border: var(--lj-ui-border);
  border-color: transparent;
  border-radius: var(--lj-ui-radius);
  cursor: pointer;
}

.theme-swatch:hover {
  background: var(--lj-surface-bg-hover);
}

.theme-swatch:focus-visible {
  outline: none;
  box-shadow: var(--lj-ui-focus);
}

.theme-swatch.is-current {
  border-color: var(--lj-ui-accent);
}

.theme-swatch__color {
  width: 22px;
  height: 22px;
  border-radius: 50%;
}
</style>
