<template>
  <LjDialog v-model="dialog" :title="$t('hotkeys.title')" :icon="ICONS.UI.KEYBOARD" size="md">
    <div v-for="group in groups" :key="group.key" class="hk-group">
      <h3 class="hk-group-title">
        {{ $t("hotkeys.groups." + group.key, group.key) }}
      </h3>

      <div class="hk-list">
        <div v-for="entry in group.entries" :key="entry.combo" class="hk-row">
          <div class="hk-combo">
            <template v-for="(part, i) in entry.comboParts" :key="i">
              <kbd class="hk-kbd">{{ part }}</kbd>
              <span v-if="i < entry.comboParts.length - 1" class="hk-plus">+</span>
            </template>
          </div>
          <div class="hk-desc">
            {{ $t(entry.description, entry.description) }}
          </div>
        </div>
      </div>
    </div>

    <div v-if="groups.length === 0" class="hk-empty">
      {{ $t("shell.no_results") }}
    </div>

    <template #footer>
      <span class="hk-tip">
        <Icon :icon="ICONS.UI.INFORMATION_OUTLINE" size="13" />
        {{ $t("hotkeys.tip", "Pressione Esc para fechar") }}
      </span>
    </template>
  </LjDialog>
</template>

<script setup>
import Icon from "@/components/Icon.vue";
import { LjDialog } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { computed } from "vue";
import Hotkeys from "@/helpers/Hotkeys";

const props = defineProps({
  modelValue: { type: Boolean, default: false },
});

const emit = defineEmits(["update:modelValue"]);

const dialog = computed({
  get: () => props.modelValue,
  set: (v) => emit("update:modelValue", v),
});

const GROUP_ORDER = ["general", "navigation", "media", "liturgy", "bible", "system"];

const groups = computed(() => {
  const all = Hotkeys.list();
  const map = {};

  for (const entry of all) {
    const g = entry.group || "general";
    if (!map[g]) map[g] = { key: g, entries: [] };
    map[g].entries.push({
      ...entry,
      comboParts: (entry.label || entry.combo).split("+"),
    });
  }

  // Ordena conforme GROUP_ORDER, depois alfabético
  return Object.values(map).sort((a, b) => {
    const ai = GROUP_ORDER.indexOf(a.key);
    const bi = GROUP_ORDER.indexOf(b.key);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.key.localeCompare(b.key);
  });
});
</script>

<style scoped>
.hk-group {
  margin-bottom: var(--lj-space-7);
}

.hk-group:last-child {
  margin-bottom: 0;
}

.hk-group-title {
  font-size: var(--lj-text-xs);
  font-weight: var(--lj-weight-semibold);
  color: var(--lj-orange);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin: 0 0 var(--lj-space-3);
  padding-bottom: var(--lj-space-2);
  border-bottom: 1px solid var(--lj-surface-divider);
}

.hk-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.hk-row {
  display: grid;
  grid-template-columns: 200px 1fr;
  align-items: center;
  gap: var(--lj-space-5);
  padding: var(--lj-space-2) 0;
}

.hk-combo {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 2px;
}

.hk-kbd {
  display: inline-flex;
  align-items: center;
  min-width: 22px;
  height: 22px;
  padding: 0 var(--lj-space-2);
  font-size: var(--lj-text-xs);
  font-family: var(--lj-font-mono);
  font-weight: var(--lj-weight-medium);
  border: 1px solid var(--lj-kbd-border);
  border-bottom-width: 2px;
  border-radius: var(--lj-radius-sm);
  background: var(--lj-kbd-bg);
  color: var(--lj-text);
  letter-spacing: 0.02em;
  justify-content: center;
}

.hk-plus {
  font-size: var(--lj-text-xs);
  color: var(--lj-text-subtle);
  margin: 0 2px;
  font-weight: var(--lj-weight-medium);
}

.hk-desc {
  font-size: var(--lj-text-base);
  color: var(--lj-text);
}

.hk-empty {
  text-align: center;
  padding: var(--lj-space-7) 0;
  color: var(--lj-text-muted);
}

/* O rodapé do diálogo alinha à direita; a dica continua à esquerda. */
.hk-tip {
  display: inline-flex;
  align-items: center;
  gap: var(--lj-space-2);
  margin-right: auto;
  font-size: var(--lj-text-sm);
  color: var(--lj-text-muted);
}
</style>
