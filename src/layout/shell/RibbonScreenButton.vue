<template>
  <div class="ribbon-screen-btn" :class="`ribbon-btn--${size}`">
    <button
      type="button"
      class="ribbon-btn ribbon-btn--main"
      :class="[`ribbon-btn--${size}`, { 'ribbon-btn--active': is_active }]"
      :title="dynamicLabel"
      :data-testid="testid"
      @click="primaryClick"
    >
      <Icon
        :icon="dynamicIcon"
        :size="size === 'large' ? 32 : 16"
        :color="dynamicIconColor"
        class="ribbon-btn-icon"
      />
      <span class="ribbon-btn-label">{{ dynamicLabel }}</span>
    </button>

    <LjMenu :items="menuItems" side="bottom" align="end">
      <template #trigger>
        <button
          type="button"
          class="ribbon-screen-btn__chevron"
          :title="$t('options.slides.open_at')"
          @click.stop
        >
          <Icon :icon="ICONS.UI.CHEVRON_DOWN" :size="14" />
        </button>
      </template>
    </LjMenu>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import Icon from "@/components/Icon.vue";
import { LjMenu, type LjMenuItem } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import {
  listDisplays,
  getPreferredMonitor,
  setPreferredMonitor,
  identifyDisplays,
  isOpen as isProjectionOpen,
  open as openProjection,
  close as closeProjection,
  getFallbackFeature,
  isUsingFallback,
  getCategorizedDisplays,
  needsScreenAccess,
  requestScreenAccess,
} from "@/helpers/Projection";
import { useI18n } from "vue-i18n";
import { CategorizedDisplays, DisplayInfo } from "@/types/Projection";

const props = defineProps({
  feature: { type: String, default: "" },
  route: { type: String, default: "" },
  iconColor: { type: String, default: null },
  size: { type: String, default: "large" },
  testid: { type: String, default: null },
  fullscreen: { type: Boolean, default: true },
  alwaysOnTop: { type: Boolean, default: false },
});

const { t } = useI18n();
const projection_open = ref(false);
const displays = ref<any[]>([]);
const effective_id = ref<number | string | null>(null);
const explicit_id = ref<number | string | null | undefined>(undefined);

const categorized = ref<CategorizedDisplays>({
  primaryDisplay: undefined,
  secondaryDisplay: undefined,
  primaryLabel: null,
  secondaryLabel: null,
  otherDisplays: [],
});

watch(
  displays,
  async (list) => {
    if (list?.length) {
      categorized.value = await getCategorizedDisplays();
    }
  },
  { immediate: true }
);

const fallback_feature = computed(() => getFallbackFeature(props.feature));
const fallback_label = computed(() => {
  const f = fallback_feature.value;
  if (!f) return "";
  if (f === "musicas") return "Slides de músicas";
  if (f === "retorno") return "Stage Display (Retorno)";
  if (f === "operador") return "Operador";
  return f;
});

const is_active = computed(() => projection_open.value);
const can_identify = computed(() => displays.value.length > 1);
const needs_access = ref(false);

const dynamicIcon = computed(() =>
  is_active.value ? ICONS.PROJECTION.STOP : ICONS.PROJECTION.START
);

const dynamicIconColor = computed<string | undefined>(() =>
  is_active.value ? "var(--lj-danger)" : (props.iconColor ?? undefined)
);
const dynamicLabel = computed(() =>
  is_active.value ? t("ribbon.btn.stop_projection") : t("ribbon.btn.project")
);

/** Resolução do monitor — vira a linha secundária do item de menu. */
function boundsHint(display: DisplayInfo): string {
  return `${display.bounds?.width}×${display.bounds?.height}`;
}

/**
 * Item de monitor. A marca de seleção segue o id EFETIVO (o que realmente
 * abre a janela), não o explícito — é o que o menu Vuetify exibia.
 */
function displayItem(display: DisplayInfo, label: string): LjMenuItem {
  return {
    label,
    hint: boundsHint(display),
    icon: ICONS.UI.MONITOR,
    checked: effective_id.value === display.id,
    action: () => choose(display.id),
  };
}

