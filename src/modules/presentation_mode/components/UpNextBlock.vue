<template>
  <footer class="pm-upnext" :class="{ 'pm-upnext--flash': flash }" data-testid="pm-upnext">
    <div class="pm-upnext__head">
      <span class="pm-upnext__label">
        {{ prepared ? tm("outputs.prepared") : tm("upnext.title") }}
      </span>
      <span v-if="positionLabel" class="pm-upnext__position" data-testid="pm-upnext-position">
        {{ positionLabel }}
      </span>
    </div>
    <div v-if="upNext" class="pm-upnext__body">
      <span class="pm-upnext__icon"><LjIcon :icon="KIND_ICONS[upNext.kind]" :size="18" /></span>
      <div class="pm-upnext__text">
        <span class="pm-upnext__name">{{ upNext.title }}</span>
        <span class="pm-upnext__meta">{{ meta }}</span>
      </div>
    </div>
    <p v-else class="pm-upnext__empty">{{ tm("outputs.nothing_next") }}</p>
    <div class="pm-upnext__actions">
      <LjButton
        icon-only
        :variant="locked ? 'danger' : 'default'"
        :icon="locked ? ICONS.ACTIONS.LOCK : ICONS.ACTIONS.LOCK_OPEN"
        :title="locked ? tm('upnext.unlock') : tm('upnext.lock')"
        :aria-pressed="locked"
        data-testid="pm-upnext-lock"
        @click="emit('toggle-lock')"
      />
      <LjButton
        :icon="ICONS.UI.ARROW_UP"
        :disabled="!previous || locked"
        :title="previous ? tm('upnext.previous_title', { title: previous.title }) : undefined"
        data-testid="pm-upnext-previous"
        @click="emit('previous')"
      >
        {{ tm("upnext.previous") }}
      </LjButton>
      <LjButton
        class="pm-upnext__send"
        variant="primary"
        :icon="ICONS.UI.ARROW_DOWN"
        :disabled="!upNext || locked"
        :title="tm('upnext.send_title')"
        data-testid="pm-upnext-send"
        @click="emit('send')"
      >
        {{ tm("upnext.send") }}
      </LjButton>
    </div>
  </footer>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { LjButton, LjIcon } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { ModuleEnum } from "@/enums/ModuleEnum";
import { useModuleI18n } from "@/composables/useModuleI18n";
import type { ProgramItem } from "@/types/Presentation";
import { KIND_ICONS } from "../program/kinds";
import { useProgram } from "../composables/useProgram";
import { formatDuration } from "../program/time";

/**
 * Pé da coluna do programa: o próximo item, voltar ao anterior e enviar o
 * próximo. Passar de item é só aqui (e no Enter) — o passador anda pelas
 * partes do que está no ar e não pula de item sozinho.
 */

const props = defineProps<{
  upNext: ProgramItem | null;
  previous: ProgramItem | null;
  meta: string;
  /** O item é o que ficou na fila com a saída travada. */
  prepared: boolean;
  locked: boolean;
  /** Pisca quando a última parte do que está no ar passou. */
  flash: boolean;
}>();

const emit = defineEmits<{ send: []; previous: []; "toggle-lock": [] }>();

const { tm } = useModuleI18n(ModuleEnum.PRESENTATION_MODE);
const { items } = useProgram();

/** "5 de 10 · 1h02m restantes": onde o próximo cai e quanto do programa falta. */
const positionLabel = computed(() => {
  const list = items.value;
  const i = props.upNext ? list.findIndex((item) => item.id === props.upNext!.id) : -1;
  if (i < 0) return "";
  const left = list.slice(i).reduce((sum, item) => sum + (Number(item.plannedMinutes) || 0), 0);
  return tm("upnext.position", { n: i + 1, total: list.length, left: formatDuration(left) });
});
</script>

<style scoped>
.pm-upnext {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  flex-shrink: 0;
  background: var(--lj-surface-bg-soft);
  border-top: 1px solid var(--lj-surface-border);
  transition: background 200ms var(--lj-ease);
}

.pm-upnext--flash {
  background: var(--lj-live-active-bg);
}

.pm-upnext__head {
  display: flex;
  align-items: center;
  gap: 6px;
}

.pm-upnext__label {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  color: var(--lj-text-subtle);
}

.pm-upnext__position {
  margin-left: auto;
  font-family: var(--lj-font-mono);
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
  color: var(--lj-text-subtle);
  white-space: nowrap;
}

.pm-upnext__body {
  display: flex;
  align-items: center;
  gap: 8px;
}

.pm-upnext__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  border-radius: var(--lj-radius-sm);
  background: var(--lj-live-stage-bg);
  color: var(--lj-orange);
}

.pm-upnext__text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.pm-upnext__name {
  font-weight: var(--lj-weight-semibold);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pm-upnext__meta {
  font-size: 10.5px;
  color: var(--lj-text-subtle);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pm-upnext__empty {
  margin: 0;
  font-size: 11px;
  color: var(--lj-text-subtle);
}

.pm-upnext__actions {
  display: flex;
  gap: 4px;
}

.pm-upnext__send {
  flex: 1;
}
</style>
