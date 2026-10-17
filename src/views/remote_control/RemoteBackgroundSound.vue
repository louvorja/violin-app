<template>
  <div class="rbs-root">
    <!-- Tocando agora -->
    <div class="rbs-section">
      <span class="rbs-section__label">{{ t("remote_control.bgsound.now") }}</span>

      <div class="rbs-now">
        <div class="rbs-now__text">
          <span class="rbs-now__name">
            {{ currentName || t("remote_control.bgsound.nothing") }}
          </span>
          <span class="rbs-now__volume" :title="t('remote_control.bgsound.volume')">
            <LjIcon :icon="ICONS.PLAYER.VOLUME_HIGH" :size="12" />
            {{ volume }}
          </span>
        </div>
        <div class="rbs-now__actions">
          <button
            v-if="playing"
            type="button"
            class="rbs-btn"
            :disabled="busy"
            @click="command('pause')"
          >
            <LjIcon :icon="ICONS.PLAYER.PAUSE" :size="16" />
            <span>{{ t("remote_control.bgsound.pause") }}</span>
          </button>
          <button
            v-else-if="currentId"
            type="button"
            class="rbs-btn rbs-btn--primary"
            :disabled="busy"
            @click="command('resume')"
          >
            <LjIcon :icon="ICONS.PLAYER.PLAY" :size="16" />
            <span>{{ t("remote_control.bgsound.resume") }}</span>
          </button>
          <button
            v-if="currentId"
            type="button"
            class="rbs-btn rbs-btn--danger"
            :disabled="busy"
            @click="command('stop')"
          >
            <LjIcon :icon="ICONS.PROJECTION.STOP" :size="16" />
            <span>{{ t("remote_control.bgsound.stop") }}</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Biblioteca -->
    <div class="rbs-section">
      <span class="rbs-section__label">{{ t("remote_control.bgsound.library") }}</span>

      <p v-if="loading && !files.length" class="rbs-empty">
        <LjSpinner :size="20" />
      </p>
      <p v-else-if="!files.length" class="rbs-empty">{{ t("remote_control.bgsound.empty") }}</p>

      <template v-for="group in groups" :key="group.id">
        <span class="rbs-category" :style="group.color ? { color: group.color } : undefined">
          {{ group.name }}
        </span>
        <div class="rbs-list">
          <button
            v-for="file in group.files"
            :key="file.id"
            type="button"
            class="rbs-sound"
            :class="{ 'rbs-sound--current': file.id === currentId }"
            :disabled="busy"
            @click="onTap(file)"
          >
            <LjIcon
              :icon="file.id === currentId && playing ? ICONS.PLAYER.PAUSE : ICONS.PLAYER.PLAY"
              :size="14"
            />
            <span class="rbs-sound__name">{{ file.name }}</span>
          </button>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { LjIcon, LjSpinner } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { apiFetch, postApi } from "@/helpers/ApiClient";
import { httpErrorMessage } from "@/helpers/httpErrorMessage";

/**
 * Som de fundo no controle remoto: mesma biblioteca e o mesmo player single
 * do desktop (roda sem o módulo aberto). Os bytes ficam no renderer da
 * aplicação — aqui só chegam metadados.
 */
const props = defineProps<{ token?: string }>();

const emit = defineEmits<{
  (_e: "show-snackbar", _message: string, _type?: string): void;
}>();

const { t } = useI18n();

// true desde o início: sem isto o primeiro frame (antes do onMounted) mostrava
// "Nenhum som de fundo cadastrado" junto com o estado vazio.
const loading = ref(true);
const busy = ref(false);
const playing = ref(false);
const currentId = ref<string | null>(null);
const currentName = ref("");
const volume = ref(50);
const files = ref<{ id: string; name: string; categoryId: string | null }[]>([]);
const categories = ref<{ id: string; name: string; color: string | null }[]>([]);

/** Agrupa por categoria; sem categoria (ou sem id) cai no rótulo avulso. */
const groups = computed(() => {
  const byCategory = new Map<
    string,
    { id: string; name: string; color: string | null; files: typeof files.value }
  >();
  const add = (id: string, name: string, color: string | null) => {
    if (!byCategory.has(id)) byCategory.set(id, { id, name, color, files: [] });
    return byCategory.get(id)!;
  };
  for (const category of categories.value) {
    add(category.id, category.name || t("remote_control.bgsound.uncategorized"), category.color);
  }
  const loose = add("__none__", t("remote_control.bgsound.uncategorized"), null);
  for (const file of files.value) {
    const target = file.categoryId ? byCategory.get(file.categoryId) || loose : loose;
    target.files.push(file);
  }
  return [...byCategory.values()].filter((group) => group.files.length > 0);
});

