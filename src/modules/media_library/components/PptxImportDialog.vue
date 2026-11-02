<template>
  <LjDialog
    :model-value="!!state"
    size="md"
    :title="titulo"
    :icon="state?.phase === 'error' ? ICONS.UI.ALERT : ICONS.MODULES.MEDIA_LIBRARY"
    :icon-variant="
      state?.phase === 'error' ? 'danger' : state?.phase === 'done' ? 'success' : 'info'
    "
    @update:model-value="(v: boolean) => !v && emit('close')"
  >
    <div
      v-if="state"
      class="pptx-import"
      :class="{ 'pptx-import--drop': arrastando }"
      @dragover.prevent="arrastando = true"
      @dragleave="arrastando = false"
      @drop.prevent.stop="soltar"
    >
      <div class="pptx-import__file" :title="state.name">{{ state.name }}</div>

      <ol class="pptx-import__steps">
        <li :class="classeEtapa('fonts')">
          <LjSpinner v-if="state.phase === 'fonts'" :size="14" />
          <LjIcon v-else :icon="ICONS.UI.CHECK_CIRCLE" :size="16" />
          {{ tm("pptx.step_fonts") }}
        </li>
        <li :class="classeEtapa('converting')">
          <LjSpinner v-if="state.phase === 'converting'" :size="14" />
          <LjIcon v-else :icon="ICONS.UI.CHECK_CIRCLE" :size="16" />
          {{ tm("pptx.step_slides", { converter: state.converter || "PowerPoint" }) }}
          <span v-if="state.slidesTotal" class="pptx-import__count">
            {{ tm("pptx.slides_count", { done: state.slidesDone ?? 0, total: state.slidesTotal }) }}
          </span>
        </li>
        <li :class="classeEtapa('done')">
          <LjIcon :icon="ICONS.UI.CHECK_CIRCLE" :size="16" />
          {{ tm("pptx.step_done") }}
        </li>
      </ol>

      <LjProgress
        v-if="state.phase === 'converting' && state.slidesTotal"
        :value="(100 * (state.slidesDone ?? 0)) / state.slidesTotal"
      />
      <LjProgress
        v-else-if="state.phase === 'fonts' || state.phase === 'converting'"
        indeterminate
      />

      <p v-if="state.phase === 'error'" class="pptx-import__error">{{ state.error }}</p>

      <p v-if="state.phase === 'done' && resumoRecursos" class="pptx-import__rich">
        {{ resumoRecursos }}
      </p>

      <div class="pptx-import__fonts-title">{{ tm("pptx.fonts_title") }}</div>
      <p v-if="state.fontsError" class="pptx-import__error">
        {{ tm("pptx.fonts_error", { message: state.fontsError }) }}
      </p>
      <p v-if="state.phase === 'fonts' && !state.fonts.length" class="pptx-import__hint">
        {{ tm("pptx.checking_fonts") }}
      </p>
      <PptxFontList v-else :fonts="state.fonts" :tm="tm" />
      <template v-if="state.phase === 'done' && faltando">
        <p class="pptx-import__hint">{{ tm("pptx.missing_hint_drop") }}</p>
        <div>
          <LjButton
            size="sm"
            variant="subtle"
            :icon="ICONS.ACTIONS.UPLOAD"
            :disabled="regenerating"
            @click="emit('installFont')"
          >
            {{ tm("pptx.install_font") }}
          </LjButton>
        </div>
      </template>
    </div>

    <template #footer>
      <template v-if="state?.phase === 'done'">
        <LjButton size="sm" @click="emit('close')">{{ tm("pptx.close") }}</LjButton>
        <LjButton size="sm" variant="primary" :icon="ICONS.PLAYER.PLAY" @click="emit('project')">
          {{ tm("pptx.open_presentation") }}
        </LjButton>
      </template>
      <template v-else-if="state?.phase === 'error'">
        <template v-if="state.macPermission">
          <LjButton size="sm" variant="subtle" @click="emit('openPermissionSettings')">
            {{ tm("pptx.open_settings") }}
          </LjButton>
          <LjButton size="sm" variant="primary" @click="emit('retry')">
            {{ tm("pptx.retry") }}
          </LjButton>
        </template>
        <LjButton size="sm" @click="emit('close')">{{ tm("pptx.close") }}</LjButton>
      </template>
      <LjButton v-else size="sm" @click="emit('close')">{{ tm("pptx.background") }}</LjButton>
    </template>
  </LjDialog>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { LjButton, LjDialog, LjIcon, LjProgress, LjSpinner } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import PptxFontList from "./PptxFontList.vue";
