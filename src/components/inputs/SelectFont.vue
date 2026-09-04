<template>
  <LjSelect
    v-model="model"
    :items="orderedFonts"
    item-value="family"
    item-label="name"
    :disabled="disabled"
    placeholder="—"
  >
    <template #value="{ item }">
      <span :style="{ fontFamily: fontPreview(item?.family || '') }">
        {{ item?.name || "—" }}
      </span>
    </template>
    <template #item="{ item }">
      <span :style="{ fontFamily: fontPreview(item.family) }">{{ item.name }}</span>
    </template>
  </LjSelect>
</template>

<script setup lang="ts">
import { computed } from "vue";
import LjSelect from "@/components/ui/LjSelect.vue";
import { FONT, Fonts, resolveFont, type FontOption } from "@/config/Fonts";

const props = withDefaults(
  defineProps<{
    modelValue?: string | null;
    disabled?: boolean;
    showInterfaceDefault?: boolean;
    showProjectionDefault?: boolean;
    defaultFont?: string;
  }>(),
  {
    modelValue: "",
    disabled: false,
    showInterfaceDefault: true,
    showProjectionDefault: true,
    defaultFont: "",
  }
);

const emit = defineEmits<{ "update:modelValue": [value: string] }>();

const model = computed({
  get: () => props.modelValue ?? "",
  set: (value) => emit("update:modelValue", value as string),
});

function fontPreview(family: string): string {
  return resolveFont(family, "inherit", props.defaultFont);
}

const orderedFonts = computed<FontOption[]>(() => {
  const filtered = [...Fonts];

  const padraoInterface = props.showInterfaceDefault
    ? filtered.find((f) => f.family === FONT.UI.INHERIT)
    : undefined;
  const padraoProjecao = props.showProjectionDefault
    ? filtered.find((f) => f.family === FONT.PROJECTION.INHERIT)
    : undefined;

  const realFonts = filtered
    .filter((f) => f.family !== FONT.UI.INHERIT && f.family !== FONT.PROJECTION.INHERIT)
    .sort((a, b) => a.name.localeCompare(b.name));

  const padrao = props.defaultFont
    ? ({ name: "Padrão", family: FONT.DEFAULT } as FontOption)
    : undefined;

  return [padrao, padraoInterface, padraoProjecao, ...realFonts].filter(Boolean) as FontOption[];
});
</script>

<style scoped>
/* Largura herdada da tela de Opções, onde este controle aparece ao lado dos
   demais selects. A caixa, o raio e a altura vêm do LjSelect. */
.lj-select {
  width: var(--lj-opt-select-width);
}
</style>
