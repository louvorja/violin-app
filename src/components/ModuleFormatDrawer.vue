<template>
  <Transition name="module-format-drawer">
    <aside v-show="model" class="module-format-drawer">
      <div class="module-format-drawer__header">
        <span class="module-format-drawer__title">{{ t("components.customization.title") }}</span>
        <LjButton
          variant="default"
          size="sm"
          :icon="ICONS.ACTIONS.RESTORE"
          class="module-format-drawer__restore"
          :title="t('components.customization.restore')"
          icon-only
          @click="restoreFormat()"
        />
      </div>
      <div class="module-format-drawer__body">
        <FormatPanel :module-id="moduleId" :manifest="manifest" />
      </div>
    </aside>
  </Transition>
</template>

<script setup lang="ts">
import { LjButton } from "@/components/ui";
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import FormatPanel from "@/components/FormatPanel.vue";
import { useModuleFormat } from "@/composables/useModuleFormat";
import { ICONS } from "@/config/Icons";
import type { Module } from "@/types/Module";

const props = defineProps<{
  modelValue: boolean;
  moduleId: string;
  manifest: Module;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
}>();

const { t } = useI18n();
const { restoreFormat } = useModuleFormat(props.moduleId, props.manifest);

const model = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit("update:modelValue", v),
});
</script>

<style scoped>
/* Sobrepõe a coluna esquerda do módulo em vez de empurrá-la: fica preso ao
   ancestral posicionado da tela que o hospeda (.bible-layout, .module-embedded)
   e não reserva espaço no fluxo. */
.module-format-drawer {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  z-index: 10;
  display: flex;
  flex-direction: column;
  width: 220px;
  max-width: 100%;
  border-right: 1px solid var(--lj-surface-border);
  background: var(--lj-surface-bg);
  color: var(--lj-text);
  box-shadow: var(--lj-shadow-2);
  overflow: clip;
}

.module-format-drawer__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex: none;
  padding: 4px 8px 4px 12px;
  border-bottom: 1px solid var(--lj-surface-border);
  background: var(--lj-surface-bg-soft, #eee);
}

.module-format-drawer__title {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  color: var(--lj-text-muted, #666);
}

.module-format-drawer__restore {
  color: var(--lj-text-muted, #666);
}

/* Dá altura definida ao FormatPanel (que é `height: 100%`), para ele rolar
   dentro da coluna em vez de empurrar o cabeçalho para fora. */
.module-format-drawer__body {
  flex: 1;
  min-height: 0;
}

/* 0,35s é a duração que o painel tinha em vuetify-overrides.css — mais lenta
   que a das camadas flutuantes de propósito, porque o percurso é a largura
   inteira da coluna. */
.module-format-drawer-enter-active,
.module-format-drawer-leave-active {
  transition: transform 0.35s var(--lj-ease);
}

.module-format-drawer-enter-from,
.module-format-drawer-leave-to {
  transform: translateX(-100%);
}

@media (prefers-reduced-motion: reduce) {
  .module-format-drawer-enter-active,
  .module-format-drawer-leave-active {
    transition: none;
  }
}
</style>