import { hasRichContent, isFontFileName, missingFonts, type PptxImportState } from "../pptxImport";

/**
 * Andamento de um PowerPoint sendo preparado: fontes, geração dos slides e o
 * resultado. Fechar não cancela — a conversão segue e aparece também em
 * "Processos em segundo plano".
 */
const props = defineProps<{
  state: PptxImportState | null;
  regenerating?: boolean;
  tm: (_key: string, _named?: Record<string, unknown>) => string;
}>();

const emit = defineEmits<{
  close: [];
  project: [];
  projectNative: [];
  installFont: [];
  dropFonts: [files: File[]];
  openPermissionSettings: [];
  retry: [];
}>();

/** A janela fica num portal: soltar a fonte aqui não chega ao drop da biblioteca. */
const arrastando = ref(false);
function soltar(e: DragEvent): void {
  arrastando.value = false;
  const lista = Array.from(e.dataTransfer?.files ?? []).filter((f) => isFontFileName(f.name));
  if (lista.length) emit("dropFonts", lista);
}

const ORDEM = ["fonts", "converting", "done"] as const;

/** Animações e mídias que o modo imagem deixa paradas. */
const resumoRecursos = computed(() => {
  const f = props.state?.features;
  if (!hasRichContent(f) || !f) return "";
  const partes: string[] = [];
  if (f.animatedSlides) partes.push(props.tm("pptx.feat_animations", { count: f.animatedSlides }));
  if (f.videos) partes.push(props.tm("pptx.feat_videos", { count: f.videos }));
  if (f.audios) partes.push(props.tm("pptx.feat_audios", { count: f.audios }));
  return props.tm(props.state?.nativeAvailable ? "pptx.feat_hint" : "pptx.feat_hint_no_native", {
    items: partes.join(", "),
    app: props.state?.converter || "PowerPoint",
  });
});

const titulo = computed(() => {
  if (props.state?.phase === "done") return props.tm("pptx.dialog_ready");
  if (props.state?.phase === "error") return props.tm("pptx.dialog_failed");
  return props.tm("pptx.dialog_title");
});

const faltando = computed(() => missingFonts((props.state?.fonts ?? []) as PptxFont[]).length > 0);

function classeEtapa(etapa: (typeof ORDEM)[number]): string {
  const atual = props.state?.phase ?? "fonts";
  if (atual === "error") return "is-pending";
  const a = ORDEM.indexOf(atual as (typeof ORDEM)[number]);
  const e = ORDEM.indexOf(etapa);
  if (etapa === "done" && atual === "done") return "is-done";
  return e < a ? "is-done" : e === a ? "is-active" : "is-pending";
}
</script>

<style>
.pptx-import {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-5);
}
.pptx-import__file {
  overflow: hidden;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pptx-import__steps {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-3);
  margin: 0;
  padding: 0;
  list-style: none;
}
.pptx-import__steps li {
  display: flex;
  align-items: center;
  gap: var(--lj-space-4);
}
.pptx-import__steps li.is-pending {
  opacity: 0.45;
}
.pptx-import__steps li.is-done svg {
  color: var(--lj-success);
}
.pptx-import__steps li.is-active {
  font-weight: 600;
}
.pptx-import__count {
  margin-left: auto;
  font-variant-numeric: tabular-nums;
  opacity: 0.8;
}
.pptx-import__fonts-title {
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  opacity: 0.7;
}
.pptx-import__error {
  margin: 0;
  color: var(--lj-danger);
}
.pptx-import--drop {
  border-radius: var(--lj-ui-radius, 6px);
  outline: 2px dashed var(--lj-ui-accent);
  outline-offset: 6px;
}
.pptx-import__rich {
  margin: 0;
  padding: var(--lj-space-4);
  border-left: 3px solid var(--lj-ui-accent);
  border-radius: var(--lj-ui-radius, 6px);
  background: var(--lj-surface-bg-soft);
  font-size: 0.875rem;
}
.pptx-import__hint {
  margin: 0;
  font-size: 0.8125rem;
}
</style>
