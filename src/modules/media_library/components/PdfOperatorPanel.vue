<template>
  <section class="pdf-op" :aria-label="title">
    <!-- Cabeçalho: nome, posição e comandos -->
    <header class="pdf-op__head">
      <LjButton size="sm" variant="ghost" :icon="ICONS.UI.ARROW_LEFT" @click="emit('back')">
        {{ tm("pptx.panel_back") }}
      </LjButton>
      <div class="pdf-op__title" :title="title">{{ title }}</div>
      <span class="pdf-op__count">
        {{ total > 0 ? tm("pptx.panel_slide", { page, total }) : "" }}
      </span>
      <div class="pdf-op__nav">
        <LjButton
          icon-only
          variant="ghost"
          :icon="ICONS.PLAYER.PREV"
          :title="tm('prev')"
          :aria-label="tm('prev')"
          :disabled="page <= 1"
          @click="emit('prev')"
        />
        <LjButton
          icon-only
          variant="ghost"
          :icon="ICONS.PLAYER.NEXT"
          :title="tm('next')"
          :aria-label="tm('next')"
          :disabled="total > 0 && page >= total"
          @click="emit('next')"
        />
        <LjButton
          icon-only
          variant="ghost"
          class="pdf-op__stop"
          :icon="ICONS.PLAYER.STOP"
          :title="tm('stop')"
          :aria-label="tm('stop')"
          @click="emit('stop')"
        />
      </div>
    </header>

    <!-- Modo de apresentação: imagens (PA + retorno) ou o próprio PowerPoint (animações) -->
    <div
      v-if="native && (native.active || native.available || resumoRecursos)"
      class="pdf-op__mode" :class="{ 'is-native': native.active }">
      <template v-if="native.active">
        <LjChip variant="primary" :icon="ICONS.PROJECTION.PRESENT">
          {{ tm("pptx.native_on", { app: native.app }) }}
        </LjChip>
        <span class="lj-u-spacer" />
        <LjButton
          size="sm"
          :variant="native.black ? 'primary' : 'subtle'"
          :icon="ICONS.UI.EYE_OFF"
          @click="emit('black')"
        >
          {{ tm("pptx.native_black") }}
        </LjButton>
        <LjButton size="sm" variant="subtle" :icon="ICONS.PLAYER.STOP" @click="emit('nativeEnd')">
          {{ tm("pptx.native_end", { app: native.app }) }}
        </LjButton>
      </template>
      <template v-else>
        <p v-if="resumoRecursos" class="pdf-op__hint">{{ resumoRecursos }}</p>
        <span class="lj-u-spacer" />
        <LjButton
          v-if="native.available"
          size="sm"
          :variant="resumoRecursos ? 'primary' : 'subtle'"
          :icon="ICONS.PROJECTION.PRESENT"
          :disabled="native.busy"
          @click="emit('nativeStart')"
        >
          {{
            native.busy
              ? tm("pptx.native_opening", { app: native.app })
              : tm("pptx.native_start", { app: native.app })
          }}
        </LjButton>
      </template>
    </div>

    <!-- No telão + próximo -->
    <div class="pdf-op__stage">
      <figure class="pdf-op__now">
        <figcaption>{{ tm("pptx.panel_current") }}</figcaption>
        <div class="pdf-op__frame pdf-op__frame--live">
          <img v-if="thumbs[page - 1]" :src="thumbs[page - 1]" alt="" />
          <LjSpinner v-else />
        </div>
      </figure>
      <figure class="pdf-op__next">
        <figcaption>{{ tm("pptx.panel_next") }}</figcaption>
        <div class="pdf-op__frame">
          <img v-if="page < pageCount && thumbs[page]" :src="thumbs[page]" alt="" />
          <span v-else-if="pageCount && page >= pageCount" class="pdf-op__end">
            {{ tm("pptx.panel_end") }}
          </span>
          <LjSpinner v-else />
        </div>

        <!-- Fontes (só para itens que vieram de PowerPoint) -->
        <div v-if="fonts" class="pdf-op__fonts">
          <div class="pdf-op__fonts-title">{{ tm("pptx.fonts_title") }}</div>
          <PptxFontList :fonts="fonts" :tm="tm" />
          <p v-if="faltando" class="pdf-op__hint">{{ tm("pptx.missing_hint_drop") }}</p>
          <div class="pdf-op__fonts-actions">
            <LjButton
              size="sm"
              variant="subtle"
              :icon="ICONS.ACTIONS.UPLOAD"
              @click="emit('installFont')"
            >
              {{ tm("pptx.install_font") }}
            </LjButton>
            <LjButton
              size="sm"
              variant="subtle"
              :icon="ICONS.ACTIONS.REFRESH"
              :disabled="regenerating"
              @click="emit('regenerate')"
            >
              {{ tm("pptx.regenerate") }}
            </LjButton>
          </div>
        </div>
      </figure>
    </div>

    <!-- Todos os slides -->
    <div class="pdf-op__grid-title">
      {{ tm("pptx.panel_slides") }}
      <span v-if="loading" class="pdf-op__loading">{{ tm("pptx.panel_loading") }}</span>
    </div>
    <div class="pdf-op__grid">
      <button
        v-for="n in pageCount"
        :key="n"
        type="button"
        class="pdf-op__thumb"
        :class="{ 'is-current': n === page }"
        :aria-current="n === page ? 'true' : undefined"
        :aria-label="tm('pptx.panel_slide', { page: n, total: pageCount })"
        @click="emit('goto', n)"
      >
        <img v-if="thumbs[n - 1]" :src="thumbs[n - 1]" alt="" loading="lazy" />
        <span class="pdf-op__num">{{ n }}</span>
      </button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { fetchWithTimeout, NET_TIMEOUT } from "@/helpers/Http";
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { LjButton, LjChip, LjSpinner } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { loadPdfDocument, type PDFDocumentProxy } from "@/helpers/PdfRuntime";
import PptxFontList from "./PptxFontList.vue";
import { missingFonts } from "../pptxImport";

