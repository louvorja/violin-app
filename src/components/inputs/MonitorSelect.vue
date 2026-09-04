<template>
  <select
    :id="id"
    class="opt-select"
    :class="{ 'opt-select--inline': inline }"
    :value="modelValue ?? ''"
    @change="onChange"
  >
    <option value="">{{ $t("options.slides.same_window") }}</option>
    <option v-for="option in roleOptions" :key="option.role" :value="option.role">
      {{ option.label }}
      <template v-if="option.hint">— {{ option.hint }}</template>
    </option>
  </select>
</template>

<script setup lang="ts">
/**
 * Escolhe em qual PAPEL de monitor um módulo aparece — não em qual monitor.
 *
 * Os monitores são atribuídos aos papéis uma única vez, em Opções → Monitores.
 * Assim, trocar o projetor de lugar não exige reconfigurar módulo por módulo, e
 * um papel sem monitor simplesmente não abre janela.
 */
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { DISPLAY_ROLES, useDisplays } from "@/composables/useDisplays";

defineProps<{
  id?: string;
  /** Papel escolhido: "projection" | "stage" | "operator", ou "" para mesma janela. */
  modelValue?: string | null;
  inline?: boolean;
}>();

const emit = defineEmits<{ "update:modelValue": [value: string] }>();

const { t } = useI18n();
const { displays, roles } = useDisplays();

/** Descreve o monitor atribuído ao papel, ou por que ele não está disponível. */
function hintFor(role: string): string {
  const state = roles.value.find((r) => r.role === role);
  if (!state || state.status === "none") return t("options.monitors.roles.none");
  if (state.status === "pending") return t("options.monitors.roles.missing");
  if (state.status === "ambiguous") return t("options.monitors.roles.ambiguous");

  const display = displays.value.find((d) => d.id === state.displayId);
  const name = display?.label || `#${state.displayId}`;
  return state.status === "inferred" ? `${name} (${t("options.monitors.roles.inferred")})` : name;
}

const roleOptions = computed(() =>
  DISPLAY_ROLES.map((role) => ({
    role,
    label: t(`options.monitors.roles.${role}`),
    hint: hintFor(role),
  }))
);

function onChange(event: Event): void {
  emit("update:modelValue", (event.target as HTMLSelectElement).value);
}
</script>
