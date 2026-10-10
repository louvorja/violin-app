<template>
  <span class="pm-stoggle" :class="{ 'pm-stoggle--wide': !!text }">
    <LjButton
      :size="text ? 'lg' : 'sm'"
      :icon-only="!text"
      :block="!!text"
      :variant="on ? 'danger' : 'default'"
      :icon="on ? ICONS.ACTIONS.CLOSE : ICONS.PROJECTION.START"
      :loading="busy"
      :title="title"
      :aria-label="title"
      :aria-pressed="on"
      :class="{ 'pm-stoggle__btn--armed': armed }"
      :data-testid="testid"
      @click="onClick"
    >
      <template v-if="text">
        {{ armed ? tm("outputs.confirm_stop") : on ? text.on : text.off }}
      </template>
    </LjButton>
    <!-- Parar pede um segundo clique: um toque errado não apaga o telão no meio do culto. -->
    <span v-if="armed && !text" class="pm-stoggle__hint" role="status">
      {{ tm("outputs.confirm_stop") }}
    </span>
  </span>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import { LjButton } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { ModuleEnum } from "@/enums/ModuleEnum";
import { useModuleI18n } from "@/composables/useModuleI18n";

/**
 * Liga e desliga a apresentação (todas as telas) ou uma tela só, como no
 * FreeShow: desligado, o ícone de apresentar; ligado, um X vermelho. Ligar é
 * um clique; parar, dois — o primeiro avisa "clique novamente para parar".
 */

const props = withDefaults(
  defineProps<{
    on: boolean;
    busy?: boolean;
    /** O que liga ("a tela principal", "a apresentação"), para o título. */
    label: string;
    /** Com texto ao lado do ícone (o botão geral). */
    text?: { on: string; off: string };
    testid?: string;
  }>(),
  { busy: false, text: undefined, testid: undefined }
);

const emit = defineEmits<{ change: [on: boolean] }>();

const { tm } = useModuleI18n(ModuleEnum.PRESENTATION_MODE);

/** Tempo que o segundo clique vale. */
const CONFIRM_MS = 3000;
const armed = ref(false);
let timer: ReturnType<typeof setTimeout> | null = null;

function disarm(): void {
  armed.value = false;
  if (timer) clearTimeout(timer);
  timer = null;
}

function onClick(): void {
  if (!props.on) {
    disarm();
    emit("change", true);
    return;
  }
  if (armed.value) {
    disarm();
    emit("change", false);
    return;
  }
  armed.value = true;
  timer = setTimeout(disarm, CONFIRM_MS);
}

onBeforeUnmount(disarm);

const title = computed(() =>
  props.on
    ? tm("outputs.stop_target", { target: props.label })
    : tm("outputs.start_target", { target: props.label })
);
</script>

<style scoped>
.pm-stoggle {
  position: relative;
  display: inline-flex;
}

.pm-stoggle--wide {
  flex: 1;
}

/* Primeiro clique para parar: o botão pulsa, e o próximo clique confirma. */
.pm-stoggle__btn--armed {
  animation: pm-stoggle-armed 0.6s ease-in-out infinite alternate;
}

@keyframes pm-stoggle-armed {
  to {
    filter: brightness(1.3);
  }
}

.pm-stoggle__hint {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 5;
  padding: 3px 8px;
  border: 1px solid var(--lj-danger);
  border-radius: var(--lj-radius-sm);
  background: var(--lj-surface-bg);
  color: var(--lj-text);
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
  pointer-events: none;
}
</style>
