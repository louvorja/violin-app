<template>
  <aside class="pm-outputs" data-testid="pm-outputs">
    <header class="pm-outputs__head">
      <LjIcon :icon="ICONS.PROJECTION.PRESENTATION" :size="14" class="pm-outputs__accent" />
      <span class="pm-outputs__title">{{ tm("outputs.column") }}</span>
      <span
        class="pm-outputs__state"
        :class="{ 'pm-outputs__state--on': showing }"
        data-testid="pm-outputs-state"
      >
        <span class="pm-outputs__dot" />
        {{ showing ? tm("outputs.state_on") : tm("outputs.state_off") }}
      </span>
    </header>

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
    </div>

    <div class="pm-outputs__scroll">
      <!-- Cada tela: liga/desliga, monitor (opção) e a miniatura do que ela mostra. -->
      <section class="pm-outputs__section">
        <header class="pm-outputs__label">
          <ScreenToggle
            :on="screenOn.main"
            :busy="busy"
            :label="tm('outputs.main_screen')"
            testid="pm-screen-main"
            @change="(on: boolean) => setScreen('main', on)"
          />
          <span class="pm-outputs__name">{{ tm("outputs.main_screen") }}</span>
          <span
            class="pm-outputs__live"
            :class="{ 'pm-outputs__live--off': !screenOn.main || !onAir }"
          >
            <span class="pm-outputs__dot" />
            {{
              !screenOn.main
                ? tm("outputs.screen_off")
                : onAir
                  ? tm("stage.on_air")
                  : tm("outputs.screen_idle")
            }}
          </span>
        </header>
        <LjMenu :items="mainRole.items.value" align="start">
          <template #trigger>
            <button type="button" class="pm-outputs__monitor" data-testid="pm-monitor-main">
              <LjIcon :icon="ICONS.PROJECTION.SCREEN_OUTLINE" :size="13" />
              <span class="pm-outputs__monitor-label">{{ mainRole.selectorLabel.value }}</span>
              <LjIcon :icon="ICONS.UI.CHEVRON_DOWN" :size="11" />
            </button>
          </template>
        </LjMenu>
        <button
          v-if="mainMissing && mainMonitor !== null"
          type="button"
          class="pm-outputs__missing"
          data-testid="pm-outputs-main-missing"
          @click="reopen()"
        >
          {{ tm("outputs.missing_main") }}
        </button>
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
          <!-- A tela real diverge do player: a miniatura não pode fingir que está tudo certo. -->
          <button
            v-if="truth.status.main"
            type="button"
            class="pm-outputs__desync"
            data-testid="pm-desync-main"
            :title="tm('desync.repair')"
            @click.stop="truth.repair('main')"
          >
            {{ tm(`desync.${truth.status.main}`) }}
          </button>
        </div>
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
          <span class="pm-outputs__name">{{ tm("outputs.stage_return") }}</span>
          <span
            class="pm-outputs__live"
            :class="{ 'pm-outputs__live--off': !screenOn.stage || !onAir }"
          >
            <span class="pm-outputs__dot" />
            {{
              !screenOn.stage
                ? tm("outputs.screen_off")
                : onAir
                  ? tm("stage.on_air")
                  : tm("outputs.screen_idle")
            }}
          </span>
        </header>
        <LjMenu :items="stageRole.items.value" align="start">
          <template #trigger>
            <button type="button" class="pm-outputs__monitor" data-testid="pm-monitor-stage">
              <LjIcon :icon="ICONS.PROJECTION.RETURN" :size="13" />
              <span class="pm-outputs__monitor-label">{{ stageRole.selectorLabel.value }}</span>
              <LjIcon :icon="ICONS.UI.CHEVRON_DOWN" :size="11" />
            </button>
          </template>
        </LjMenu>
        <button
          v-if="stageMissing && stageMonitor !== null"
          type="button"
          class="pm-outputs__missing"
          data-testid="pm-outputs-stage-missing"
          @click="reopen()"
        >
          {{ tm("outputs.missing_stage_full") }}
        </button>
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
          <button
            v-if="truth.status.return"
            type="button"
            class="pm-outputs__desync"
            data-testid="pm-desync-stage"
            :title="tm('desync.repair')"
            @click.stop="truth.repair('return')"
          >
            {{ tm(`desync.${truth.status.return}`) }}
          </button>
        </div>
        <!-- O que o retorno mostra, por tipo: desligado, ele fica no fundo enquanto o tipo está no ar. -->
        <div class="pm-outputs__shows" data-testid="pm-return-shows">
          <span class="pm-outputs__shows-label">{{ tm("return_control.shows") }}</span>
          <button
            v-for="group in RETURN_GROUPS"
            :key="group"
            type="button"
            class="pm-outputs__chip"
            :class="{ 'pm-outputs__chip--live': group === liveGroup }"
            :aria-pressed="!visibility.isHidden(group)"
            :data-testid="`pm-return-show-${group}`"
            @click="visibility.setHidden(group, !visibility.isHidden(group))"
          >
            <LjChip
              size="sm"
              :variant="visibility.isHidden(group) ? 'neutral' : 'primary'"
              :icon="visibility.isHidden(group) ? undefined : ICONS.UI.CHECK"
            >
              {{ tm(`return_control.groups.${group}`) }}
            </LjChip>
          </button>
        </div>
      </section>

      <!-- No ar agora: cada camada com o seu X — nada tocando fica fora da vista. -->
      <section class="pm-outputs__layers" data-testid="pm-layers-list">
        <span class="pm-outputs__cap">{{ tm("layers.title") }}</span>
        <div
          v-for="layer in layers"
          :key="layer.id"
          class="pm-outputs__layer"
          :class="{ 'pm-outputs__layer--busy': layer.title }"
        >
          <LjIcon :icon="LAYER_ICONS[layer.id]" :size="14" />
          <span class="pm-outputs__layer-name">{{ tm(`layers.${layer.id}`) }}</span>
          <span
            class="pm-outputs__layer-what"
            :title="layer.title"
            :data-testid="`pm-layer-${layer.id}`"
          >
            {{ layer.title || tm("layers.empty") }}
          </span>
          <LjButton
            v-if="layer.title"
            size="sm"
            variant="ghost"
            icon-only
            :icon="ICONS.ACTIONS.CLOSE"
            :title="tm('layers.stop')"
            :data-testid="`pm-layer-stop-${layer.id}`"
            @click="layer.stop()"
          />
        </div>
      </section>
    </div>

    <footer class="pm-outputs__foot">
      <LjButton
        size="sm"
        variant="ghost"
        :icon="ICONS.UI.MONITORS"
        data-testid="pm-outputs-identify"
        @click="mainRole.identify()"
      >
        {{ tm("outputs.identify") }}
      </LjButton>
    </footer>

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
  </aside>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { LjButton, LjChip, LjIcon, LjMenu } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { ModuleEnum } from "@/enums/ModuleEnum";
