<template>
  <ModuleContainer ref="moduleContainer" :manifest="manifest" min-width="320px" @close="close()">
    <div class="libras-root">
      <!-- Indicador de tradução -->
      <div v-if="isTranslating" class="libras-translating">
        <LjProgress indeterminate :height="2" />
      </div>

      <!-- Texto original -->
      <div v-if="originalText" class="libras-original">
        <div class="libras-label">{{ t("libras.original") }}</div>
        <div class="libras-text">{{ originalText }}</div>
      </div>

      <!-- Gloss Libras -->
      <div v-if="gloss" class="libras-gloss">
        <div class="libras-label">{{ t("libras.gloss") }}</div>
        <div class="libras-text libras-text--gloss">{{ gloss }}</div>
      </div>

      <!-- Mensagem quando vazio -->
      <div v-if="!gloss && !isTranslating" class="libras-empty">
        <Icon :icon="ICONS.MODULES.MUSICS" size="48" color="grey" />
        <p>{{ t("libras.empty") }}</p>
      </div>
    </div>
  </ModuleContainer>
</template>

<script setup lang="ts">
import Icon from "@/components/Icon.vue";
import { LjProgress } from "@/components/ui";
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import ModuleContainer from "@/components/ModuleContainer.vue";
import { ICONS } from "@/config/Icons";
import { module as manifest } from "../manifest";
import { useLibras } from "../composables/useLibras";
import Modules from "@/helpers/Modules";

const { t } = useI18n();
const moduleContainer = ref<InstanceType<typeof ModuleContainer> | null>(null);

const { gloss, originalText, isTranslating, clear } = useLibras();

function close(): void {
  clear();
  Modules.close("libras");
}
</script>

<style scoped>
.libras-root {
  padding: 12px;
  min-height: 200px;
}

.libras-translating {
  margin-bottom: 8px;
}

.libras-original,
.libras-gloss {
  margin-bottom: 12px;
}

.libras-label {
  font-size: 0.75em;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  opacity: 0.6;
  margin-bottom: 4px;
}

.libras-text {
  font-size: 0.95em;
  line-height: 1.5;
  white-space: pre-wrap;
}

.libras-text--gloss {
  font-weight: 600;
  color: var(--lj-ui-accent);
}

.libras-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--lj-space-4);
  min-height: 150px;
  opacity: 0.5;
}

/* O reset do Vuetify zerava a margem de <p>; sem ele o parágrafo empurraria
   o ícone para fora do centro. */
.libras-empty p {
  margin: 0;
}
</style>
