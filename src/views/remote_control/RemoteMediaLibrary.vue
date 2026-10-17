<template>
  <div class="rm-root">
    <!-- Abas internas: acervo, Canva integrado e playlist do desktop. -->
    <div class="rm-tabs">
      <button
        v-for="option in tabs"
        :key="option.value"
        type="button"
        class="rm-tabs__btn"
        :class="{ 'rm-tabs__btn--active': view === option.value }"
        @click="switchView(option.value)"
      >
        {{ option.label }}
      </button>
      <button
        type="button"
        class="rm-tabs__upload"
        :disabled="uploading"
        :title="t('remote_control.media_library.upload')"
        @click="pickFile"
      >
        <LjIcon :icon="ICONS.UI.FILE_PLUS" :size="18" />
        <span class="lj-u-sr-only">{{ t("remote_control.media_library.upload") }}</span>
      </button>
      <input
        ref="fileInput"
        class="lj-u-sr-only"
        type="file"
        accept="image/*,video/*,.pdf,.heic,.heif"
        @change="onFilePicked"
      />
    </div>

    <!-- Vistas do Canva: pastas (padrão do desktop) e designs. -->
    <div v-if="view === 'canva'" class="rm-tabs rm-tabs--sub">
      <button
        v-for="option in canvaViews"
        :key="option.value"
        type="button"
        class="rm-tabs__btn"
        :class="{ 'rm-tabs__btn--active': canvaView === option.value }"
        @click="switchCanvaView(option.value)"
      >
        {{ option.label }}
      </button>
    </div>

    <!-- Biblioteca de Mídia -->
    <template v-if="view === 'library'">
      <div class="rm-search">
        <LjInput
          v-model="query"
          size="touch"
          clearable
          :placeholder="t('remote_control.media_library.search_placeholder')"
          :aria-label="t('remote_control.media_library.search_placeholder')"
          :icon="ICONS.ACTIONS.SEARCH"
        />
      </div>

      <ul v-if="rows.length > 0" class="rm-list">
        <template v-for="row in rows" :key="row.key">
          <li v-if="row.kind === 'group'" class="rm-group">{{ row.label }}</li>
          <li v-else class="rm-item" @click="projectItem(row.item)">
            <img v-if="row.thumb" class="rm-item__thumb" :src="row.thumb" loading="lazy" alt="" />
            <span v-else class="rm-item__icon" :aria-hidden="true">
              <LjIcon :icon="ICONS.MODULES.MEDIA_LIBRARY" :size="22" />
            </span>
            <div class="rm-item__text">
              <span class="rm-item__title">{{ row.title }}</span>
              <span class="rm-item__subtitle">{{ typeLabel(row.item.type) }}</span>
            </div>
            <LjButton
              variant="ghost"
              size="lg"
              class="rm-item__action"
              :icon="ICONS.PLAYER.PLAY_OUTLINE"
              icon-only
              :title="t('remote_control.media_library.project')"
              @click.stop="projectItem(row.item)"
            />
            <LjButton
              variant="ghost"
              size="lg"
              class="rm-item__action"
              :icon="ICONS.UI.FILE_PLUS"
              icon-only
              :title="t('remote_control.media_library.playlist_add')"
              @click.stop="playlistAdd(row.item)"
            />
          </li>
        </template>
      </ul>
      <div v-else-if="!loading" class="rm-state lj-u-text-center lj-u-muted">
        {{ t("remote_control.media_library.empty") }}
      </div>
      <div v-else class="rm-state rm-state--loading lj-u-text-center">
        <LjSpinner :size="24" />
      </div>
    </template>

    <!-- Canva -->
    <template v-else-if="view === 'canva'">
      <div v-if="folderTrail.length > 0" class="rm-head">
        <button type="button" class="rm-back" @click="backFolder">
          ← {{ t("remote_control.media_library.back") }}
        </button>
        <span class="rm-head__title">{{ folderTrail.at(-1)?.name }}</span>
      </div>

      <div v-if="canvaUnavailable" class="rm-state lj-u-text-center lj-u-muted">
        {{ t("remote_control.media_library.canva_unavailable") }}
      </div>
      <div v-else-if="canvaError" class="rm-state rm-state--error lj-u-text-center">
        {{ canvaError }}
      </div>
      <template v-else>
        <ul v-if="canvaRows.length > 0" class="rm-list">
          <li v-for="row in canvaRows" :key="row.key" class="rm-item" @click="canvaOpen(row.item)">
            <img v-if="row.thumb" class="rm-item__thumb" :src="row.thumb" loading="lazy" alt="" />
            <span v-else class="rm-item__icon" :aria-hidden="true">
              <LjIcon :icon="ICONS.MODULES.MEDIA_LIBRARY" :size="22" />
            </span>
            <div class="rm-item__text">
              <span class="rm-item__title">{{ row.item.name }}</span>
              <span v-if="row.subtitle" class="rm-item__subtitle">{{ row.subtitle }}</span>
            </div>
            <!--
              Onde ficava o selo de "PDF já exportado": sem cache, o botão de
              exportar; com cache, o selo — que ao clicar pergunta se elimina.
            -->
            <template v-if="row.item.type !== 'folder'">
              <span
                v-if="row.badge && row.item.type === 'design'"
                class="rm-item__badge"
                @click.stop="canvaClearCache(row.item)"
              >
                <LjIcon :icon="ICONS.UI.BROOM" :size="12" />
                {{ row.badge }}
              </span>
              <LjButton
                v-else-if="row.item.type === 'design'"
                variant="ghost"
                size="lg"
                class="rm-item__action"
                :icon="ICONS.UI.DOWNLOAD_CIRCLE"
                icon-only
                :title="t('remote_control.media_library.canva_export')"
                @click.stop="canvaExport(row.item)"
              />
            </template>
            <!-- Play e adicionar à playlist: iguais aos cards da biblioteca. -->
            <LjButton
              v-if="row.item.type !== 'folder'"
              variant="ghost"
              size="lg"
              class="rm-item__action"
              :icon="ICONS.PLAYER.PLAY_OUTLINE"
              icon-only
              :title="t('remote_control.media_library.project')"
              @click.stop="canvaOpen(row.item)"
            />
            <LjButton
              v-if="row.item.type !== 'folder'"
              variant="ghost"
              size="lg"
              class="rm-item__action"
              :icon="ICONS.UI.FILE_PLUS"
              icon-only
              :title="t('remote_control.media_library.canva_add')"
              @click.stop="canvaAdd(row.item)"
            />
          </li>
        </ul>
        <div v-else-if="!loading" class="rm-state lj-u-text-center lj-u-muted">
          {{ t("remote_control.media_library.canva_empty") }}
        </div>
        <div v-else class="rm-state rm-state--loading lj-u-text-center">
          <LjSpinner :size="24" />
        </div>

        <div v-if="continuation" class="rm-more">
          <LjButton size="touch" variant="subtle" :disabled="loading" @click="loadMoreCanva">
            {{ t("remote_control.media_library.canva_more") }}
          </LjButton>
        </div>
      </template>
    </template>

    <!-- Playlist do desktop -->
    <template v-else>
      <div class="rm-head">
        <span class="rm-head__title">{{ t("remote_control.media_library.tab_playlist") }}</span>
        <LjButton
          v-if="playlist.length > 0"
          variant="ghost"
          size="sm"
          :icon="ICONS.UI.BROOM"
          icon-only
          :title="t('remote_control.media_library.playlist_clear')"
          @click="playlistClear"
        />
      </div>

      <ol v-if="playlist.length > 0" class="rm-list rm-list--ordered">
        <li
          v-for="(item, index) in playlist"
          :key="`${item.id}-${index}`"
          class="rm-item"
          @click="playlistGoto(index)"
        >
          <span class="rm-item__index">{{ index + 1 }}</span>
          <div class="rm-item__text">
            <span class="rm-item__title">{{ item.name }}</span>
            <span class="rm-item__subtitle">{{ typeLabel(item.type) }}</span>
          </div>
          <LjButton
            variant="ghost"
            size="lg"
            class="rm-item__action"
            :icon="ICONS.ACTIONS.CANCEL"
            icon-only
            :title="t('remote_control.media_library.playlist_remove')"
            @click.stop="playlistRemove(index)"
          />
        </li>
      </ol>
      <div v-else-if="!loading" class="rm-state lj-u-text-center lj-u-muted">
        {{ t("remote_control.media_library.playlist_empty") }}
      </div>
      <div v-else class="rm-state rm-state--loading lj-u-text-center">
        <LjSpinner :size="24" />
      </div>
    </template>

    <!-- Controles da playlist do desktop (funciona com o módulo fechado). -->
    <footer v-if="view !== 'canva'" class="rm-footer">
      <LjDivider />
      <div class="rm-footer__nav">
        <LjButton
          size="touch"
          variant="subtle"
          class="rm-footer__btn"
          :icon="ICONS.ACTIONS.PREVIOUS"
          icon-only
          :aria-label="t('actions.previous')"
          @click="playlistCommand('prev')"
        />
        <LjButton
          size="touch"
          variant="primary"
          class="rm-footer__btn"
          :icon="ICONS.PLAYER.PLAY_OUTLINE"
          :aria-label="t('remote_control.media_library.playlist_play')"
          @click="playlistCommand('play')"
        >
          {{ t("remote_control.media_library.playlist_play") }}
        </LjButton>
        <LjButton
          size="touch"
          variant="subtle"
          class="rm-footer__btn"
          :icon="ICONS.ACTIONS.NEXT"
          icon-only
          :aria-label="t('actions.next')"
          @click="playlistCommand('next')"
        />
        <LjButton
          size="touch"
          variant="subtle"
          class="rm-footer__btn"
          :icon="ICONS.ACTIONS.CANCEL"
          icon-only
          :aria-label="t('remote_control.media_library.playlist_stop')"
          @click="playlistCommand('stop')"
        />
      </div>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { LjButton, LjDivider, LjIcon, LjInput, LjSpinner } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { computed, onMounted, ref, useTemplateRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import { apiFetch, postApi, postRaw } from "@/helpers/ApiClient";
import { httpErrorMessage } from "@/helpers/httpErrorMessage";
import $alert from "@/helpers/Alert";

/** Item da biblioteca (metadados — os bytes ficam no desktop). */
interface MediaItem {
  id: string;
  name: string;
  type: string;
  thumb: string | null;
  categoryId: string | null;
  addedAt: number | null;
}

interface MediaCategory {
  id: string;
  name: string;
  color: string | null;
}

/** Item do Canva: pasta, design ou imagem. */
interface CanvaItem {
  type: "folder" | "design" | "image";
  id: string;
  name: string;
  thumb: string | null;
  url: string | null;
  pageCount: number | null;
  updatedAt: number | null;
}

interface CanvaRow {
  key: string;
  item: CanvaItem;
  thumb: string;
  subtitle: string;
  badge: string | null;
}

const props = defineProps<{ token?: string }>();

const emit = defineEmits<{
  (e: "show-snackbar", message: string, type?: string): void;
}>();

const { t } = useI18n();

const view = ref("library");
const query = ref("");
const loading = ref(false);
const uploading = ref(false);
const items = ref<MediaItem[]>([]);
const categories = ref<MediaCategory[]>([]);

const canvaItems = ref<CanvaItem[]>([]);
const continuation = ref<string | null>(null);
const canvaUnavailable = ref(false);
const canvaError = ref<string | null>(null);
const canvaView = ref("folders");
const cachedPdfs = ref<Set<string>>(new Set());
const folderTrail = ref<{ id: string; name: string }[]>([]);

const playlist = ref<MediaItem[]>([]);

const fileInput = useTemplateRef<HTMLInputElement>("fileInput");

const tabs = computed(() => [
  { value: "library", label: t("remote_control.media_library.tab_library") },
  { value: "canva", label: t("remote_control.media_library.tab_canva") },
  { value: "playlist", label: t("remote_control.media_library.tab_playlist") },
]);

const canvaViews = computed(() => [
  { value: "folders", label: t("remote_control.media_library.canva_folders") },
  { value: "designs", label: t("remote_control.media_library.canva_designs") },
]);

const typeLabel = (type: string): string => {
  if (type === "video") return t("remote_control.media_library.type_video");
  if (type === "pdf") return t("remote_control.media_library.type_pdf");
  if (type === "site") return t("remote_control.media_library.playlist_site");
  return t("remote_control.media_library.type_image");
};

/**
 * Miniatura: URLs http(s)/data carregam direto; caminho `louvorja://` (ou
 * `/api/...`) passa pela rota de imagem do servidor com o token.
 */
function thumbUrl(raw?: string | null): string {
  if (!raw) return "";
  if (/^(https?|data):/i.test(raw)) return raw;
  if (raw.startsWith("/api/")) return props.token ? `${raw}&token=${props.token}` : raw;
  // Caminho do disco do desktop (`louvorja://local/...`): busca os bytes pela
  // rota de imagem do servidor.
  if (raw.startsWith("louvorja://")) {
    const withQuery = `/api/media-library/image?url=${encodeURIComponent(raw)}`;
    return props.token ? `${withQuery}&token=${props.token}` : withQuery;
  }
  return "";
}

type Row =
  | { kind: "group"; key: string; label: string }
  | { kind: "item"; key: string; title: string; thumb: string; subtitle: string; item: MediaItem };

const rows = computed<Row[]>(() => {
  const term = query.value.trim().toLowerCase();
  const filtered = term
    ? items.value.filter((item) => item.name.toLowerCase().includes(term))
    : items.value;
  const linhas: Row[] = [];
  const semCategoria = t("remote_control.media_library.uncategorized");
  const byCategory = new Map<string, MediaItem[]>();
  for (const item of filtered) {
    const key = item.categoryId || "";
    byCategory.set(key, [...(byCategory.get(key) || []), item]);
  }
  for (const category of categories.value) {
    const bucket = byCategory.get(category.id);
    if (!bucket?.length) continue;
    linhas.push({ kind: "group", key: `g-${category.id}`, label: category.name });
    linhas.push(...bucket.map((item): Row => libraryRow(item)));
    byCategory.delete(category.id);
  }
  // "Sem categoria" por último; ids órfãos (categoria apagada) antes, em
  // ordem estável — mesma regra do app (iOS/KMP) e do acervo no desktop.
  for (const [categoryId, bucket] of [...byCategory.entries()]
    .filter(([id]) => id !== "")
    .sort(([a], [b]) => a.localeCompare(b))) {
    linhas.push({
      kind: "group",
      key: `g-${categoryId || "none"}`,
      label: categoryId ? categoryId : semCategoria,
    });
    linhas.push(...bucket.map((item): Row => libraryRow(item)));
  }
  const semCategoriaBucket = byCategory.get("");
  if (semCategoriaBucket?.length) {
    linhas.push({ kind: "group", key: "g-none", label: semCategoria });
    linhas.push(...semCategoriaBucket.map((item): Row => libraryRow(item)));
  }
  return linhas;
});

function libraryRow(item: MediaItem): Row {
  return {
    kind: "item",
    key: item.id,
    title: item.name,
    thumb: thumbUrl(item.thumb),
    subtitle: typeLabel(item.type),
    item,
  };
}

const canvaRows = computed<CanvaRow[]>(() =>
  canvaItems.value.map((item) => ({
    key: item.id,
    item,
    thumb: thumbUrl(item.thumb || item.url),
    subtitle:
      item.type === "folder"
        ? t("remote_control.media_library.canva_folder")
        : item.type === "image"
          ? t("remote_control.media_library.canva_image")
          : Number.isInteger(item.pageCount)
            ? t("remote_control.media_library.canva_pages", { count: item.pageCount ?? 0 })
            : t("remote_control.media_library.canva_design"),
    badge:
      item.type === "design" && cachedPdfs.value.has(item.id)
        ? t("remote_control.media_library.canva_cached")
        : null,
  }))
);

/** Texto do erro de uma resposta HTTP (helper compartilhado). */
async function mensagemDeErro(res: Response): Promise<string> {
  return httpErrorMessage(res, t("remote_control.errors.generic"));
}

function snack(message: string, type = "info"): void {
  emit("show-snackbar", message, type);
}

async function loadLibrary(): Promise<void> {
  loading.value = true;
  try {
    const res = await apiFetch(`/api/media-library?action=library&lang=pt&token=${props.token}`);
    if (res.ok) {
      const data = (await res.json()) as { items?: MediaItem[]; categories?: MediaCategory[] };
      items.value = data.items || [];
      categories.value = data.categories || [];
    } else {
      snack(await mensagemDeErro(res));
    }
  } catch {
    snack(t("remote_control.errors.generic"));
  } finally {
    loading.value = false;
  }
}

async function loadPlaylist(): Promise<void> {
  try {
    const res = await apiFetch(`/api/media-library?action=playlist&token=${props.token}`);
    if (res.ok) {
      const data = (await res.json()) as { items?: MediaItem[] };
      playlist.value = data.items || [];
    } else {
      snack(await mensagemDeErro(res));
    }
  } catch {
    snack(t("remote_control.errors.generic"));
  }
}

async function loadCanva(folderId = "", append = false): Promise<void> {
  loading.value = true;
  canvaError.value = null;
  try {
    const params = new URLSearchParams({ action: "canva" });
    if (canvaView.value === "designs") params.set("view", "designs");
    else if (folderId) params.set("folderId", folderId);
    if (append && continuation.value) params.set("continuation", continuation.value);
    if (props.token) params.set("token", props.token);
    const res = await apiFetch(`/api/media-library?${params.toString()}`);
    if (res.ok) {
      const data = (await res.json()) as {
        available?: boolean;
        items?: CanvaItem[];
        continuation?: string | null;
        cached?: Record<string, number>;
      };
      canvaUnavailable.value = data.available === false;
      continuation.value = data.continuation || null;
      cachedPdfs.value = new Set(Object.keys(data.cached || {}));
      canvaItems.value = append ? [...canvaItems.value, ...(data.items || [])] : data.items || [];
    } else {
      // Erra de verdade (502 = Canva desconectado/escopo): mostra o motivo em
      // vez do estado vazio, que parece "não tem nada no Canva".
      canvaItems.value = [];
      canvaError.value = await mensagemDeErro(res);
    }
  } catch {
    canvaError.value = t("remote_control.media_library.canva_error");
  } finally {
    loading.value = false;
  }
}

function loadMoreCanva(): void {
  void loadCanva(folderTrail.value.at(-1)?.id || "", true);
}

function canvaOpen(item: CanvaItem): void {
  if (item.type === "folder") {
    folderTrail.value = [...folderTrail.value, { id: item.id, name: item.name }];
    void loadCanva(item.id);
    return;
  }
  if (item.type === "image") {
    const url = thumbUrl(item.url || item.thumb);
    if (url) void projectUrl(url);
    return;
  }
  void projectDesign(item.id);
}

function backFolder(): void {
  folderTrail.value = folderTrail.value.slice(0, -1);
  void loadCanva(folderTrail.value.at(-1)?.id || "");
}

/** Exporta o arquivo do design sem projetar (JPG para imagem, PDF para design). */
async function canvaExport(item: CanvaItem): Promise<void> {
  try {
    const res = await postApi(
      "/api/media-library",
      { action: "canva-export", designId: item.id, format: item.type === "image" ? "jpg" : "pdf" },
      props.token
    );
    if (res.ok) {
      const data = (await res.json()) as { cached?: boolean };
      // O selo só aparece para designs (PDF); atualiza a lista para acendê-lo.
      if (item.type === "design") await loadCanva(folderTrail.value.at(-1)?.id || "");
      snack(
        data.cached
          ? t("remote_control.media_library.canva_export_cached")
          : t("remote_control.media_library.canva_exported"),
        "success"
      );
    } else {
      snack(await mensagemDeErro(res), "error");
    }
  } catch {
    snack(t("remote_control.errors.generic"), "error");
  }
}

/** Elimina o arquivo exportado (confirma antes — reexportar gasta cota). */
function canvaClearCache(item: CanvaItem): void {
  $alert.yesno(
    {
      title: t("remote_control.media_library.canva_clear_cache_title"),
      text: t("remote_control.media_library.canva_clear_cache_message"),
    },
    async (btn?: string) => {
      if (btn !== "yes") return;
      try {
        const res = await postApi(
          "/api/media-library",
          { action: "canva-clear-cache", designId: item.id },
          props.token
        );
        if (res.ok) {
          await loadCanva(folderTrail.value.at(-1)?.id || "");
          snack(t("remote_control.media_library.canva_cleared"), "success");
        } else {
          snack(await mensagemDeErro(res), "error");
        }
      } catch {
        snack(t("remote_control.errors.generic"), "error");
      }
    }
  );
}

/** Adiciona o design do Canva à playlist do desktop. */
async function canvaAdd(item: CanvaItem): Promise<void> {
  try {
    const res = await postApi(
      "/api/media-library",
      {
        action: "playlist",
        command: "add-canva",
        designId: item.id,
        name: item.name,
        kind: item.type,
      },
      props.token
    );
    if (res.ok) snack(t("remote_control.media_library.canva_added"), "success");
    else snack(await mensagemDeErro(res), "error");
  } catch {
    snack(t("remote_control.errors.generic"), "error");
  }
}

function switchView(next: string): void {
  if (view.value === next) return;
  view.value = next;
  if (next === "canva" && canvaItems.value.length === 0 && !canvaUnavailable.value) {
    void loadCanva(folderTrail.value.at(-1)?.id || "");
  } else if (next === "playlist") {
    void loadPlaylist();
  }
}

function switchCanvaView(next: string): void {
  if (canvaView.value === next) return;
  canvaView.value = next;
  folderTrail.value = [];
  void loadCanva();
}

async function projectItem(item: MediaItem): Promise<void> {
  try {
    const res = await postApi(
      "/api/media-library",
      { action: "project", id: item.id },
      props.token
    );
    if (!res.ok) snack(await mensagemDeErro(res), "error");
  } catch {
    snack(t("remote_control.errors.generic"), "error");
  }
}

/** Adiciona à playlist do desktop e recarrega a aba (o item entra no fim). */
async function playlistAdd(item: MediaItem): Promise<void> {
  try {
    const res = await postApi(
      "/api/media-library",
      { action: "playlist", command: "add", id: item.id },
      props.token
    );
    if (res.ok) snack(t("remote_control.media_library.playlist_added"), "success");
    else snack(await mensagemDeErro(res), "error");
  } catch {
    snack(t("remote_control.errors.generic"), "error");
  }
}

/** Toca a playlist a partir do índice tocado. */
async function playlistGoto(index: number): Promise<void> {
  try {
    const res = await postApi(
      "/api/media-library",
      { action: "playlist", command: "goto", index },
      props.token
    );
    if (!res.ok) snack(await mensagemDeErro(res), "error");
  } catch {
    snack(t("remote_control.errors.generic"), "error");
  }
}

async function playlistRemove(index: number): Promise<void> {
  try {
    const res = await postApi(
      "/api/media-library",
      { action: "playlist", command: "remove", index },
      props.token
    );
    if (res.ok) await loadPlaylist();
    else snack(await mensagemDeErro(res), "error");
  } catch {
    snack(t("remote_control.errors.generic"), "error");
  }
}

async function playlistClear(): Promise<void> {
  try {
    const res = await postApi(
      "/api/media-library",
      { action: "playlist", command: "clear" },
      props.token
    );
    if (res.ok) await loadPlaylist();
    else snack(await mensagemDeErro(res), "error");
  } catch {
    snack(t("remote_control.errors.generic"), "error");
  }
}

async function playlistCommand(command: string): Promise<void> {
  try {
    const res = await postApi("/api/media-library", { action: "playlist", command }, props.token);
    if (!res.ok) snack(await mensagemDeErro(res), "error");
  } catch {
    snack(t("remote_control.errors.generic"), "error");
  }
}

async function projectDesign(designId: string): Promise<void> {
  try {
    const res = await postApi(
      "/api/media-library",
      { action: "canva-project", designId },
      props.token
    );
    if (!res.ok) snack(await mensagemDeErro(res), "error");
  } catch {
    snack(t("remote_control.errors.generic"), "error");
  }
}

async function projectUrl(url: string): Promise<void> {
  try {
    const res = await postApi("/api/media-library", { action: "canva-project", url }, props.token);
    if (!res.ok) snack(await mensagemDeErro(res), "error");
  } catch {
    snack(t("remote_control.errors.generic"), "error");
  }
}

function pickFile(): void {
  fileInput.value?.click();
}

async function onFilePicked(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  uploading.value = true;
  try {
    const bytes = await file.arrayBuffer();
    const res = await postRaw("/api/media-library/upload", bytes, props.token, {
      "X-File-Name": encodeURIComponent(file.name),
      "X-Mime-Type": file.type || "application/octet-stream",
    });
    if (res.ok) {
      snack(t("remote_control.media_library.uploaded"), "success");
      await loadLibrary();
    } else {
      snack(await mensagemDeErro(res), "error");
    }
  } catch {
    snack(t("remote_control.errors.generic"), "error");
  } finally {
    uploading.value = false;
    input.value = "";
  }
}

function refresh(): Promise<void> {
  if (view.value === "canva") return loadCanva(folderTrail.value.at(-1)?.id || "");
  if (view.value === "playlist") return loadPlaylist();
  return loadLibrary();
}

watch(view, (next) => {
  if (next === "canva" && canvaItems.value.length === 0 && !canvaUnavailable.value) {
    void loadCanva(folderTrail.value.at(-1)?.id || "");
  }
});

onMounted(() => {
  void loadLibrary();
});

defineExpose({ refresh });
</script>

<style scoped>
.rm-root {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-3, 12px);
  padding: var(--lj-space-4, 16px);
  padding-bottom: 0;
}

