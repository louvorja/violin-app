<template>
  <v-checkbox
    :model-value="checked"
    density="compact"
    hide-details
    class="dont-show-again"
    @update:model-value="onChange"
  >
    <template #label>
      <span class="text-label-small">{{ label }}</span>
    </template>
  </v-checkbox>
</template>

<script setup lang="ts">
import { ref } from "vue";
import $userdata from "@/helpers/UserData";

const props = defineProps<{
  /** Chave em UserData — use KEYS.OPTIONS.*. */
  storageKey: string;
  label: string;
  /** Valor gravado ao marcar. Omitido = `true` (flags booleanas). */
  value?: string;
}>();

const marked = (): string | boolean => props.value ?? true;

const checked = ref($userdata.get(props.storageKey, false) === marked());

// Grava no clique, não na saída do diálogo: quem fechava pelo "Minimizar" ou
// pela janela do app perdia a escolha, porque só um dos caminhos persistia.
function onChange(v: boolean | null): void {
  checked.value = !!v;
  $userdata.set(props.storageKey, v ? marked() : false);
}
</script>

<style scoped>
.dont-show-again {
  margin: 0;
  flex: 0 1 auto;
}
</style>
