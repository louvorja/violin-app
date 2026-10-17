<template>
  <div class="pgb">
    <div class="pgb__head">
      <span v-if="$slots.label" class="pgb__label"><slot name="label" /></span>
      <span v-else-if="total > 0" class="pgb__label">{{ done }}/{{ total }} ({{ percent }}%)</span>
      <span v-if="etaText" class="pgb__eta">{{ etaText }}</span>
    </div>

    <LjProgress :value="percent" :height="8" />

    <div v-if="current || showCancel" class="pgb__foot">
      <span class="pgb__current" :title="current || undefined">{{ current }}</span>
      <LjButton
        v-if="showCancel"
        class="pgb__cancel"
        size="sm"
        variant="danger"
        :icon="cancelIcon"
        @click="$emit('cancel')"
      >
        {{ cancelLabel }}
      </LjButton>
    </div>

    <slot />

    <div v-if="failed > 0" class="opt-hint">
      <slot name="failed">{{ failed }} falha(s)</slot>
    </div>

    <div v-if="completedMsg" class="opt-folder-path">
      {{ completedMsg }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { ICONS } from "@/config/Icons";
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { createEtaEstimator, formatEta } from "@/helpers/Eta";
import LjButton from "@/components/ui/LjButton.vue";
import LjProgress from "@/components/ui/LjProgress.vue";

const props = withDefaults(
  defineProps<{
    done?: number;
    total?: number;
    current?: string | null;
    failed?: number;
    completedMsg?: string;
    showCancel?: boolean;
    cancelIcon?: string;
    cancelLabel?: string;
  }>(),
  {
    done: 0,
    total: 0,
    current: "",
    failed: 0,
    completedMsg: "",
    showCancel: false,
    cancelIcon: ICONS.ACTIONS.CANCEL,
    cancelLabel: "Cancelar",
  }
);

defineEmits<{ cancel: [] }>();

const percent = computed(() =>
  props.total > 0 ? Math.round((props.done / props.total) * 100) : 0
);

// Tempo restante pelo ritmo de arquivos concluídos. Vale para qualquer tela que
// use a barra, sem depender de a tarefa existir no painel de processos.
const { t } = useI18n();
const estimator = createEtaEstimator();
const etaSeconds = ref<number | null>(null);

watch(
  () => [props.done, props.total],
  () => {
    if (props.total <= 0) {
      etaSeconds.value = null;
      return;
    }
    const now = Date.now();
    estimator.push(now, Math.min(100, (props.done / props.total) * 100));
    etaSeconds.value = estimator.eta(now);
  },
  { immediate: true }
);

const etaText = computed(() => {
  if (props.completedMsg || etaSeconds.value === null || etaSeconds.value <= 0) return "";
  return t("shell.background_tasks.eta", { time: formatEta(etaSeconds.value) });
});
</script>

<style scoped>
.pgb {
  display: flex;
  flex-direction: column;
  /* Quem usa a barra costuma passar `opt-row--col`, que alinha os filhos ao
     início e os encolhe ao conteúdo: o botão acabava colado ao nome do arquivo
     e andava junto com ele. Aqui cada linha ocupa a largura toda. */
  align-items: stretch;
  gap: var(--lj-space-3);
  width: 100%;
}

/* Percentual à esquerda, tempo restante à direita: uma linha só, sem pular. */
.pgb__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--lj-space-4);
  min-height: 1.5em;
}

.pgb__label {
  color: var(--lj-text);
  font-weight: var(--lj-weight-medium);
  font-variant-numeric: tabular-nums;
}

.pgb__eta {
  flex: 0 0 auto;
  color: var(--lj-text-muted);
  font-size: var(--lj-text-sm);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

/* Arquivo atual à esquerda (corta com reticências) e o botão à direita. */
.pgb__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--lj-space-4);
  min-width: 0;
}

.pgb__current {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  color: var(--lj-text-subtle);
  font-size: var(--lj-text-sm);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pgb__cancel {
  flex: 0 0 auto;
}
</style>