.rm-tabs {
  display: flex;
  gap: var(--lj-space-2, 8px);
  align-items: center;
}

.rm-tabs--sub {
  margin-top: calc(-1 * var(--lj-space-2, 8px));
}

.rm-tabs__btn {
  flex: 1;
  padding: var(--lj-space-2, 8px) var(--lj-space-3, 12px);
  border: 1px solid var(--lj-ui-border, var(--lj-divider, #e0e0e0));
  border-radius: var(--lj-radius-md, 8px);
  background: var(--lj-surface-bg, transparent);
  color: var(--lj-text-muted, #666);
  font-size: 14px;
  min-height: 44px;
}

.rm-tabs__btn--active {
  border-color: var(--lj-ui-accent, var(--lj-primary, #1b4f8a));
  color: var(--lj-ui-accent, var(--lj-primary, #1b4f8a));
  font-weight: 600;
}

.rm-tabs__upload {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border: 1px solid var(--lj-ui-border, var(--lj-divider, #e0e0e0));
  border-radius: var(--lj-radius-md, 8px);
  background: var(--lj-surface-bg, transparent);
  color: var(--lj-text-muted, #666);
}

.rm-tabs__upload:disabled {
  opacity: 0.5;
}

.rm-head {
  display: flex;
  align-items: center;
  gap: var(--lj-space-3, 12px);
}

.rm-head__title {
  font-weight: 600;
  font-size: 14px;
  color: var(--lj-text-primary, #222);
}

.rm-back {
  border: none;
  background: none;
  color: var(--lj-ui-accent, var(--lj-primary, #1b4f8a));
  font-size: 14px;
  padding: var(--lj-space-1, 4px);
  min-height: 44px;
}

.rm-search {
  display: flex;
}

.rm-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-2, 8px);
}

.rm-group {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--lj-text-muted, #666);
  padding: var(--lj-space-2, 8px) 0 var(--lj-space-1, 4px);
}

.rm-item {
  display: flex;
  align-items: center;
  gap: var(--lj-space-2, 8px);
  padding: var(--lj-space-2, 8px) var(--lj-space-3, 12px);
  border: 1px solid var(--lj-ui-border, var(--lj-divider, #e0e0e0));
  border-radius: var(--lj-radius-md, 8px);
  background: var(--lj-surface-bg, transparent);
  cursor: pointer;
  min-height: 56px;
}

.rm-item:active {
  background: var(--lj-surface-bg-soft, rgba(0, 0, 0, 0.03));
}

.rm-item__thumb,
.rm-item__icon {
  width: 56px;
  height: 40px;
  border-radius: var(--lj-radius-sm, 6px);
  object-fit: cover;
  background: var(--lj-surface-bg-soft, rgba(0, 0, 0, 0.05));
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--lj-text-muted, #666);
}

.rm-item__text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.rm-item__title {
  font-size: 14px;
  color: var(--lj-text-primary, #222);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rm-item__subtitle {
  font-size: 12px;
  color: var(--lj-text-muted, #666);
}

.rm-item__badge {
  font-size: 11px;
  padding: 2px 6px;
  border-radius: var(--lj-radius-sm, 6px);
  background: var(--lj-surface-bg-soft, rgba(0, 0, 0, 0.06));
  color: var(--lj-text-muted, #666);
}

/* Ações do card (projetar / adicionar): alvo de toque confortável. */
.rm-item__action :deep(.lj-button) {
  min-width: 44px;
  min-height: 44px;
}

.rm-item__index {
  width: 28px;
  text-align: center;
  font-size: 13px;
  font-weight: 600;
  color: var(--lj-text-muted, #666);
  flex-shrink: 0;
}

.rm-list--ordered {
  list-style: none;
  counter-reset: none;
}

.rm-state {
  padding: var(--lj-space-6, 24px) 0;
  font-size: 14px;
}

.rm-state--error {
  color: var(--lj-ui-danger, var(--lj-error, #c62828));
}

.rm-state--loading {
  display: flex;
  justify-content: center;
}

.rm-more {
  display: flex;
  justify-content: center;
  padding: var(--lj-space-3, 12px) 0;
}

.rm-footer {
  position: sticky;
  bottom: 0;
  margin-top: auto;
  padding-bottom: var(--lj-space-3, 12px);
  background: var(--lj-surface-bg-soft, #fff);
}

.rm-footer__nav {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--lj-space-3, 12px);
  padding-top: var(--lj-space-3, 12px);
}

.rm-footer__btn :deep(.lj-button) {
  min-width: 48px;
  min-height: 48px;
}

.rm-footer__nav :deep(.lj-button--primary) {
  min-width: 120px;
}
</style>
