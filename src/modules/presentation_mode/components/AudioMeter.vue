<template>
  <div
    class="pm-audio-meter"
    :title="active ? tm('audio_meter.live') : tm('audio_meter.silent')"
    data-testid="pm-audio-meter"
    :data-active="active"
  >
    <LjLevelMeter
      orientation="vertical"
      :levels="levels"
      :peaks="peaks"
      :disabled="!active"
      :thickness="4"
      :aria-label="tm('audio_meter.label')"
    />
  </div>
</template>

<script setup lang="ts">
import { onMounted } from "vue";
import { LjLevelMeter } from "@/components/ui";
import { ModuleEnum } from "@/enums/ModuleEnum";
import { useModuleI18n } from "@/composables/useModuleI18n";
import { useAudioMeter } from "../composables/useAudioMeter";
import { useReturnPlayer } from "../composables/useReturnPlayer";

/**
 * O som que está saindo do computador, como o medidor de uma mesa, encostado
 * na tela principal: o operador vê de relance que há áudio rolando (ou que
 * deveria haver e não há). Só mostra — volume e mudo continuam nos controles
 * de cada mídia.
 */

const { tm } = useModuleI18n(ModuleEnum.PRESENTATION_MODE);
const returnPlayer = useReturnPlayer();

const { levels, peaks, active, start } = useAudioMeter([
  // O player do app (música, vídeo, "só áudio"); o id é dele, em useAudioPlayback.
  () => document.getElementById("__audio") as HTMLMediaElement | null,
  // O vídeo que está só no retorno, tocado com som aqui.
  () => returnPlayer.element(),
]);

onMounted(start);
</script>

<style scoped>
.pm-audio-meter {
  display: flex;
  flex-shrink: 0;
  padding: 1px 0;
}
</style>
