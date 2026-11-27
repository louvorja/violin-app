<template>
  <div v-if="info" class="liturgy-ribbon-info" :style="{ '--info-color': info.color }">
    <div class="liturgy-ribbon-info__header">
      <span class="liturgy-ribbon-info__icon" aria-hidden="true">
        <LjIcon :icon="info.name ? ICONS_MODULE_LITURGY : ICONS.LITURGY.SCRIPT" size="16" />
      </span>
      <span class="liturgy-ribbon-info__name" :title="displayTitle">{{ displayTitle }}</span>
    </div>
    <div class="liturgy-ribbon-info__stats">
      <span class="liturgy-ribbon-info__stat">
        <LjIcon :icon="ICONS.UI.CHECK_CIRCLE" size="13" />
        {{ itemsSummary }}
      </span>
      <span v-if="timeRange" class="liturgy-ribbon-info__stat">
        <LjIcon :icon="ICONS.TIMER.CLOCK_START" size="13" />
        {{ timeRange }}
      </span>
      <span v-if="formattedDuration" class="liturgy-ribbon-info__stat">
        <LjIcon :icon="ICONS.TIMER.TIMER_OUTLINE" size="13" />
        {{ formattedDuration }}
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { LjIcon } from "@/components/ui";
import { computed } from "vue";
import $appdata from "@/helpers/AppData";
import { ICONS } from "@/config/Icons";
import { formatarDuracao } from "../agenda";
import { useLiturgyI18n } from "../i18n";

const { t } = useLiturgyI18n();
const ICONS_MODULE_LITURGY = ICONS.MODULES.LITURGY;

interface LiturgyInfo {
  name: string;
  dayLabel?: string;
  color: string;
  itemCount?: number;
  doneCount?: number;
  startTime: string;
  endTime: string;
  duration: number;
}

const info = computed((): LiturgyInfo | null => {
  const active = $appdata.get("active_module");
  if (active !== "liturgy") return null;

  const raw = $appdata.get("liturgy_info");
  if (!raw) return null;

  return raw as LiturgyInfo;
});

const displayTitle = computed(() => {
  if (!info.value) return "";
  return info.value.name || info.value.dayLabel || t("title");
});

const itemsSummary = computed(() => {
  const count = info.value?.itemCount ?? 0;
  const done = info.value?.doneCount ?? 0;
  if (count === 0) return t("ribbon_info.empty");
  if (done > 0) return t("ribbon_info.done", { done, total: count });
  return count === 1 ? t("ribbon_info.item_one") : t("ribbon_info.item_many", { count });
});

const timeRange = computed(() => {
  const start = info.value?.startTime || "";
  const end = info.value?.endTime || "";
  if (!start) return "";
  return end && end !== start ? `${start} – ${end}` : start;
});

const formattedDuration = computed(() => {
  if (!info.value) return "";
  return formatarDuracao(info.value.duration);
});
</script>

<style scoped>
.liturgy-ribbon-info {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: var(--lj-space-2);
  padding: var(--lj-space-2) var(--lj-space-4);
  font-size: var(--lj-text-sm);
  min-width: 150px;
  max-width: 260px;
  height: 100%;
}

.liturgy-ribbon-info__header {
  display: flex;
  align-items: center;
  gap: var(--lj-space-2);
  font-weight: var(--lj-weight-semibold);
  font-size: var(--lj-text-base);
  color: var(--lj-text);
  min-width: 0;
}

.liturgy-ribbon-info__icon {
  display: inline-flex;
  align-items: center;
  color: var(--info-color, var(--lj-ui-accent));
  flex-shrink: 0;
}

.liturgy-ribbon-info__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.liturgy-ribbon-info__stats {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--lj-space-2) var(--lj-space-4);
  color: var(--lj-text-muted);
  font-variant-numeric: tabular-nums;
}

.liturgy-ribbon-info__stat {
  display: inline-flex;
  align-items: center;
  gap: var(--lj-space-1);
  white-space: nowrap;
}
</style>

<style>
html[data-theme="dark"] .liturgy-ribbon-info__icon {
  color: color-mix(in oklab, var(--info-color, var(--lj-ui-accent)) 42%, var(--lj-white));
}
</style>
