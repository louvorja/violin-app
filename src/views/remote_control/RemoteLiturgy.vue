<template>
  <div class="rl-root">
    <div v-if="liturgyItems.length === 0" class="rl-empty lj-u-text-center lj-u-muted">
      {{ t("modules.liturgy.empty") }}
    </div>
    <ul v-else class="rl-list">
      <li v-for="item in liturgyItems" :key="item.id">
        <!-- BLOCO: divider bar estilo LiturgyTimeline -->
        <div
          v-if="item.tipo === LiturgyItemTypeEnum.BLOCO"
          class="rl-bloco"
          :style="{ '--cat-color': item.cor || 'primary' }"
          @click="executeLiturgyItem(item)"
        >
          <span class="rl-bloco-line" />
          <span class="rl-bloco-text">
            {{ item.item || t("modules.liturgy.placeholders.bloco") }}
            <span v-if="item.time" class="rl-bloco-time">{{ item.time }}</span>
          </span>
          <span class="rl-bloco-line" />
        </div>

        <!-- Itens normais -->
        <div
          v-else
          class="rl-item"
          role="button"
          tabindex="0"
          @click="executeLiturgyItem(item)"
          @keydown.enter="executeLiturgyItem(item)"
          @keydown.space.prevent="executeLiturgyItem(item)"
        >
          <span class="rl-item__badge" :style="{ background: item.cor || 'var(--lj-ui-accent)' }">
            <Icon :icon="liturgy.iconForItem(item)" color="white" size="18" />
          </span>
          <span class="rl-item__text">
            <span class="rl-item__title lj-u-truncate">{{ item.item }}</span>
            <span v-if="item.subitem" class="rl-item__subtitle lj-u-truncate">
              {{ item.subitem }}
            </span>
          </span>
          <div v-if="isChooseLaterMusic(item)" class="rl-item__actions">
            <LjButton
              variant="ghost"
              size="sm"
              :icon="!isItemChecked(item) ? ICONS.ACTIONS.SEARCH : ''"
              icon-only
              @click.stop="openChooseLater(item)"
            />
            <Icon v-if="isItemChecked(item)" :icon="ICONS.UI.CHECK_CIRCLE" color="success" />
          </div>
          <template v-else>
            <Icon v-if="isItemChecked(item)" :icon="ICONS.UI.CHECK_CIRCLE" color="success" />
            <Icon v-else :icon="ICONS.PLAYER.PLAY_OUTLINE" color="primary" />
          </template>
        </div>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { LjButton } from "@/components/ui";
import Icon from "@/components/Icon.vue";
import { ICONS } from "@/config/Icons";
import { ref, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import type { LiturgyItem } from "@/types/Liturgy";
import { LiturgyItemTypeEnum } from "@/enums/LiturgyItemTypeEnum";
import Liturgy from "@/helpers/Liturgy";
import { apiFetch } from "@/helpers/ApiClient";

const props = defineProps<{
  token?: string;
}>();

const emit = defineEmits<{
  (e: "show-snackbar", message: string, type?: string): void;
  (e: "update:tab", tab: string): void;
  (e: "open-choose-later", item: LiturgyItem): void;
}>();

const { t } = useI18n();
const liturgy = Liturgy;
const liturgyItems = ref<LiturgyItem[]>([]);

async function fetchLiturgy(): Promise<void> {
  try {
    const res = await apiFetch(`/api/liturgy?token=${props.token}`);
    if (res.ok) {
      const data = (await res.json()) as { items?: LiturgyItem[] };
      liturgyItems.value = data.items || [];
    }
  } catch (e) {
    console.error("Erro ao buscar liturgia:", e);
  }
}

async function executeLiturgyItem(item: LiturgyItem): Promise<void> {
  if (isChooseLaterMusic(item)) {
    openChooseLater(item);
    return;
  }
  try {
    const res = await apiFetch(`/api/liturgy-execute?id=${item.id}&tag=audio&token=${props.token}`);
    if (res.ok) {
      emit("show-snackbar", t("components.music_menu.execute") + ": " + item.item);
      if (item.tipo === "musica") {
        emit("update:tab", "slides");
      } else if (item.tipo === "anuncios") {
        emit("update:tab", "announcements");
      } else {
        setTimeout(fetchLiturgy, 500);
      }
    }
  } catch (e) {
    emit("show-snackbar", t("shell.no_results"), "error");
  }
}

function isChooseLaterMusic(item: LiturgyItem): boolean {
  return item.tipo === "musica" && (item.escolha || !item.id_music);
}

function openChooseLater(item: LiturgyItem): void {
  emit("open-choose-later", item);
}

function isItemChecked(item: LiturgyItem): boolean {
  if (!item.checked) return false;
  const d = new Date();
  const today = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
  return item.checked === today;
}

onMounted(() => {
  fetchLiturgy();
});

defineExpose({
  refresh: fetchLiturgy,
});
</script>

<style scoped>
.rl-root {
  padding: var(--lj-space-6);
}

.rl-empty {
  padding: var(--lj-space-8);
  font-size: var(--lj-text-lg);
}

.rl-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

/* Tela de dedo: a linha inteira é o alvo, na altura de toque — a densidade
   de mouse do resto do app não vale aqui. */
.rl-item {
  display: flex;
  align-items: center;
  gap: var(--lj-space-5);
  min-height: 56px;
  padding: var(--lj-space-4) var(--lj-space-5);
  border-radius: var(--lj-ui-radius);
  cursor: pointer;
}

.rl-item:hover {
  background: var(--lj-surface-bg-hover);
}

.rl-item:focus-visible {
  outline: none;
  box-shadow: var(--lj-ui-focus);
}

/* A cor da categoria vem do dado, não de token: é o usuário quem a escolhe
   no planejador de culto. */
.rl-item__badge {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
}

.rl-item__text {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--lj-space-1);
  min-width: 0;
}

.rl-item__title {
  color: var(--lj-text);
  font-size: var(--lj-text-xl);
}

.rl-item__subtitle {
  color: var(--lj-text-muted);
  font-size: var(--lj-text-lg);
}

.rl-item__actions {
  display: flex;
  align-items: center;
  gap: var(--lj-space-1);
}

/* ── BLOCO divider — espelha LiturgyTimeline.vue ── */
.rl-bloco {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 16px 0 4px 0;
  padding: 6px 12px;
  cursor: pointer;
  user-select: none;
  background: color-mix(in srgb, var(--cat-color, var(--lj-divider)) 10%, transparent);
  border-radius: 8px;
}
.rl-bloco-line {
  flex: 1;
  height: 3px;
  background: var(--cat-color, var(--lj-divider));
  opacity: 0.7;
}
.rl-bloco-text {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 700;
  color: var(--cat-color, var(--lj-text));
  text-transform: uppercase;
  letter-spacing: 0.08em;
  white-space: nowrap;
}
.rl-bloco-time {
  font-size: 14px;
  font-weight: 600;
  color: var(--lj-orange);
  background: var(--lj-orange-soft);
  padding: 2px 8px;
  border-radius: 4px;
  text-transform: none;
  letter-spacing: 0;
  display: inline-flex;
  align-items: center;
}
</style>