import { useModuleI18n } from "@/composables/useModuleI18n";
import type { ProgramItem } from "@/types/Presentation";
import LiveMirror from "./LiveMirror.vue";
import ReturnMirror from "./ReturnMirror.vue";
import { returnOverride, useOutputs } from "../composables/useOutputs";
import { useMonitorRole } from "../composables/useMonitorRole";
import ScreenToggle from "./ScreenToggle.vue";
import ScreenZoom from "./ScreenZoom.vue";
import { useScreenTruth } from "../composables/useScreenTruth";
import { useLayers, type LayerId } from "../composables/useLayers";
import type { LiveKind } from "../composables/useLiveContent";
import {
  RETURN_GROUPS,
  returnGroupOf,
  useReturnVisibility,
} from "../composables/useReturnVisibility";

/**
 * Coluna Apresentação: só o que é das telas — ligar e desligar, em qual
 * monitor fica cada uma, o que cada uma mostra e o que está no ar. Passar
 * slide é da barra do centro; passar de item, da coluna do programa.
 */

const props = defineProps<{
  /** O próximo item do programa, que o retorno mostra embaixo. */
  upNext: ProgramItem | null;
  liveKind: LiveKind | null;
  /** Há conteúdo no ar (na tela ou só tocando). */
  onAir: boolean;
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
// O que as telas reais estão fazendo de fato, comparado com o player.
const truth = useScreenTruth();
const mainRole = useMonitorRole("projection");
const stageRole = useMonitorRole("stage");

const visibility = useReturnVisibility();
const liveGroup = computed(() => returnGroupOf(props.liveKind));

const { layers } = useLayers();
const LAYER_ICONS: Record<LayerId, string> = {
  screen: ICONS.PROJECTION.SCREEN_OUTLINE,
  return: ICONS.PROJECTION.RETURN,
  audio: ICONS.MUSIC.AUDIO,
};
</script>

<style scoped>
.pm-outputs {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--lj-surface-bg);
  border-left: 1px solid var(--lj-surface-border);
}