/**
 * Painel do operador para um PDF no telão — o mesmo papel da tela de controle
 * do SlideFlow: o slide que está no ar, o próximo, todos os slides para clicar
 * e, quando o PDF veio de um PowerPoint, a situação das fontes.
 *
 * Só mostra e pede: quem muda a página é o `Index.vue`, pelo mesmo caminho do
 * Próximo/Anterior (`broadcastPdfPage`), para telão e retorno andarem juntos.
 */
const props = defineProps<{
  url: string;
  title: string;
  page: number;
  total: number;
  fonts?: PptxFont[] | null;
  regenerating?: boolean;
  /** Modo nativo (PowerPoint no PA). null = não se aplica (PDF comum). */
  native?: { available: boolean; active: boolean; black: boolean; busy: boolean; app: string } | null;
  /** Animações e mídias do arquivo (o que o modo imagem não leva). */
  features?: PptxFeatures | null;
  tm: (_key: string, _named?: Record<string, unknown>) => string;
}>();

const emit = defineEmits<{
  goto: [page: number];
  prev: [];
  next: [];
  stop: [];
  back: [];
  installFont: [];
  regenerate: [];
  nativeStart: [];
  nativeEnd: [];
  black: [];
}>();

/** "Este arquivo tem animações em 7 slides e 2 vídeos…" — só quando há o que perder. */
const resumoRecursos = computed(() => {
  const f = props.features;
  if (!f) return "";
  const partes: string[] = [];
  if (f.animatedSlides) partes.push(props.tm("pptx.feat_animations", { count: f.animatedSlides }));
  if (f.videos) partes.push(props.tm("pptx.feat_videos", { count: f.videos }));
  if (f.audios) partes.push(props.tm("pptx.feat_audios", { count: f.audios }));
  if (!partes.length) return "";
  return props.tm(props.native?.available ? "pptx.feat_hint" : "pptx.feat_hint_no_native", {
    items: partes.join(", "),
    app: props.native?.app ?? "PowerPoint",
  });
});

/** Largura das miniaturas: dá para ler o slide no "próximo" sem pesar. */
const THUMB_WIDTH = 480;

const thumbs = ref<string[]>([]);
const pagesFromDoc = ref(0);
const loading = ref(false);
const pageCount = computed(() => props.total || pagesFromDoc.value);
const faltando = computed(() => missingFonts(props.fonts ?? []).length > 0);

let geracao = 0;
let doc: PDFDocumentProxy | null = null;

/** Mesmo cast do FileProjection.vue: o `destroy` existe, os tipos não o expõem. */
function destruir(d: PDFDocumentProxy | null): void {
  if (d) void (d as unknown as { destroy: () => Promise<void> }).destroy().catch(() => {});
}

async function carregar(url: string): Promise<void> {
  const minha = ++geracao;
  thumbs.value = [];
  pagesFromDoc.value = 0;
  destruir(doc);
  doc = null;
  if (!url) return;
  loading.value = true;
  try {
    const resp = await fetchWithTimeout(url, { timeout: NET_TIMEOUT.MEDIA, source: "pptx-panel" });
    const data = new Uint8Array(await resp.arrayBuffer());
    if (minha !== geracao) return;
    const aberto = await loadPdfDocument({ data });
    if (minha !== geracao) {
      destruir(aberto);
      return;
    }
    doc = aberto;
    pagesFromDoc.value = aberto.numPages;
    // Primeiro o slide no ar e o próximo; depois o resto, em ordem.
    const ordem = [props.page, props.page + 1];
    for (let n = 1; n <= aberto.numPages; n++) if (!ordem.includes(n)) ordem.push(n);
    for (const n of ordem) {
      if (minha !== geracao) return;
      if (n < 1 || n > aberto.numPages) continue;
      const pagina = await aberto.getPage(n);
      const base = pagina.getViewport({ scale: 1 });
      const viewport = pagina.getViewport({ scale: THUMB_WIDTH / base.width });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      await pagina.render({ canvas, viewport }).promise;
      if (minha !== geracao) return;
      const lista = [...thumbs.value];
      lista[n - 1] = canvas.toDataURL("image/jpeg", 0.82);
      thumbs.value = lista;
    }
  } catch (error) {
    console.warn("[media_library] miniaturas do PDF:", (error as Error)?.message || error);
  } finally {
    if (minha === geracao) loading.value = false;
  }
}

