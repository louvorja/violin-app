<template>
  <TabsRoot v-model="model" class="lj-tabs">
    <TabsList class="lj-tabs__list" :aria-label="ariaLabel">
      <TabsIndicator class="lj-tabs__indicator" />
      <TabsTrigger v-for="tab in tabs" :key="tab.value" class="lj-tabs__trigger" :value="tab.value">
        <Icon v-if="tab.icon" :icon="tab.icon" :size="14" />
        {{ tab.label }}
        <LjChip v-if="tab.badge !== undefined" size="sm">{{ tab.badge }}</LjChip>
      </TabsTrigger>
    </TabsList>
    <slot />
  </TabsRoot>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { TabsIndicator, TabsList, TabsRoot, TabsTrigger } from "reka-ui";
import Icon from "@/components/Icon.vue";
import LjChip from "./LjChip.vue";

export interface LjTab {
  value: string;
  label: string;
  icon?: string;
  badge?: string | number;
}

const props = defineProps<{ modelValue?: string; tabs: LjTab[]; ariaLabel?: string }>();
const emit = defineEmits<{ "update:modelValue": [value: string] }>();

// O TabsRoot do Reka decide uma única vez, no setup, se é controlado — olhando
// se modelValue veio undefined. Passar a prop crua tem dois modos de falha: sem
// v-model as abas nem trocam, e um v-model preenchido depois deixa o componente
// presa em modo não controlado, com a aba visível divergindo do modelo.
//
// Aqui ele sempre recebe um valor definido, e a autoridade é decidida a cada
// leitura: quem passa v-model manda; quem não passa deixa o componente
// se virar sozinho.
const interno = ref(props.tabs[0]?.value);

const controlado = computed(() => props.modelValue !== undefined);

const model = computed({
  get: () => (controlado.value ? props.modelValue : interno.value),
  set: (value) => {
    interno.value = value as string;
    emit("update:modelValue", value as string);
  },
});
</script>

<style scoped>
.lj-tabs {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.lj-tabs__list {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--lj-space-1);
  border-bottom: 1px solid var(--lj-surface-border);
}

.lj-tabs__trigger {
  display: inline-flex;
  align-items: center;
  gap: var(--lj-space-3);
  height: var(--lj-tab-height);
  padding-inline: var(--lj-space-5);
  background: transparent;
  border: none;
  color: var(--lj-text-muted);
  font: inherit;
  font-size: var(--lj-text-base);
  cursor: pointer;
  outline: none;
  user-select: none;
}

.lj-tabs__trigger:hover {
  color: var(--lj-text);
}

.lj-tabs__trigger[data-state="active"] {
  color: var(--lj-ui-accent-text);
  font-weight: var(--lj-weight-semibold);
}

.lj-tabs__trigger:focus-visible {
  border-radius: var(--lj-radius-xs);
  box-shadow: var(--lj-ui-focus);
}

/* Sublinhado desliza entre as abas — o indicador do Vuetify vem com ripple
   e altura de 3px; aqui é um traço de 2px, sem efeito de toque. */
.lj-tabs__indicator {
  position: absolute;
  bottom: -1px;
  left: 0;
  height: 2px;
  width: var(--reka-tabs-indicator-size);
  transform: translateX(var(--reka-tabs-indicator-position));
  background: var(--lj-ui-accent);
  transition:
    transform var(--lj-transition-normal),
    width var(--lj-transition-normal);
}
</style>
