<template>
  <p v-if="!fonts.length" class="pptx-fonts__empty">{{ tm("pptx.no_fonts") }}</p>
  <ul v-else class="pptx-fonts">
    <li v-for="f in fonts" :key="f.name" class="pptx-fonts__item">
      <LjIcon
        :icon="iconeDe(f.status)"
        :size="16"
        :class="`pptx-fonts__icon--${tomDe(f.status)}`"
      />
      <span class="pptx-fonts__name" :title="f.name">{{ f.name }}</span>
      <LjChip size="sm" :variant="tomDe(f.status)">{{ rotuloDe(f) }}</LjChip>
    </li>
  </ul>
</template>

<script setup lang="ts">
import { LjChip, LjIcon } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { fontTone, type FontTone } from "../pptxImport";

/** Lista das fontes do .pptx com a situação de cada uma, em linguagem de operador. */
const props = defineProps<{
  fonts: { name: string; status: string; source?: string | null }[];
  tm: (_key: string, _named?: Record<string, unknown>) => string;
}>();

const tomDe = (status: string): FontTone => fontTone(status);

function iconeDe(status: string): string {
  const tom = fontTone(status);
  if (tom === "success") return ICONS.UI.CHECK_CIRCLE;
  if (tom === "danger" || tom === "warning") return ICONS.UI.ALERT;
  return ICONS.UI.CHECK_CIRCLE;
}

function rotuloDe(f: { status: string; source?: string | null }): string {
  if (f.status === "installed" && f.source) {
    const fonte =
      f.source === "google" ? props.tm("pptx.source_google") : props.tm("pptx.source_embedded");
    return props.tm("pptx.font_installed_from", { source: fonte });
  }
  const chave: Record<string, string> = {
    ok: "pptx.font_ok",
    office: "pptx.font_office",
    embedded: "pptx.font_embedded",
    installed: "pptx.font_installed",
    missing: "pptx.font_missing",
    unmatched: "pptx.font_unmatched",
    searching: "pptx.font_searching",
  };
  return props.tm(chave[f.status] || "pptx.font_ok");
}
</script>

<style scoped>
.pptx-fonts {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}
.pptx-fonts__item {
  display: flex;
  align-items: center;
  gap: var(--lj-space-3);
  min-width: 0;
}
.pptx-fonts__name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pptx-fonts__icon--success {
  color: var(--lj-success);
}
.pptx-fonts__icon--warning {
  color: var(--lj-warning);
}
.pptx-fonts__icon--danger {
  color: var(--lj-danger);
}
.pptx-fonts__icon--neutral,
.pptx-fonts__icon--primary {
  opacity: 0.7;
}
.pptx-fonts__empty {
  margin: 0;
  opacity: 0.75;
}
</style>
