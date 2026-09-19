<template>
  <div ref="container" class="clock-fullscreen" :style="rootStyle">
    <div class="clock-time" :style="textStyle">{{ time }}</div>
    <div v-if="date" class="clock-date" :style="referenceStyle">{{ date }}</div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from "vue";
import { useI18n } from "vue-i18n";
import { localeTag } from "@/helpers/DateTime";
import UserData from "@/helpers/UserData";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import { useBroadcastListener } from "@/composables/useBroadcastListener";
import { useModuleBodyStyle } from "@/composables/useModuleBodyStyle";

const { locale } = useI18n();
const { rootStyle, textStyle, referenceStyle, container } = useModuleBodyStyle("clock");
const time = ref("");
const date = ref("");
const timer = ref(null);
const show24h = ref(null);
const showSeconds = ref(null);
const showDate = ref(true);
const dateFormat = ref("long");

const DATE_FORMATS = {
  long: { weekday: "long", day: "2-digit", month: "long", year: "numeric" },
  medium: { day: "2-digit", month: "long", year: "numeric" },
  short: { day: "2-digit", month: "2-digit", year: "numeric" },
  weekday: { weekday: "long", day: "2-digit", month: "long" },
  month_year: { month: "long", year: "numeric" },
  weekday_only: { weekday: "long" },
};

const _tick = ref(0);

function readClockOptions() {
  void _tick.value;
  const params = new URLSearchParams(window.location.search);
  const savedHourCycle = UserData.get("modules.clock.hour_cycle", null);
  const savedTimeFormat = UserData.get("modules.clock.time_format", null);
  const savedShowDate = UserData.get("modules.clock.show_date", null);
  const savedDateFormat = UserData.get("modules.clock.date_format", null);

  show24h.value = savedHourCycle != null ? savedHourCycle === "24h" : params.get("h24") !== "0";
  showSeconds.value =
    savedTimeFormat != null ? savedTimeFormat === "hh:mm:ss" : params.get("sec") !== "0";
  showDate.value = savedShowDate !== false;
  dateFormat.value = typeof savedDateFormat === "string" ? savedDateFormat : "long";
}

function _onKey(e) {
  if (e.key === "Escape") {
    e.preventDefault();
    window.close();
  }
}

function tick() {
  readClockOptions();
  const now = new Date();
  const tag = localeTag(locale.value);
  time.value = now.toLocaleTimeString(tag, {
    hour: "2-digit",
    minute: "2-digit",
    ...(showSeconds.value ? { second: "2-digit" } : {}),
    hour12: !show24h.value,
  });
  date.value = showDate.value
    ? now.toLocaleDateString(tag, DATE_FORMATS[dateFormat.value] || DATE_FORMATS.long)
    : "";
}

useBroadcastListener(BROADCAST_TYPE.MODULE_FORMAT_CHANGED, (payload) => {
  if (payload?.module === "clock") {
    _tick.value += 1;
    tick();
  }
});

useBroadcastListener(BROADCAST_TYPE.USERDATA_PATCH, (payload) => {
  if (typeof payload?.path === "string" && payload.path.startsWith("modules.clock.")) {
    _tick.value += 1;
    tick();
  }
});

onMounted(() => {
  tick();
  timer.value = setInterval(tick, 1000);
  window.addEventListener("keydown", _onKey);
});

onBeforeUnmount(() => {
  clearInterval(timer.value);
  window.removeEventListener("keydown", _onKey);
});
</script>

<style scoped>
.clock-fullscreen {
  width: 100vw;
  height: 100vh;
  height: 100dvh;
  box-sizing: border-box;
  overflow: hidden;
  background: #000;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0;
  cursor: none;
}
.clock-time {
  font-size: clamp(4rem, 18vw, 16rem);
  font-weight: 300;
  letter-spacing: 0.1em;
  font-variant-numeric: tabular-nums;
  color: #fff;
  line-height: 1;
}
.clock-date {
  font-weight: 300;
  letter-spacing: 0.05em;
  margin-top: 0.4em;
}
</style>
