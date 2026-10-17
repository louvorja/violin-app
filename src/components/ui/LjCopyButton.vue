<template>
  <button
    class="lj-copy-btn"
    :class="[{ 'lj-copy-btn--copied': copied }, attrs.class]"
    @click="handleCopy"
  >
    <slot v-if="!copied" />
    <span v-else class="lj-copy-btn__label">
      <LjIcon :icon="ICONS.UI.CHECK" :size="13" />
      {{ t("components.ui.copied") }}
    </span>
  </button>
</template>

<script setup lang="ts">
import { ref, useAttrs } from "vue";
import { useI18n } from "vue-i18n";
import { LjIcon } from "@/components/ui";
import { ICONS } from "@/config/Icons";

defineOptions({ inheritAttrs: false });

const { t } = useI18n();
const attrs = useAttrs();

const props = withDefaults(
  defineProps<{
    value: string;
    duration?: number;
  }>(),
  { duration: 3000 }
);

const copied = ref(false);
let timer: ReturnType<typeof setTimeout> | null = null;

/**
 * Copia e diz se deu certo.
 *
 * `navigator.clipboard` só existe em contexto seguro (https ou localhost). No
 * desktop isso é sempre verdade — `louvorja://` é privilegiado com `secure` e
 * o dev roda em localhost. Sem a API (PWA servida em http puro), não copia e
 * **não** mostra "Copiado": fingir seria pior do que não copiar.
 *
 * Por que não o comando de cópia deprecada do DOM, que habitou aqui: a
 * alternativa moderna é justamente `navigator.clipboard`, que já é o caminho
 * principal. Trocar um TypeError por um aviso de deprecação não resolve nada.
 */
async function copiar(): Promise<boolean> {
  if (!navigator.clipboard?.writeText) return false;
  try {
    await navigator.clipboard.writeText(props.value);
    return true;
  } catch {
    return false;
  }
}

async function handleCopy() {
  if (!props.value) return;
  /* Sem copiar não se mostra "Copiado" — mentira o feedback. */
  if (!(await copiar())) return;
  if (timer) clearTimeout(timer);
  copied.value = true;
  timer = setTimeout(() => {
    copied.value = false;
    timer = null;
  }, props.duration);
}
</script>

<style scoped>
.lj-copy-btn {
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  font: inherit;
  color: inherit;
}
.lj-copy-btn__label {
  display: inline-flex;
  align-items: center;
  gap: var(--lj-space-2);
  color: var(--lj-success);
}
</style>
