<template>
  <div class="pm-pptx" data-testid="pm-pptx">
    <!--
      PowerPoint no ar: o PDF passa os slides parados; "Apresentar com animações"
      põe o próprio PowerPoint (ou o LibreOffice) por cima do PA.
    -->
    <div class="pm-pptx__row" :class="{ 'pm-pptx__row--on': native.active.value }">
      <template v-if="native.active.value">
        <span class="pm-pptx__text">{{ tm("pptx.native_on", { app: native.appName.value }) }}</span>
        <LjButton
          size="sm"
          :variant="native.state.value.black ? 'primary' : 'subtle'"
          :icon="ICONS.UI.EYE_OFF"
          @click="native.toggleBlack()"
        >
          {{ tm("pptx.native_black") }}
        </LjButton>
        <LjButton size="sm" variant="subtle" :icon="ICONS.PLAYER.STOP" @click="native.end()">
          {{ tm("pptx.native_end", { app: native.appName.value }) }}
        </LjButton>
      </template>
      <template v-else>
        <span class="pm-pptx__text" data-testid="pm-pptx-hint">{{ hint }}</span>
        <LjButton
          v-if="info"
          size="sm"
          :variant="missing.length || info.staleFonts ? 'primary' : 'subtle'"
          :icon="missing.length ? ICONS.UI.ALERT : ICONS.UI.CHECK_CIRCLE"
          data-testid="pm-pptx-fonts-toggle"
          @click="fontsOpen = !fontsOpen"
        >
          {{
            missing.length
              ? tm("pptx.fonts_missing_button", { count: missing.length })
              : tm("pptx.fonts_button")
          }}
        </LjButton>
        <LjButton
          v-if="native.available.value"
          size="sm"
          :variant="rich ? 'primary' : 'subtle'"
          :icon="ICONS.PROJECTION.PRESENT"
          :disabled="locked || native.opening.value"
          data-testid="pm-pdf-native-start"
          @click="native.start(pptxPath, page - 1)"
        >
          {{
            native.opening.value
              ? tm("pptx.native_opening", { app: native.appName.value })
              : tm("pptx.native_start", { app: native.appName.value })
          }}
        </LjButton>
      </template>
    </div>

    <!-- Fontes do arquivo: o que está instalado, o que falta e como resolver. -->
    <div v-if="fontsOpen && info && !native.active.value" class="pm-pptx__fonts" data-testid="pm-pptx-fonts">
      <p v-if="info.fontsError" class="pm-pptx__warn">
        {{ tm("pptx.fonts_error", { message: info.fontsError }) }}
      </p>
      <p v-if="!info.fonts.length" class="pm-pptx__muted">{{ tm("pptx.no_fonts") }}</p>
      <ul v-else class="pm-pptx__list">
        <li v-for="f in info.fonts" :key="f.name" class="pm-pptx__font">
          <LjIcon
            :icon="f.status === 'missing' || f.status === 'unmatched' ? ICONS.UI.ALERT : ICONS.UI.CHECK_CIRCLE"
            :size="14"
            :class="`pm-pptx__icon--${toneOf(f.status)}`"
          />
          <span class="pm-pptx__font-name" :title="f.name">{{ f.name }}</span>
          <LjChip size="sm" :variant="toneOf(f.status)">{{ labelOf(f) }}</LjChip>
        </li>
      </ul>
      <p v-if="info.staleFonts" class="pm-pptx__warn">{{ tm("pptx.stale_fonts") }}</p>
      <p v-else-if="missing.length" class="pm-pptx__muted">{{ tm("pptx.missing_hint") }}</p>
      <div class="pm-pptx__actions">
        <LjButton size="sm" variant="subtle" :disabled="busy" data-testid="pm-pptx-install-font" @click="installFont">
          {{ tm("pptx.install_font") }}
        </LjButton>
        <LjButton
          size="sm"
          variant="subtle"
          :icon="ICONS.ACTIONS.REFRESH"
          :disabled="busy || locked"
          data-testid="pm-pptx-regenerate"
          @click="regenerate"
        >
          {{ busy ? tm("pptx.regenerating") : tm("pptx.regenerate") }}
        </LjButton>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ModuleEnum } from "@/enums/ModuleEnum";
import { useModuleI18n } from "@/composables/useModuleI18n";
import Platform from "@/helpers/Platform";
import $snackbar from "@/helpers/Snackbar";
import { LjButton, LjChip, LjIcon } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { usePptxNative } from "../composables/usePptxNative";
import {
  loadPowerPointInfo,
  missingFontNames,
  powerPointInfo,
  regeneratePowerPoint,
} from "../composables/usePowerPoint";

/**
 * A faixa do PowerPoint no ar: o que o PDF deixa parado (animações, vídeos),
 * "Apresentar com animações" e as fontes do arquivo — instalar a que falta e
 * gerar os slides de novo, sem sair do módulo.
 */

