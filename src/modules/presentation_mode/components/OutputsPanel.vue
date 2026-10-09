<template>
  <aside class="pm-outputs" data-testid="pm-outputs">
    <div class="pm-outputs__top">
      <!-- Geral: liga as duas telas; parar pede um segundo clique. -->
      <ScreenToggle
        :on="showing"
        :busy="busy"
        :label="tm('outputs.presentation')"
        :text="{ on: tm('outputs.stop'), off: tm('outputs.start') }"
        testid="pm-outputs-toggle"
        @change="(on: boolean) => (on ? start() : stop())"
      />
      <LjButton
        size="lg"
        icon-only
        :variant="cleared ? 'primary' : 'default'"
        :icon="ICONS.PROJECTION.CLEAN"
        :title="cleared ? tm('outputs.restore') : tm('outputs.clear')"
        :aria-pressed="cleared"
        data-testid="pm-outputs-clear"
        @click="toggleCleared"
      />
      <!-- "Identificar monitores" está no menu do monitor de cada tela. -->
      <LayersPanel />
    </div>

    <section class="pm-outputs__section">
      <!-- Cada tela: liga/desliga, nome e monitor (opção) — acima da miniatura dela. -->
      <header class="pm-outputs__label">
        <ScreenToggle
          :on="screenOn.main"
          :busy="busy"
          :label="tm('outputs.main_screen')"
          testid="pm-screen-main"
          @change="(on: boolean) => setScreen('main', on)"
        />
        <span class="pm-outputs__live" :class="{ 'pm-outputs__live--off': !screenOn.main }">
          <span class="pm-outputs__dot" />
          {{ tm("outputs.main_screen") }}
        </span>
        <LjMenu :items="mainRole.items.value" align="end">
          <template #trigger>
            <button type="button" class="pm-outputs__monitor" data-testid="pm-monitor-main">
              {{ mainRole.monitorLabel.value }}
              <LjIcon :icon="ICONS.UI.CHEVRON_DOWN" :size="11" />
            </button>
          </template>
        </LjMenu>
      </header>
      <button
        v-if="mainMissing && mainMonitor !== null"
        type="button"
        class="pm-outputs__missing"
        data-testid="pm-outputs-main-missing"
        @click="reopen()"
      >
        {{ tm("outputs.missing_main") }}
      </button>
      <!-- O som que sai do computador fica encostado na tela principal, como no FreeShow. -->
      <div class="pm-outputs__screen-row">
        <div
          class="pm-outputs__screen"
          role="button"
          tabindex="0"
          :title="tm('zoom.open')"
          data-testid="pm-zoom-main"
          @click="zoomed = 'main'"
          @keydown.enter="zoomed = 'main'"
        >
          <LiveMirror :cleared="cleared" />
          <!-- A tela não está desligada: só não está apresentando. A prévia continua à vista. -->
          <span v-if="!screenOn.main" class="pm-outputs__idle" data-testid="pm-outputs-main-off">
            {{ tm("outputs.not_presenting") }}
          </span>
          <span
            v-else-if="mainMissing"
            class="pm-outputs__closed"
            data-testid="pm-outputs-main-closed"
          >
            {{ tm("outputs.screen_closed") }}
          </span>
        </div>
        <AudioMeter />
      </div>
      <div class="pm-outputs__nav">
        <LjButton
          icon-only
          :icon="ICONS.PLAYER.PAGE_FIRST"
          :title="tm('outputs.first')"
          :disabled="!canNavigate"
          @click="emit('first')"
        />
        <LjButton
          icon-only
          :icon="ICONS.ACTIONS.PREVIOUS"
          :title="tm('outputs.previous')"
          :disabled="!canNavigate"
          @click="emit('prev')"
        />
        <LjButton
          icon-only
          :variant="locked ? 'danger' : 'default'"
          :icon="locked ? ICONS.ACTIONS.LOCK : ICONS.ACTIONS.LOCK_OPEN"
          :title="locked ? tm('ribbon.btn.unlock_output') : tm('ribbon.btn.lock_output')"
          :aria-pressed="locked"
          data-testid="pm-outputs-lock"
          @click="emit('toggle-lock')"
        />
        <LjButton
          class="pm-outputs__next"
          variant="primary"
          :icon="ICONS.ACTIONS.NEXT"
          :disabled="locked"
          data-testid="pm-outputs-next"
          @click="emit('next')"
        >
          {{ tm("outputs.next") }}
        </LjButton>
        <LjButton
          icon-only
          :icon="ICONS.PLAYER.PAGE_LAST"
          :title="tm('outputs.last')"
          :disabled="!canNavigate"
          @click="emit('last')"
        />
      </div>
      <LjButton
        class="pm-outputs__take-off"
        :icon="ICONS.PLAYER.STOP_CIRCLE"
        :disabled="!onAir"
        :title="tm('outputs.take_off_title')"
        data-testid="pm-outputs-take-off"
        @click="emit('take-off')"
      >
        {{ tm("outputs.take_off") }}
      </LjButton>
    </section>

    <section class="pm-outputs__section">
      <header class="pm-outputs__label">
        <ScreenToggle
          :on="screenOn.stage"
          :busy="busy"
          :label="tm('outputs.stage_return')"
          testid="pm-screen-stage"
          @change="(on: boolean) => setScreen('stage', on)"
        />
        <span class="pm-outputs__live" :class="{ 'pm-outputs__live--off': !screenOn.stage }">
          <span class="pm-outputs__dot" />
          {{ tm("outputs.stage_return") }}
        </span>
        <LjMenu :items="stageRole.items.value" align="end">
          <template #trigger>
            <button type="button" class="pm-outputs__monitor" data-testid="pm-monitor-stage">
              {{ stageRole.monitorLabel.value }}
              <LjIcon :icon="ICONS.UI.CHEVRON_DOWN" :size="11" />
            </button>
          </template>
        </LjMenu>
        <button
          v-if="stageMissing && stageMonitor !== null"
          type="button"
          class="pm-outputs__missing pm-outputs__missing--inline"
          data-testid="pm-outputs-stage-missing"
          @click="reopen()"
        >
          {{ tm("outputs.missing_stage") }}
        </button>
        <LjButton
          v-if="returnOverride"
          size="sm"
          variant="ghost"
          icon-only
          :icon="ICONS.ACTIONS.CLOSE"
          :title="tm('library.remove_from_return')"
          data-testid="pm-outputs-clear-return"
          @click="showOnReturn(null)"
        />
      </header>
      <div
        class="pm-outputs__screen"
        role="button"
        tabindex="0"
        :title="tm('zoom.open')"
        data-testid="pm-zoom-stage"
        @click="zoomed = 'stage'"
        @keydown.enter="zoomed = 'stage'"
      >
        <ReturnMirror
          :cleared="cleared"
          :up-next="upNext?.title ?? ''"
          :override="returnOverride"
        />
        <!-- A tela não está desligada: só não está apresentando. A prévia continua à vista. -->
        <span v-if="!screenOn.stage" class="pm-outputs__idle" data-testid="pm-outputs-stage-off">
          {{ tm("outputs.not_presenting") }}
        </span>
        <span
          v-else-if="stageMissing"
          class="pm-outputs__closed"
          data-testid="pm-outputs-stage-closed"
        >
          {{ tm("outputs.screen_closed") }}
        </span>
      </div>
    </section>

    <!-- Clique numa miniatura: a tela em tamanho cheio, para ver de perto. -->
    <ScreenZoom
      v-if="zoomed"
      :title="tm(zoomed === 'main' ? 'outputs.main_screen' : 'outputs.stage_return')"
      :size="zoomed === 'main' ? mainRole.size.value : stageRole.size.value"
      @close="zoomed = null"
    >
      <LiveMirror v-if="zoomed === 'main'" :cleared="cleared" />
      <ReturnMirror
        v-else
        :cleared="cleared"
        :up-next="upNext?.title ?? ''"
        :override="returnOverride"
      />
    </ScreenZoom>

    <footer class="pm-upnext" :class="{ 'pm-upnext--flash': flash }" data-testid="pm-upnext">
      <span class="pm-upnext__label">
        {{ prepared ? tm("outputs.prepared") : tm("outputs.up_next") }}
      </span>
      <div v-if="upNext" class="pm-upnext__body">
        <span class="pm-upnext__icon"><LjIcon :icon="KIND_ICONS[upNext.kind]" :size="18" /></span>
        <div class="pm-upnext__text">
          <span class="pm-upnext__name">{{ upNext.title }}</span>
          <span class="pm-upnext__meta">{{ upNextMeta }}</span>
        </div>
        <LjButton size="sm" :disabled="locked" data-testid="pm-upnext-send" @click="emit('send')">
          {{ tm("outputs.send") }}
        </LjButton>
      </div>
      <p v-else class="pm-upnext__empty">{{ tm("outputs.nothing_next") }}</p>
    </footer>
  </aside>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { LjButton, LjIcon, LjMenu } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { ModuleEnum } from "@/enums/ModuleEnum";