const menuItems = computed<LjMenuItem[]>(() => {
  const items: LjMenuItem[] = [{ label: t("options.slides.open_at") }];

  // Padrão (herdado) — só aparece quando há grupo de fallback
  if (fallback_feature.value) {
    items.push({
      label: t("options.monitors.use_default"),
      hint: fallback_label.value,
      icon: ICONS.UI.LINK_VARIANT,
      checked: explicit_id.value === undefined,
      action: () => choose(undefined),
    });
  }

  items.push({
    label: t("options.slides.same_window"),
    checked: explicit_id.value === null,
    action: () => choose(null),
  });

  // Tela principal
  const primary = categorized.value.primaryDisplay;
  if (primary) {
    const suffix = categorized.value.primaryLabel ? ` - ${categorized.value.primaryLabel}` : "";
    items.push(displayItem(primary, `${t("options.monitors.primary")}${suffix}`));
  }

  // Tela de retorno
  const secondary = categorized.value.secondaryDisplay;
  if (secondary) {
    const suffix = categorized.value.secondaryLabel ? ` - ${categorized.value.secondaryLabel}` : "";
    items.push(displayItem(secondary, `${t("options.monitors.secondary")}${suffix}`));
  }

  // Demais monitores
  for (const d of categorized.value.otherDisplays) {
    const suffix = d.primary ? ` (${t("options.monitors.primary_short")})` : "";
    items.push(displayItem(d, `${d.label}${suffix}`));
  }

  // Navegador sem permissão: sem isso a lista de monitores fica vazia
  if (needs_access.value) {
    items.push({
      label: t("options.monitors.web_detect"),
      icon: ICONS.UI.MONITORS,
      action: () => detectScreens(),
    });
  }

  items.push({ separator: true });

  items.push({
    label: t("options.monitors.identify"),
    icon: ICONS.ACTIONS.SEARCH,
    disabled: !can_identify.value,
    action: () => identify(),
  });

  if (is_active.value) {
    items.push({
      label: t("popup.close"),
      icon: ICONS.ACTIONS.CLOSE,
      action: () => closeOpen(),
    });
  }

  return items;
});

async function refresh() {
  displays.value = await listDisplays();
  needs_access.value = await needsScreenAccess();
  const explicit = await getPreferredMonitor(props.feature, { explicit: true });
  const usingFallback = await isUsingFallback(props.feature);
  explicit_id.value = usingFallback ? undefined : explicit;
  effective_id.value = await getPreferredMonitor(props.feature);
  projection_open.value = await isProjectionOpen(props.feature);
}

async function primaryClick() {
  if (projection_open.value) {
    await closeProjection(props.feature);
  } else {
    await openProjection({
      feature: props.feature,
      route: props.route,
      monitorId: effective_id.value,
      fullscreen: props.fullscreen,
      alwaysOnTop: props.alwaysOnTop,
    });
  }
  await refresh();
}

async function choose(displayId: number | string | null | undefined) {
  const toSave = displayId === undefined ? null : displayId;
  await setPreferredMonitor(props.feature, toSave);
  await refresh();
  if (effective_id.value == null) {
    if (projection_open.value) await closeProjection(props.feature);
  } else {
    if (projection_open.value) await closeProjection(props.feature);
    await openProjection({
      feature: props.feature,
      route: props.route,
      monitorId: effective_id.value,
      fullscreen: props.fullscreen,
      alwaysOnTop: props.alwaysOnTop,
    });
  }
  await refresh();
}

async function closeOpen() {
  await closeProjection(props.feature);
  await refresh();
}

async function identify() {
  await identifyDisplays(5000);
}

async function detectScreens() {
  await requestScreenAccess();
  await refresh();
}

let pollTimer: ReturnType<typeof setTimeout> | null = null;
onMounted(async () => {
  await refresh();
  // Defensiva: se onMounted disparar mais de uma vez (HMR / v-if remount /
  // KeepAlive activate), limpa o interval anterior antes de criar outro.
  // Sem isso, acumula múltiplos polls de 2s e o estado fica inconsistente.
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    const open = await isProjectionOpen(props.feature);
    if (open !== projection_open.value) projection_open.value = open;
  }, 2000);
});

onUnmounted(() => {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
});

watch(() => props.feature, refresh);
</script>

<style scoped>
.ribbon-screen-btn {
  position: relative;
  display: flex;
  flex-direction: column;
}

.ribbon-btn {
  display: flex;
  border: 1px solid transparent;
  background: transparent;
  cursor: pointer;
  border-radius: var(--lj-radius-sm);
  color: var(--lj-rbtn-color);
  transition:
    background var(--lj-transition-fast),
    border-color var(--lj-transition-fast),
    box-shadow var(--lj-transition-fast),
    transform var(--lj-transition-fast);
  outline: none;
  user-select: none;
  font-family: var(--lj-font-shell);
}

.ribbon-btn:hover {
  background: var(--lj-rbtn-hover-bg);
  border-color: var(--lj-rbtn-hover-border);
}

.ribbon-btn--active {
  background: var(--lj-rbtn-active-bg);
  border-color: var(--lj-rbtn-active-border);
}

.ribbon-btn--large {
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  width: var(--lj-large-btn-width);
  min-height: var(--lj-large-btn-height);
  padding: var(--lj-space-2);
  gap: var(--lj-space-1);
}

.ribbon-btn--large .ribbon-btn-icon {
  flex-shrink: 0;
}

.ribbon-btn--large .ribbon-btn-label {
  font-size: var(--lj-text-sm);
  text-align: center;
  line-height: 1.15;
  word-break: break-word;
  max-width: 80px;
  color: inherit;
}

.ribbon-screen-btn__chevron {
  position: absolute;
  bottom: 2px;
  right: 4px;
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--lj-radius-sm);
  cursor: pointer;
  color: var(--lj-text-muted);
  outline: none;
}

.ribbon-screen-btn__chevron:hover {
  background: var(--lj-rbtn-hover-bg);
  border-color: var(--lj-rbtn-hover-border);
}

.ribbon-screen-btn__chevron:focus-visible {
  box-shadow: var(--lj-ui-focus);
}
</style>
