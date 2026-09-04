<template>
  <div v-if="!is_mobile" class="screen-btn">
    <LjTooltip :text="$t('options.slides.open_at')">
      <LjButton
        class="screen-btn__main"
        :class="{ 'screen-btn__main--active': is_active }"
        :size="ui_size"
        :variant="ui_variant"
        icon-only
        :icon="is_active ? ICONS.PROJECTION.STOP : ICONS.PROJECTION.START"
        :aria-label="$t('options.slides.open_at')"
        @click="primaryClick()"
      />
    </LjTooltip>

    <LjMenu :items="menuItems" side="bottom" align="end">
      <template #trigger>
        <LjButton
          class="screen-btn__chevron"
          :size="ui_size"
          :variant="ui_variant"
          icon-only
          :icon="ICONS.UI.CHEVRON_DOWN"
          :aria-label="$t('options.slides.open_at')"
        />
      </template>
    </LjMenu>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import AppData from "@/helpers/AppData";
import Popup from "@/helpers/Popup";
import { LjButton, LjMenu, LjTooltip } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { useCategorizedDisplays } from "@/composables/useCategorizedDisplays";
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
  needsScreenAccess,
  requestScreenAccess,
} from "@/helpers/Projection";
import { PROJECTION_TYPE } from "@/constants/Projection";

const props = defineProps({
  /** Identificador único da projeção (ex: "bible", "music"). Default: derivado de `module`. */
  feature: { type: String, default: null },
  /** Rota a abrir como projeção (ex: "/obs/bible"). Default: derivado de `module`. */
  route: { type: String, default: null },
  /** Modo retrocompat — abre Popup do módulo se feature/route não forem fornecidos. */
  module: { type: String, default: null },
  size: { type: String, default: "small" },
  variant: { type: String, default: "text" },
  fullscreen: { type: Boolean, default: true },
  alwaysOnTop: { type: Boolean, default: false },
});

const { t } = useI18n();

const ROUTE_BY_MODULE = {
  bible: "/projection/bible",
  media: "/projection",
  music: "/projection",
  // Genéricos — usam ModuleProjection.vue lendo ?module=<id>
  message_board: "/projection/module?module=message_board",
  draw: "/projection/module?module=draw",
  name_draw: "/projection/module?module=name_draw",
  counter: "/projection/module?module=counter",
  clock: "/projection/module?module=clock",
  stopwatch: "/projection/module?module=stopwatch",
  timer: "/projection/module?module=timer",
};

const is_mobile = computed(() => AppData.get("is_mobile"));

// O player usa module="media", mas a janela que o Media abre em /projection é a
// feature canônica "musicas". Sem o alias, o botão abriria uma segunda janela na
// mesma rota e nunca refletiria a projeção já aberta.
const FEATURE_BY_MODULE = {
  media: PROJECTION_TYPE.MUSIC,
  music: PROJECTION_TYPE.MUSIC,
};

const featureName = computed(
  () => props.feature || FEATURE_BY_MODULE[props.module] || props.module || "default"
);
const routePath = computed(() => props.route || ROUTE_BY_MODULE[props.module] || null);
const isProjectionMode = computed(() => !!routePath.value);

// Estado do Popup tradicional (legacy — para módulos sem route)
const is_popup_opened = computed(() => !!AppData.get("popup"));
const popup_module = computed(() => AppData.get("popup_module"));
const is_popup_selected = computed(
  () => is_popup_opened.value && popup_module.value === props.module
);

// Estado da projeção (novo — feature/route)
const projection_open = ref(false);
const displays = ref([]);
// Effective: o que efetivamente vai abrir (com fallback aplicado)
const effective_id = ref(null);
// Explicit: undefined = "usar padrão herdado"; null = "mesma janela"; number = monitor escolhido
const explicit_id = ref(undefined);

const fallback_feature = computed(() => getFallbackFeature(featureName.value));
const fallback_label = computed(() => {
  const f = fallback_feature.value;
  if (!f) return "";
  // Resolve o nome amigável da feature herdada
  if (f === "musicas") return "Slides de músicas";
  if (f === "retorno") return "Stage Display (Retorno)";
  if (f === "operador") return "Operador";
  return f;
});

const is_active = computed(() =>
  isProjectionMode.value ? projection_open.value : is_popup_selected.value
);
const can_identify = computed(() => displays.value.length > 1);
const needs_access = ref(false);

const { primaryDisplay, secondaryDisplay, primaryLabel, secondaryLabel, otherDisplays } =
  useCategorizedDisplays(displays);

// A escala do catálogo tem três degraus; o `size` continua nomeado como no
// Vuetify por causa dos consumidores. O `small` do Vuetify (32px) cai entre
// `sm` (22px) e `md` (26px) — fica em `md` para não encolher dentro do player.
const SIZE_MAP = {
  "x-small": "sm",
  small: "md",
  default: "md",
  large: "lg",
  "x-large": "lg",
};
const ui_size = computed(() => SIZE_MAP[props.size] || "md");

// `text`/`plain` do Vuetify não têm superfície nem traço — é o `ghost` daqui.
const VARIANT_MAP = {
  text: "ghost",
  plain: "ghost",
  tonal: "subtle",
  outlined: "default",
  flat: "default",
  elevated: "default",
};
const ui_variant = computed(() => VARIANT_MAP[props.variant] || "ghost");

