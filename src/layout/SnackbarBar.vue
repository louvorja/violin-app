<template>
  <LjToast
    v-model="show"
    :text="snackbar.text"
    :variant="variant"
    :icon="snackbar.icon || defaultIcon"
    :timeout="snackbar.timeout ?? 4000"
    :clickable="actionable"
    @click="onClick"
  />
</template>

<script setup lang="ts">
import { computed } from "vue";
import LjToast from "@/components/ui/LjToast.vue";
import { ICONS } from "@/config/Icons";
import $appdata from "@/helpers/AppData";
import $snackbar from "@/helpers/Snackbar";

interface SnackbarState {
  show: boolean;
  text: string;
  color: string;
  icon: string | null;
  timeout: number;
}

type ToastVariant = "info" | "success" | "warning" | "error";

const snackbar = computed((): SnackbarState => {
  const raw = $appdata.get("snackbar");
  if (!raw) return { show: false, text: "", color: "info", icon: null, timeout: 4000 };
  return raw as SnackbarState;
});

const show = computed({
  get: () => snackbar.value.show === true,
  set: (v) => $appdata.set("snackbar.show", v),
});

// O helper Snackbar fala em "color" (herança do Vuetify); o primitivo fala em
// variante semântica. A conversão fica aqui para não mudar a API de quem chama.
const VARIANTS: Record<string, ToastVariant> = {
  info: "info",
  success: "success",
  warning: "warning",
  error: "error",
  danger: "error",
};

const variant = computed<ToastVariant>(() => VARIANTS[snackbar.value.color] ?? "info");

const DEFAULT_ICONS: Record<ToastVariant, string> = {
  info: ICONS.UI.INFORMATION_OUTLINE,
  success: ICONS.UI.CHECK,
  warning: ICONS.UI.ALERT,
  error: ICONS.UI.ALERT,
};

const defaultIcon = computed(() => DEFAULT_ICONS[variant.value]);

const actionable = computed(() => $snackbar.hasAction());

function onClick(): void {
  const action = $snackbar.takeAction();
  if (action) {
    show.value = false;
    action();
  }
}
</script>