async function refresh(): Promise<void> {
  loading.value = true;
  try {
    const res = await apiFetch(`/api/background-sound?token=${props.token || ""}`);
    if (!res.ok) {
      throw new Error(await httpErrorMessage(res, t("remote_control.errors.generic")));
    }
    const data = await res.json();
    playing.value = Boolean(data.playing);
    volume.value = Number.isFinite(data.volume) ? data.volume : 50;
    files.value = Array.isArray(data.files) ? data.files : [];
    categories.value = Array.isArray(data.categories) ? data.categories : [];
    currentId.value = data.currentId ?? null;
    currentName.value = files.value.find((file) => file.id === data.currentId)?.name || "";
  } catch (error) {
    emit("show-snackbar", error instanceof Error ? error.message : String(error), "error");
  } finally {
    loading.value = false;
  }
}

/** Na linha atual: pausa se toca, retoma se pausou; nas demais, (re)inicia. */
function onTap(file: { id: string }) {
  if (file.id !== currentId.value) return void send({ action: "play", id: file.id });
  if (playing.value) return void send({ action: "pause" });
  return void send({ action: "resume" });
}

function command(action: "pause" | "resume" | "stop") {
  void send({ action });
}

async function send(body: Record<string, unknown>) {
  busy.value = true;
  try {
    const res = await postApi("/api/background-sound", body, props.token);
    if (!res.ok) {
      throw new Error(await httpErrorMessage(res, t("remote_control.errors.generic")));
    }
    await refresh();
  } catch (error) {
    emit("show-snackbar", error instanceof Error ? error.message : String(error), "error");
  } finally {
    busy.value = false;
  }
}

onMounted(() => void refresh());

defineExpose({ refresh });
</script>

<style scoped>
.rbs-root {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-6);
  padding: var(--lj-space-4);
}

.rbs-section {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-3);
}

.rbs-section__label {
  font-size: var(--lj-text-xs);
  font-weight: var(--lj-weight-medium);
  color: var(--lj-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.rbs-now {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--lj-space-3);
  padding: var(--lj-space-3) var(--lj-space-4);
  background: var(--lj-surface-bg);
  border: var(--lj-ui-border);
  border-radius: var(--lj-ui-radius);
}

.rbs-now__text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.rbs-now__name {
  font-size: var(--lj-text-sm);
  font-weight: var(--lj-weight-medium);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rbs-now__volume {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--lj-text-xs);
  color: var(--lj-text-muted);
}

.rbs-now__actions {
  display: flex;
  gap: var(--lj-space-2);
  flex-shrink: 0;
}

.rbs-empty {
  font-size: var(--lj-text-sm);
  color: var(--lj-text-muted);
}

.rbs-category {
  font-size: var(--lj-text-xs);
  font-weight: var(--lj-weight-semibold);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.rbs-list {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-2);
}

.rbs-sound {
  display: flex;
  align-items: center;
  gap: var(--lj-space-3);
  min-height: 48px;
  padding: var(--lj-space-2) var(--lj-space-3);
  background: var(--lj-surface-bg);
  border: var(--lj-ui-border);
  border-radius: var(--lj-ui-radius);
  color: var(--lj-text);
  font: inherit;
  font-size: var(--lj-text-sm);
  text-align: left;
  cursor: pointer;
  transition:
    transform 80ms,
    background 150ms;
}

.rbs-sound:active:not(:disabled) {
  transform: scale(0.98);
  background: var(--lj-surface-bg-active);
}

.rbs-sound:focus-visible {
  outline: none;
  box-shadow: var(--lj-ui-focus);
}

.rbs-sound:disabled {
  opacity: 0.6;
  cursor: default;
}

.rbs-sound--current {
  border-color: var(--lj-ui-accent);
}

.rbs-sound__name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rbs-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--lj-space-2);
  min-height: 40px;
  padding: var(--lj-space-2) var(--lj-space-3);
  background: var(--lj-surface-bg);
  border: var(--lj-ui-border);
  border-radius: var(--lj-ui-radius);
  color: var(--lj-text);
  font: inherit;
  font-size: var(--lj-text-xs);
  font-weight: var(--lj-weight-medium);
  cursor: pointer;
}

.rbs-btn:active:not(:disabled) {
  background: var(--lj-surface-bg-active);
}

.rbs-btn:focus-visible {
  outline: none;
  box-shadow: var(--lj-ui-focus);
}

.rbs-btn:disabled {
  opacity: 0.6;
  cursor: default;
}

.rbs-btn--primary {
  background: var(--lj-ui-accent);
  border-color: var(--lj-ui-accent);
  color: var(--lj-ui-accent-fg);
}

.rbs-btn--danger {
  background: var(--lj-danger-soft);
  border-color: var(--lj-danger-border);
  color: var(--lj-danger);
}
</style>