const props = defineProps<{ pptxPath: string; page: number; locked: boolean }>();
const emit = defineEmits<{ regenerated: [pdf: string] }>();
const { tm } = useModuleI18n(ModuleEnum.PRESENTATION_MODE);
const native = usePptxNative();

const info = computed(() => powerPointInfo.get(props.pptxPath) ?? null);
const missing = computed(() => missingFontNames(info.value));
const fontsOpen = ref(false);
const busy = ref(false);

// Fonte faltando abre a lista sozinha: é o que faz o slide sair diferente.
watch(
  () => props.pptxPath,
  (p) => {
    loadPowerPointInfo(p);
    fontsOpen.value = missing.value.length > 0 || !!info.value?.staleFonts;
  },
  { immediate: true }
);
watch(
  () => missing.value.length + (info.value?.staleFonts ? 1 : 0),
  (n, old) => {
    if (n > 0 && !old) fontsOpen.value = true;
  }
);

const rich = computed(() => {
  const f = info.value?.features;
  return !!f && f.animatedSlides + f.videos + f.audios > 0;
});

const hint = computed(() => {
  const f = info.value?.features;
  if (!f) return "";
  const items: string[] = [];
  if (f.animatedSlides) items.push(tm("pptx.feat_animations", { count: f.animatedSlides }));
  if (f.videos) items.push(tm("pptx.feat_videos", { count: f.videos }));
  if (f.audios) items.push(tm("pptx.feat_audios", { count: f.audios }));
  if (!items.length) return tm("pptx.native_hint_plain");
  const list = items.length > 1 ? `${items.slice(0, -1).join(", ")}${tm("pptx.feat_and")}${items.at(-1)}` : items[0];
  return tm("pptx.native_hint", { items: list });
});

type Tone = "success" | "warning" | "danger" | "neutral";
function toneOf(status: string): Tone {
  if (status === "missing") return "danger";
  if (status === "unmatched") return "warning";
  if (status === "searching") return "neutral";
  return "success";
}

function labelOf(f: { status: string; source?: string | null }): string {
  if (f.status === "installed" && f.source) {
    const source = f.source === "google" ? tm("pptx.source_google") : tm("pptx.source_embedded");
    return tm("pptx.font_installed_from", { source });
  }
  const key: Record<string, string> = {
    ok: "pptx.font_ok",
    office: "pptx.font_office",
    embedded: "pptx.font_embedded",
    installed: "pptx.font_installed",
    missing: "pptx.font_missing",
    unmatched: "pptx.font_unmatched",
    searching: "pptx.font_searching",
  };
  return tm(key[f.status] ?? "pptx.font_ok");
}

/** Diálogo nativo de fontes; com fonte faltando, gera de novo sozinho. */
async function installFont(): Promise<void> {
  const api = (Platform.api as LouvorjaApi | null)?.pptx;
  if (!api?.installFonts || busy.value) return;
  const r = await api.installFonts();
  if (!r.ok) {
    if (r.code !== "canceled") $snackbar.error(r.message, { timeout: 8000 });
    return;
  }
  const names = (r.families ?? []).join(", ");
  $snackbar.success(
    names
      ? tm("pptx.fonts_installed_names", { names })
      : tm("pptx.fonts_installed_count", { count: r.installed })
  );
  if (missing.value.length) await regenerate();
}

/** Converte de novo; o módulo põe o PDF novo no ar no lugar do antigo. */
async function regenerate(): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  try {
    const name = props.pptxPath.split(/[\\/]/).pop() ?? props.pptxPath;
    const pdf = await regeneratePowerPoint(props.pptxPath, name);
    if (pdf) emit("regenerated", pdf);
  } finally {
    busy.value = false;
  }
}
</script>

<style scoped>
.pm-pptx {
  border-bottom: 1px solid var(--lj-white-alpha-20);
  font-size: 12px;
  color: var(--lj-white-alpha-50);
}

.pm-pptx__row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
}

.pm-pptx__row--on {
  color: var(--lj-orange);
}

.pm-pptx__text {
  flex: 1;
  min-width: 0;
}

.pm-pptx__fonts {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 2px 10px 8px;
}

.pm-pptx__list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 4px 12px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.pm-pptx__font {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.pm-pptx__font-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--lj-live-color);
}

.pm-pptx__icon--success {
  color: var(--lj-success);
}

.pm-pptx__icon--warning {
  color: var(--lj-warning);
}

.pm-pptx__icon--danger {
  color: var(--lj-danger);
}

.pm-pptx__muted,
.pm-pptx__warn {
  margin: 0;
}

.pm-pptx__warn {
  color: var(--lj-warning);
}

.pm-pptx__actions {
  display: flex;
  gap: 8px;
}
</style>