import { useModuleI18n } from "@/composables/useModuleI18n";
import type { ProgramItem } from "@/types/Presentation";
import LiveMirror from "./LiveMirror.vue";
import ReturnMirror from "./ReturnMirror.vue";
import { returnOverride, showOnReturn, useOutputs } from "../composables/useOutputs";
import { KIND_ICONS } from "../program/kinds";
import { useMonitorRole } from "../composables/useMonitorRole";
import ScreenToggle from "./ScreenToggle.vue";
import ScreenZoom from "./ScreenZoom.vue";
import AudioMeter from "./AudioMeter.vue";
import LayersPanel from "./LayersPanel.vue";

defineProps<{
  upNext: ProgramItem | null;
  upNextMeta: string;
  /** O item de "A seguir" é o que foi enfileirado com a saída travada. */
  prepared: boolean;
  locked: boolean;
  canNavigate: boolean;
  /** Pisca "A seguir" quando o Próximo não tem mais parte para avançar. */
  flash: boolean;
  /** Há conteúdo no ar para tirar. */
  onAir: boolean;
}>();

const emit = defineEmits<{
  first: [];
  prev: [];
  next: [];
  last: [];
  "toggle-lock": [];
  send: [];
  "take-off": [];
}>();

const { tm } = useModuleI18n(ModuleEnum.PRESENTATION_MODE);
const {
  cleared,
  showing,
  busy,
  mainMonitor,
  stageMonitor,
  mainMissing,
  stageMissing,
  screenOn,
  setScreen,
  start,
  stop,
  reopen,
  toggleCleared,
} = useOutputs();
const zoomed = ref<"main" | "stage" | null>(null);
const mainRole = useMonitorRole("projection");
const stageRole = useMonitorRole("stage");
</script>