watch(
  () => props.url,
  (url) => void carregar(url),
  { immediate: true }
);

onBeforeUnmount(() => {
  geracao++;
  destruir(doc);
  doc = null;
});
</script>

<style scoped>
.pdf-op {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-6);
  height: 100%;
  min-height: 0;
  padding: 0 var(--lj-space-5) var(--lj-space-5);
  overflow: auto;
}
.pdf-op__head {
  position: sticky;
  z-index: 1;
  top: 0;
  padding: var(--lj-space-4) 0;
  border-bottom: 1px solid var(--lj-ui-border, rgba(127, 127, 127, 0.3));
  background: var(--lj-surface-bg);
  display: flex;
  align-items: center;
  gap: var(--lj-space-4);
  min-width: 0;
}
.pdf-op__title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pdf-op__count {
  font-variant-numeric: tabular-nums;
  opacity: 0.8;
  white-space: nowrap;
}
.pdf-op__nav {
  display: flex;
  gap: var(--lj-space-2);
}
.pdf-op__stop :deep(svg) {
  color: var(--lj-danger);
}
.pdf-op__mode {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--lj-space-4);
  padding: var(--lj-space-4);
  border: 1px solid var(--lj-ui-border, rgba(127, 127, 127, 0.3));
  border-radius: var(--lj-ui-radius, 6px);
  background: var(--lj-surface-bg-soft);
}
.pdf-op__mode.is-native {
  border-color: var(--lj-ui-accent);
}
.pdf-op__mode .pdf-op__hint {
  flex: 1 1 260px;
}
.pdf-op__stage {
  display: grid;
  grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
  gap: var(--lj-space-6);
}
.pdf-op__stage figure {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-3);
  min-width: 0;
  margin: 0;
}
.pdf-op__stage figcaption,
.pdf-op__grid-title,
.pdf-op__fonts-title {
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  opacity: 0.7;
}
.pdf-op__frame {
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  aspect-ratio: 16 / 9;
  border: 1px solid var(--lj-ui-border, rgba(127, 127, 127, 0.35));
  border-radius: var(--lj-ui-radius, 6px);
  background: #000;
}
.pdf-op__frame img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.pdf-op__frame--live {
  border-color: var(--lj-ui-accent, #f59e0b);
  box-shadow: 0 0 0 2px var(--lj-ui-accent, #f59e0b);
}
.pdf-op__end {
  padding: var(--lj-space-4);
  color: #fff;
  opacity: 0.7;
}
.pdf-op__fonts {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-3);
  margin-top: var(--lj-space-3);
}
.pdf-op__fonts-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--lj-space-3);
}
.pdf-op__hint {
  margin: 0;
  font-size: 0.8125rem;
  opacity: 0.85;
}
.pdf-op__grid-title {
  display: flex;
  align-items: center;
  gap: var(--lj-space-4);
}
.pdf-op__loading {
  font-weight: 400;
  text-transform: none;
}
.pdf-op__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: var(--lj-space-4);
}
.pdf-op__thumb {
  position: relative;
  overflow: hidden;
  aspect-ratio: 16 / 9;
  padding: 0;
  border: 2px solid transparent;
  border-radius: var(--lj-ui-radius, 6px);
  background: #000;
  cursor: pointer;
}
.pdf-op__thumb:hover {
  border-color: var(--lj-ui-border, rgba(127, 127, 127, 0.6));
}
.pdf-op__thumb.is-current {
  border-color: var(--lj-ui-accent, #f59e0b);
}
.pdf-op__thumb:focus-visible {
  outline: none;
  box-shadow: var(--lj-ui-focus, 0 0 0 2px #3b82f6);
}
.pdf-op__thumb img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.pdf-op__num {
  position: absolute;
  bottom: 4px;
  left: 4px;
  min-width: 20px;
  padding: 0 5px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.7);
  color: #fff;
  font-size: 0.75rem;
  line-height: 18px;
  text-align: center;
}
@media (max-width: 900px) {
  .pdf-op__stage {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