.pm-outputs__head {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 8px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--lj-surface-border);
}

.pm-outputs__accent {
  color: var(--lj-orange);
}

.pm-outputs__title {
  font-weight: var(--lj-weight-semibold);
}

.pm-outputs__state {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
  padding: 1px 6px;
  border: 1px solid var(--lj-surface-border);
  border-radius: 3px;
  color: var(--lj-text-subtle);
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.5px;
}

.pm-outputs__state--on {
  border-color: transparent;
  background: var(--lj-danger);
  color: var(--lj-white);
}

.pm-outputs__state .pm-outputs__dot {
  background: currentColor;
}

.pm-outputs__top {
  display: flex;
  gap: 6px;
  padding: 8px;
  flex-shrink: 0;
  background: var(--lj-surface-bg-soft);
  border-bottom: 1px solid var(--lj-surface-border);
}

.pm-outputs__scroll {
  flex: 1;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
}

.pm-outputs__section {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border-bottom: 1px solid var(--lj-surface-border);
}

.pm-outputs__label {
  display: flex;
  align-items: center;
  gap: 8px;
}

.pm-outputs__name {
  font-weight: var(--lj-weight-semibold);
}

.pm-outputs__live {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.5px;
  color: var(--lj-live-late-text);
}

.pm-outputs__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--lj-danger);
}

/* Tela desligada ou sem nada no ar: o selo recua, como o ponto vermelho que some. */
.pm-outputs__live--off {
  color: var(--lj-text-subtle);
}

.pm-outputs__live--off .pm-outputs__dot {
  background: var(--lj-text-subtle);
}

/* Monitor da tela: opção, com cara de seletor. */
.pm-outputs__monitor {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  height: var(--lj-ui-h-sm, 24px);
  padding: 0 8px;
  border: var(--lj-ui-border);
  border-radius: var(--lj-ui-radius);
  background: var(--lj-surface-bg-soft);
  color: var(--lj-text);
  font-size: 11.5px;
  cursor: pointer;
}

.pm-outputs__monitor:hover {
  background: var(--lj-surface-bg-active);
}

.pm-outputs__monitor:focus-visible {
  outline: none;
  box-shadow: var(--lj-ui-focus);
}

.pm-outputs__monitor-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* A miniatura mostra o que está no monitor: com a tela fechada, nada. */
.pm-outputs__screen {
  position: relative;
  cursor: zoom-in;
}

.pm-outputs__desync {
  position: absolute;
  inset: auto 6px 6px;
  z-index: 2;
  padding: 4px 6px;
  border: none;
  border-radius: 3px;
  background: var(--lj-danger);
  color: var(--lj-white);
  font-size: 10px;
  font-weight: 700;
  line-height: 1.25;
  text-align: left;
  cursor: pointer;
  animation: pm-desync-blink 1s steps(2, start) infinite;
}

@keyframes pm-desync-blink {
  to {
    opacity: 0.55;
  }
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

.pm-outputs__shows {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
}

.pm-outputs__shows-label {
  margin-right: 2px;
  font-size: 10.5px;
  color: var(--lj-text-subtle);
}

.pm-outputs__chip {
  display: inline-flex;
  padding: 0;
  border: none;
  border-radius: var(--lj-radius-xs);
  background: transparent;
  cursor: pointer;
}

.pm-outputs__chip:focus-visible {
  outline: none;
  box-shadow: var(--lj-ui-focus);
}

/* O tipo que está no ar agora: é o que o operador quer achar com pressa. */
.pm-outputs__chip--live {
  box-shadow: 0 0 0 1px var(--lj-orange);
}

.pm-outputs__layers {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px;
}

.pm-outputs__cap {
  padding-bottom: 2px;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  color: var(--lj-text-subtle);
}

.pm-outputs__layer {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 28px;
  padding: 0 4px;
  border-radius: var(--lj-radius-sm);
  color: var(--lj-text-subtle);
}

.pm-outputs__layer--busy {
  color: var(--lj-text);
  background: var(--lj-white-alpha-08);
}

.pm-outputs__layer-name {
  width: 58px;
  flex-shrink: 0;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.4px;
}

.pm-outputs__layer-what {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pm-outputs__foot {
  display: flex;
  gap: 4px;
  padding: 6px 8px;
  flex-shrink: 0;
  border-top: 1px solid var(--lj-surface-border);
  background: var(--lj-surface-bg-soft);
}
</style>