<style scoped>
.pm-outputs {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  background: var(--lj-surface-bg);
  border-left: 1px solid var(--lj-surface-border);
}

.pm-outputs__top {
  display: flex;
  gap: 6px;
  padding: 8px;
  flex-shrink: 0;
  background: var(--lj-surface-bg-soft);
  border-bottom: 1px solid var(--lj-surface-border);
}

.pm-outputs__show {
  flex: 1;
}

.pm-outputs__section {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--lj-surface-border);
}

.pm-outputs__label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  color: var(--lj-text-subtle);
}

.pm-outputs__live {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--lj-live-late-text);
}

.pm-outputs__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--lj-danger);
}

.pm-outputs__title {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

/* A miniatura mostra o que está no monitor: com a tela fechada, nada. */
.pm-outputs__screen {
  position: relative;
  cursor: zoom-in;
}

.pm-outputs__screen-row {
  display: flex;
  align-items: stretch;
  gap: 4px;
}

.pm-outputs__screen-row > .pm-outputs__screen {
  flex: 1;
  min-width: 0;
}

.pm-outputs__idle {
  position: absolute;
  top: 6px;
  left: 6px;
  padding: 1px 6px;
  border: 1px solid var(--lj-orange);
  border-radius: 3px;
  background: var(--lj-black-alpha-75);
  color: var(--lj-orange);
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.5px;
  pointer-events: none;
}

.pm-outputs__screen:has(.pm-outputs__idle) > :first-child {
  opacity: 0.55;
}

.pm-outputs__closed {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--lj-radius-sm);
  background: var(--lj-black-alpha-75);
  color: var(--lj-white);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.6px;
}

/* Tela que sumiu com a apresentação iniciada: o aviso já é o botão de reabrir. */
.pm-outputs__missing {
  padding: 4px 8px;
  border: 1px solid var(--lj-danger);
  border-radius: var(--lj-radius-sm);
  background: transparent;
  color: var(--lj-danger);
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
}

.pm-outputs__missing--inline {
  padding: 1px 6px;
  font-size: 10px;
}

/* Tela desligada: o nome recua, como o ponto vermelho que some. */
.pm-outputs__live--off {
  color: var(--lj-text-subtle);
}

.pm-outputs__live--off .pm-outputs__dot {
  background: var(--lj-text-subtle);
}

/* Monitor da tela: opção, no canto do cabeçalho, clicável. */
.pm-outputs__monitor {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  margin-left: auto;
  padding: 1px 4px;
  border: none;
  border-radius: var(--lj-radius-sm);
  background: transparent;
  color: var(--lj-text-subtle);
  font: inherit;
  font-weight: 400;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  cursor: pointer;
}

.pm-outputs__monitor:hover {
  background: var(--lj-white-alpha-08);
  color: var(--lj-text);
}

.pm-outputs__where {
  margin-left: auto;
  font-weight: 400;
  white-space: nowrap;
}

/* Vermelho no texto, não no fundo: o botão cheio de vermelho é o de parar tudo. */
.pm-outputs__take-off:not(:disabled) {
  color: var(--lj-danger);
}

.pm-outputs__nav {
  display: flex;
  gap: 4px;
}

.pm-outputs__nav > * {
  flex: 1;
}

.pm-outputs__nav > .pm-outputs__next {
  flex: 2;
}

.pm-upnext {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: auto;
  padding: 8px;
  flex-shrink: 0;
  background: var(--lj-surface-bg-soft);
  border-top: 1px solid var(--lj-surface-border);
  transition: background 200ms var(--lj-ease);
}

.pm-upnext--flash {
  background: var(--lj-live-active-bg);
}

.pm-upnext__label {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  color: var(--lj-text-subtle);
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
</style>
