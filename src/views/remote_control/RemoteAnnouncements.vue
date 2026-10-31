<template>
  <div class="ra-root">
    <div v-if="loading" class="ra-state ra-state--loading">
      <LjSpinner :size="32" />
    </div>
    <div v-else-if="announcements.length === 0" class="ra-state lj-u-text-center lj-u-muted">
      {{ t("remote_control.announcements.empty") }}
    </div>
    <ul v-else class="ra-list">
      <li v-for="ann in announcements" :key="ann.id">
        <div class="ra-item">
          <span class="ra-item__badge">
            <LjIcon :icon="ICONS.MODULES.ANNOUNCEMENTS" size="18" />
          </span>
          <span class="ra-item__text">
            <span class="ra-item__title lj-u-truncate">{{ ann.nome }}</span>
            <span v-if="ann.hasImage" class="ra-item__subtitle lj-u-truncate">
              {{ t("remote_control.announcements.with_image") }}
            </span>
          </span>
          <button
            type="button"
            class="ra-item__play"
            :aria-label="t('remote_control.announcements.project')"
            @click="projectAnnouncement(ann)"
          >
            <LjIcon :icon="ICONS.PLAYER.PLAY_OUTLINE" color="primary" />
          </button>
        </div>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { LjIcon, LjSpinner } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { ref, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { apiFetch, postApi } from "@/helpers/ApiClient";

interface Announcement {
  id: string;
  nome: string;
  ordem: number;
  hasImage?: boolean;
  hasVideo?: boolean;
}

const props = defineProps<{
  token?: string;
}>();

const emit = defineEmits<{
  (e: "show-snackbar", message: string, type?: string): void;
  (e: "update:tab", tab: string): void;
  (e: "update:ann-projecting", value: boolean): void;
}>();

const { t } = useI18n();
const loading = ref(false);
const announcements = ref<Announcement[]>([]);

async function fetchAnnouncements(): Promise<void> {
  loading.value = true;
  try {
    const res = await apiFetch(`/api/announcements?action=list&token=${props.token}`);
    if (res.ok) {
      const data = (await res.json()) as { announcements?: Announcement[] };
      announcements.value = data.announcements || [];
    }
  } catch (e) {
    console.error("Erro ao buscar anúncios:", e);
  } finally {
    loading.value = false;
  }
}

async function projectAnnouncement(ann: Announcement): Promise<void> {
  try {
    const res = await postApi(
      "/api/announcements",
      { action: "project", ids: [ann.id] },
      props.token
    );
    if (res.ok) {
      emit("update:ann-projecting", true);
      emit("show-snackbar", t("remote_control.announcements.executed", { name: ann.nome }));
    }
  } catch (e) {
    emit("show-snackbar", t("remote_control.errors.generic"), "error");
  }
}

onMounted(() => {
  fetchAnnouncements();
});

defineExpose({
  refresh: fetchAnnouncements,
});
</script>

<style scoped>
.ra-root {
  padding: var(--lj-space-6);
}

.ra-state {
  padding: var(--lj-space-8);
  font-size: var(--lj-text-lg);
}

.ra-state--loading {
  color: var(--lj-ui-accent);
  text-align: center;
}

.ra-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

/* Tela de dedo: linha na altura de toque; só o botão de play projeta. */
.ra-item {
  display: flex;
  align-items: center;
  gap: var(--lj-space-5);
  width: 100%;
  min-height: 56px;
  padding: var(--lj-space-4) var(--lj-space-5);
  border-radius: var(--lj-ui-radius);
  color: inherit;
  font: inherit;
  text-align: left;
}

.ra-item__play {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  padding: 0;
  background: var(--lj-surface-bg-hover);
  border: none;
  border-radius: 50%;
  cursor: pointer;
}

.ra-item__play:hover {
  background: var(--lj-surface-bg-active);
}

.ra-item__play:focus-visible {
  outline: none;
  box-shadow: var(--lj-ui-focus);
}

.ra-item__badge {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  background: var(--lj-ui-accent);
  border-radius: 50%;
  color: var(--lj-ui-accent-fg);
}

.ra-item__text {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--lj-space-1);
  min-width: 0;
}

.ra-item__title {
  color: var(--lj-text);
  font-size: var(--lj-text-xl);
}

.ra-item__subtitle {
  color: var(--lj-text-muted);
  font-size: var(--lj-text-lg);
}
</style>
