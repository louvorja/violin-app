<template>
  <ModuleContainer ref="moduleContainer" :manifest="manifest">
    <div v-for="group in groups" :key="group.mode" class="theme-group">
      <div class="theme-group__title">
        {{ group.mode == "dark" ? t("dark-themes") : t("light-themes") }}
      </div>

      <button
        v-for="theme in group.themes"
        :key="theme.id"
        type="button"
        class="theme-swatch"
        :class="{ 'is-current': current == theme.id }"
        :aria-pressed="current == theme.id"
        :title="theme.id"
        @click="setTheme(theme.id)"
      >
        <!-- A cor vem do próprio tema: carimbar `data-theme` aqui faz o bloco
             correspondente de tokens.css valer neste elemento, e `--lj-navy`
             resolve sozinho. Assim a amostra nunca diverge da paleta real. -->
        <span class="theme-swatch__color" :data-theme="theme.id" />
      </button>
    </div>
  </ModuleContainer>
</template>

<script setup>
/* ########################################################### */
/* ####### INSTALAÇÃO DO MODULO ############################## */
/* ########################################################### */
import { ref } from "vue";
import { module as manifest } from "../manifest";
import ModuleContainer from "@/components/ModuleContainer.vue";
import { DARK_THEMES, LIGHT_THEMES } from "@/config/Themes";
import { useAppTheme } from "@/composables/useAppTheme";
const moduleContainer = ref(null);
const t = (key) => {
  return moduleContainer.value?.t(key) || key;
};
/* ########################################################### */
/* ########################################################### */
/* ########################################################### */

const { current, setTheme } = useAppTheme();

const groups = [
  { mode: "light", themes: LIGHT_THEMES },
  { mode: "dark", themes: DARK_THEMES },
];
</script>

<style scoped>
.theme-group {
  margin-bottom: var(--lj-space-5);
}

.theme-group__title {
  font-weight: var(--lj-weight-medium);
}

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
  background: var(--lj-navy);
}
</style>