/** Resolução do monitor — vira a linha secundária do item de menu. */
function boundsHint(display) {
  return `${display.bounds?.width}×${display.bounds?.height}`;
}

/**
 * Item de monitor. A marca de seleção segue o id EFETIVO (o que realmente abre
 * a janela), não o explícito — é o que o menu Vuetify exibia.
 */
function displayItem(display, label) {
  return {
    label,
    hint: boundsHint(display),
    icon: ICONS.UI.MONITOR,
    checked: effective_id.value === display.id,
    action: () => choose(display.id),
  };
}

const menuItems = computed(() => {
  const items = [{ label: t("options.slides.open_at") }];

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
  if (primaryDisplay.value) {
    const suffix = primaryLabel.value ? ` - ${primaryLabel.value}` : "";
    items.push(displayItem(primaryDisplay.value, `${t("options.monitors.primary")}${suffix}`));
  }

  // Tela de retorno
  if (secondaryDisplay.value) {
    const suffix = secondaryLabel.value ? ` - ${secondaryLabel.value}` : "";
    items.push(displayItem(secondaryDisplay.value, `${t("options.monitors.secondary")}${suffix}`));
  }

  // Demais monitores
  for (const d of otherDisplays.value) {
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

async function refreshDisplays() {
  if (!isProjectionMode.value) return;
  displays.value = await listDisplays();
  needs_access.value = await needsScreenAccess();
  // explicit: só leitura crua da feature (sem fallback)
  const explicit = await getPreferredMonitor(featureName.value, { explicit: true });
  const usingFallback = await isUsingFallback(featureName.value);
  explicit_id.value = usingFallback ? undefined : explicit;
  // effective: com fallback aplicado — esse é quem abre a janela
  effective_id.value = await getPreferredMonitor(featureName.value);
  projection_open.value = await isProjectionOpen(featureName.value);
}

function legacyPopup() {
  if (is_popup_selected.value) Popup.exit();
  else Popup.open(props.module);
}

async function primaryClick() {
  if (!isProjectionMode.value) {
    legacyPopup();
    return;
  }
  // Toggle abrir/fechar usando preferência efetiva (com fallback)
  if (projection_open.value) {
    await closeProjection(featureName.value);
  } else {
    await openProjection({
      feature: featureName.value,
      route: routePath.value,
      monitorId: effective_id.value,
      fullscreen: props.fullscreen,
      alwaysOnTop: props.alwaysOnTop,
    });
  }
  await refreshDisplays();
}

/**
 * displayId:
 *   undefined → "Padrão herdado" (limpa explícito, usa fallback do grupo)
 *   null      → "Mesma janela"
 *   number    → Monitor específico
 */
async function choose(displayId) {
  if (!isProjectionMode.value) return;
  // setPreferredMonitor com null limpa a preferência. Para "Padrão herdado"
  // (undefined), também passamos null para limpar o explícito.
  const toSave = displayId === undefined ? null : displayId;
  await setPreferredMonitor(featureName.value, toSave);
  await refreshDisplays();

  if (effective_id.value == null) {
    // "Mesma janela" ou fallback resultou em null — fecha projeção aberta
    if (projection_open.value) await closeProjection(featureName.value);
  } else {
    // Re-abre no monitor efetivo (escolhido ou herdado)
    if (projection_open.value) await closeProjection(featureName.value);
    await openProjection({
      feature: featureName.value,
      route: routePath.value,
      monitorId: effective_id.value,
      fullscreen: props.fullscreen,
      alwaysOnTop: props.alwaysOnTop,
    });
  }
  await refreshDisplays();
}

async function closeOpen() {
  if (isProjectionMode.value) {
    await closeProjection(featureName.value);
    await refreshDisplays();
  } else {
    Popup.close();
  }
}

async function identify() {
  await identifyDisplays(5000);
}

async function detectScreens() {
  await requestScreenAccess();
  await refreshDisplays();
}

let pollTimer = null;
onMounted(async () => {
  await refreshDisplays();
  // Polling leve para refletir abertura/fechamento externo (ex: usuário fechou
  // a janela da projeção pelo X). 2s é suficiente — operação raramente urgente.
  // Defensiva contra remount/HMR: limpa interval anterior antes de criar outro.
  if (pollTimer) clearInterval(pollTimer);
  if (isProjectionMode.value) {
    pollTimer = setInterval(async () => {
      const open = await isProjectionOpen(featureName.value);
      if (open !== projection_open.value) projection_open.value = open;
    }, 2000);
  }
});

onUnmounted(() => {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
});

watch([() => props.module, () => props.feature, () => props.route], () => {
  refreshDisplays();
});
</script>

<style scoped>
.screen-btn {
  display: inline-flex;
  align-items: center;
}

/* Split button: os dois controles se encostam e o traço do meio não duplica. */
.screen-btn__main {
  border-top-right-radius: 0;
  border-bottom-right-radius: 0;
}

.screen-btn__chevron {
  margin-left: -1px;
  border-top-left-radius: 0;
  border-bottom-left-radius: 0;
}

/* Projeção aberta — o vermelho de estado que o `color="error"` do v-btn dava.
   Repetido no :hover porque a variante ghost troca a cor ao passar o mouse. */
.screen-btn .screen-btn__main--active,
.screen-btn .screen-btn__main--active:hover {
  background: var(--lj-danger-soft);
  color: var(--lj-danger);
}
</style>
