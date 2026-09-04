<template>
  <LjSelect
    :id="id"
    v-model="model"
    :items="options"
    item-value="role"
    item-label="label"
    class="lj-monitor-select"
    :class="{ 'lj-monitor-select--inline': inline }"
  >
    <template #item="{ item }">
      <span class="lj-monitor-select__option">
        {{ item.label }}
        <small v-if="item.hint" class="lj-monitor-select__hint">{{ item.hint }}</small>
      </span>
    </template>
  </LjSelect>
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
import LjSelect from "@/components/ui/LjSelect.vue";
import { DISPLAY_ROLES, useDisplays } from "@/composables/useDisplays";

const props = defineProps<{
  id?: string;
  /** Papel escolhido: "projection" | "stage" | "operator", ou "" para mesma janela. */
  modelValue?: string | null;
  inline?: boolean;
}>();

const emit = defineEmits<{ "update:modelValue": [value: string] }>();

const { t } = useI18n();
const { displays, roles } = useDisplays();

const model = computed({
  get: () => props.modelValue ?? "",
  set: (value) => emit("update:modelValue", String(value)),
});

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

const options = computed(() => [
  { role: "", label: t("options.slides.same_window"), hint: "" },
  ...DISPLAY_ROLES.map((role) => ({
    role,
    label: t(`options.monitors.roles.${role}`),
    hint: hintFor(role),
  })),
]);
</script>

<style scoped>
.lj-monitor-select {
  width: var(--lj-opt-select-width);
}

.lj-monitor-select--inline {
  width: auto;
}

.lj-monitor-select__option {
  display: flex;
  flex-direction: column;
}

.lj-monitor-select__hint {
  color: var(--lj-text-subtle);
  font-size: var(--lj-text-xs);
}
</style>
