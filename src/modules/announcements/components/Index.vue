<template>
  <ModuleContainer
    ref="moduleContainer"
    :manifest="manifest"
    min-width="800px"
    tabindex="0"
    @close="close"
    @keydown="onKeyDown"
  >
    <div class="an-root">
      <!-- Lista ordenada -->
      <aside class="an-list">
        <div class="an-list-head">
          <span>{{ tt("list") }}</span>
          <LjButton
            size="sm"
            variant="ghost"
            icon-only
            :icon="ICONS.ACTIONS.ADD"
            :title="tt('new')"
            :aria-label="tt('new')"
            @click="addAnnouncement"
          />
        </div>

        <!--
          O catálogo não tem primitivo de menu de contexto: LjMenu abre por
          clique no gatilho, não na posição do cursor. As peças do Reka UI são
          montadas aqui — como MusicMenuTable já faz com os submenus —
          reaproveitando as classes `lj-menu__*` publicadas pelo LjMenu, que
          vive no bundle da shell e portanto sempre está carregado.

          O gatilho envolve a lista inteira; qual item foi clicado é registrado
          por `onContextMenu` no próprio item, que borbulha antes do Reka.
        -->
        <ContextMenuRoot>
          <ContextMenuTrigger as-child>
            <div class="an-list-drag" tabindex="-1">
              <draggable
                :list="sorted"
                item-key="id"
                handle=".an-item"
                :animation="150"
                ghost-class="an-item--ghost"
                @end="onDragEnd"
              >
                <template #item="{ element: a, index: i }">
                  <div
                    class="an-item"
                    :class="{ 'an-item--active': selectedId === a.id }"
                    @click="selectedId = a.id"
                    @contextmenu="onContextMenu(a)"
                  >
                    <Icon :icon="ICONS.ACTIONS.DRAG" :size="15" class="an-drag-handle" />
                    <span class="an-item-order">{{ i + 1 }}</span>
                    <span class="an-item-name">{{ a.nome }}</span>
                    <LjButton
                      size="sm"
                      variant="ghost"
                      icon-only
                      :icon="ICONS.ACTIONS.DELETE"
                      :title="tt('delete')"
                      :aria-label="tt('delete')"
                      class="an-item-delete"
                      @click.stop="removeAnnouncement(a)"
                    />
                  </div>
                </template>
              </draggable>
            </div>
          </ContextMenuTrigger>

          <ContextMenuPortal>
            <ContextMenuContent class="lj-ui-float lj-menu an-ctx">
              <ContextMenuItem class="lj-menu__item" @select="ctxEdit">
                <span class="lj-menu__mark">
                  <Icon :icon="ICONS.ACTIONS.EDIT" :size="13" />
                </span>
                <span class="lj-menu__text">{{ tt("edit") }}</span>
              </ContextMenuItem>
              <ContextMenuItem class="lj-menu__item" @select="ctxDuplicate">
                <span class="lj-menu__mark">
                  <Icon :icon="ICONS.ACTIONS.COPY" :size="13" />
                </span>
                <span class="lj-menu__text">{{ tt("duplicate") }}</span>
              </ContextMenuItem>
              <ContextMenuItem class="lj-menu__item an-ctx__danger" @select="ctxDelete">
                <span class="lj-menu__mark">
                  <Icon :icon="ICONS.ACTIONS.DELETE" :size="13" />
                </span>
                <span class="lj-menu__text">{{ tt("delete") }}</span>
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenuPortal>
        </ContextMenuRoot>

        <div v-if="!sorted.length" class="an-hint">{{ tt("empty") }}</div>
        <div class="an-project">
          <LjButton
            block
            variant="primary"
            :icon="ICONS.PLAYER.PLAY"
            :disabled="!sorted.length"
            @click="project"
          >
            {{ tt("project") }}
          </LjButton>
          <div class="an-project-controls">
            <LjButton
              size="sm"
              variant="ghost"
              icon-only
              :icon="ICONS.ACTIONS.PREVIOUS"
              :title="tt('prev')"
              :aria-label="tt('prev')"
              :disabled="!projecting"
              @click="sendControl('prev')"
            />
            <LjButton
              size="sm"
              :icon="ICONS.PLAYER.STOP"
              :disabled="!projecting"
              @click="stopProject"
            >
              {{ tt("stop") }}
            </LjButton>
            <LjButton
              size="sm"
              variant="ghost"
              icon-only
              :icon="ICONS.ACTIONS.NEXT"
              :title="tt('next')"
              :aria-label="tt('next')"
              :disabled="!projecting"
              @click="sendControl('next')"
            />
          </div>
        </div>
      </aside>

      <!-- Preview -->
      <div class="an-preview">
        <div
          v-if="editing"
          class="an-preview-box"
          :style="{
            backgroundColor: editing.style?.bgColor || '#000000',
            justifyContent: editing.style?.alignY || 'center',
          }"
        >
          <video
            v-if="editing.videoData"
            :src="videoObjectUrl"
            controls
            muted
            class="an-preview-media"
          />
          <img v-else-if="editing.imageData" :src="imageObjectUrl" class="an-preview-media" />
          <div
            v-if="editing.texto"
            class="an-preview-text"
            :class="{ 'an-preview-text--over': editing.videoData || editing.imageData }"
            :style="previewTextStyle"
          >
            {{ editing.texto }}
          </div>
        </div>
        <div v-else class="an-preview-empty">{{ tt("empty") }}</div>
      </div>

      <!-- Inputs -->
      <aside v-if="editing" class="an-inputs">
        <div class="an-inputs-scroll">
          <LjField layout="column" :label="tt('name')">
            <LjInput v-model="editing.nome" @update:model-value="save" />
          </LjField>

          <div class="an-section">{{ tt("texto") }}</div>
          <div class="an-textarea">
            <LjTextarea v-model="editing.texto" :rows="2" @update:model-value="save" />
          </div>

          <div class="an-section">{{ tt("imagem") }}</div>
          <div class="an-media-row">
            <LjButton size="sm" :icon="ICONS.MEDIA.IMAGE" @click="pickImage">
              {{ tt("choose_image") }}
            </LjButton>
            <LjButton v-if="editing.imageData" size="sm" variant="ghost" @click="clearImage">
              {{ tt("remove_media") }}
            </LjButton>
            <input
              ref="imageInput"
              type="file"
              accept="image/*,.heic,.heif"
              style="display: none"
              @change="onImageSelected"
            />
          </div>

          <div class="an-section">{{ tt("video") }}</div>
          <div class="an-media-row">
            <LjButton size="sm" :icon="ICONS.MEDIA.VIDEO_FILE" @click="pickVideo">
              {{ tt("choose_video") }}
            </LjButton>
            <LjButton v-if="editing.videoData" size="sm" variant="ghost" @click="clearVideo">
              {{ tt("remove_media") }}
            </LjButton>
            <input
              ref="videoInput"
              type="file"
              accept="video/*"
              style="display: none"
              @change="onVideoSelected"
            />
          </div>

          <div class="an-section">{{ tt("personalization") }}</div>
          <div class="an-style-grid">
            <LjField layout="column" :label="tt('bg_color')">
              <div class="an-color">
                <LjInput
                  type="color"
                  :model-value="editing.style?.bgColor || '#000000'"
                  @update:model-value="setStyle('bgColor', $event)"
                />
              </div>
            </LjField>
            <LjField layout="column" :label="tt('text_color')">
              <div class="an-color">
                <LjInput
                  type="color"
                  :model-value="editing.style?.textColor || '#ffffff'"
                  @update:model-value="setStyle('textColor', $event)"
                />
              </div>
            </LjField>
            <div class="an-style-field">
              <LjCheckbox
                :model-value="editing.style?.textShadow || false"
                :label="tt('text_shadow')"
                @update:model-value="setStyle('textShadow', $event)"
              />
            </div>
            <template v-if="editing.style?.textShadow">
              <LjField layout="column" :label="tt('shadow_color')">
                <div class="an-color">
                  <LjInput
                    type="color"
                    :model-value="editing.style?.textShadowColor || '#000000'"
                    @update:model-value="setStyle('textShadowColor', $event)"
                  />
                </div>
              </LjField>
              <LjField
                layout="column"
                :label="`${tt('shadow_blur')}: ${editing.style?.textShadowBlur ?? 4}px`"
              >
                <LjSlider
                  :model-value="editing.style?.textShadowBlur ?? 4"
                  :min="1"
                  :max="20"
                  :step="1"
                  @update:model-value="setStyle('textShadowBlur', $event)"
                />
              </LjField>
            </template>
            <LjField
              layout="column"
              :label="`${tt('font_size')}: ${editing.style?.fontSize || 64}px`"
            >
              <LjSlider
                :model-value="editing.style?.fontSize || 64"
                :min="24"
                :max="160"
                :step="4"
                @update:model-value="setStyle('fontSize', $event)"
              />
            </LjField>
            <LjField layout="column" :label="tt('align')">
              <LjSelect
                size="sm"
                :model-value="editing.style?.align || 'center'"
                :items="[
                  { label: tt('align_left'), value: 'left' },
                  { label: tt('align_center'), value: 'center' },
                  { label: tt('align_right'), value: 'right' },
                ]"
                @update:model-value="setStyle('align', $event)"
              />
            </LjField>
            <LjField layout="column" :label="tt('align_y')">
              <LjSelect
                size="sm"
                :model-value="editing.style?.alignY || 'center'"
                :items="[
                  { label: tt('align_top'), value: 'flex-start' },
                  { label: tt('align_center'), value: 'center' },
                  { label: tt('align_bottom'), value: 'flex-end' },
                ]"
                @update:model-value="setStyle('alignY', $event)"
              />
            </LjField>
          </div>
        </div>
      </aside>
      <aside v-else class="an-inputs an-inputs--empty" />
    </div>
  </ModuleContainer>
</template>

<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from "vue";
import { useI18n } from "vue-i18n";
import draggable from "vuedraggable";
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuPortal,
  ContextMenuRoot,
  ContextMenuTrigger,
} from "reka-ui";
import { module as manifest } from "../manifest";
import ModuleContainer from "@/components/ModuleContainer.vue";
import Icon from "@/components/Icon.vue";
import {
  LjButton,
  LjCheckbox,
  LjField,
  LjInput,
  LjSelect,
  LjSlider,
  LjTextarea,
} from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { ensureRenderableImage, isHeic } from "@/helpers/ImageConvert";
import $idb from "@/helpers/IndexedDB";
import { DB_TABLE } from "@/constants/DbTables";
import { openAnnouncementsWindow, closeAnnouncementsWindow } from "@/helpers/ProjectionWindows";
import $broadcast from "@/helpers/Broadcast";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import { useFileProjection } from "@/composables/useFileProjection";

interface AnnStyle {
  bgColor: string;
  textColor: string;
  fontSize: number;
  align: "left" | "center" | "right";
  alignY?: "flex-start" | "center" | "flex-end";
  textShadow?: boolean;
  textShadowColor?: string;
  textShadowBlur?: number;
}

interface Announcement {
  id: string;
  nome: string;
  ordem: number;
  texto?: string;
  imageData?: ArrayBuffer;
  imageMime?: string;
  imageName?: string;
  videoData?: ArrayBuffer;
  videoMime?: string;
  videoName?: string;
  style: AnnStyle;
}

const { t } = useI18n();
function tt(key: string): string {
  return t(`modules.announcements.${key}`);
}

const announcements = ref<Announcement[]>([]);
const selectedId = ref<string | null>(null);
const projecting = ref(false);
const imageInput = ref<HTMLInputElement | null>(null);
const videoInput = ref<HTMLInputElement | null>(null);

const TABLE = DB_TABLE.ANNOUNCEMENTS;

async function load(): Promise<void> {
  announcements.value = (await $idb.getAll<Announcement>(TABLE)).sort((a, b) => a.ordem - b.ordem);
}

const sorted = computed(() => [...announcements.value].sort((a, b) => a.ordem - b.ordem));

const editing = computed(() => announcements.value.find((a) => a.id === selectedId.value) || null);

// ─── Object URLs para preview ──────────────────────────────────────────
let _imgObjUrl: string | null = null;
let _vidObjUrl: string | null = null;

const imageObjectUrl = computed(() => {
  if (_imgObjUrl) {
    URL.revokeObjectURL(_imgObjUrl);
    _imgObjUrl = null;
  }
  if (!editing.value?.imageData) return "";
  _imgObjUrl = URL.createObjectURL(
    new Blob([editing.value.imageData], { type: editing.value.imageMime || "image/jpeg" })
  );
  return _imgObjUrl;
});

const videoObjectUrl = computed(() => {
  if (_vidObjUrl) {
    URL.revokeObjectURL(_vidObjUrl);
    _vidObjUrl = null;
  }
  if (!editing.value?.videoData) return "";
  _vidObjUrl = URL.createObjectURL(
    new Blob([editing.value.videoData], { type: editing.value.videoMime || "video/mp4" })
  );
  return _vidObjUrl;
});

const previewTextStyle = computed(() => {
  const hasMedia = !!(editing.value?.videoData || editing.value?.imageData);
  const ay = editing.value?.style?.alignY || "center";
  const base: Record<string, string> = {
    color: editing.value?.style?.textColor || "#ffffff",
    fontSize: `${editing.value?.style?.fontSize || 64}px`,
    textAlign: editing.value?.style?.align || "center",
  };
  if (editing.value?.style?.textShadow) {
    const sc = editing.value.style.textShadowColor || "#000000";
    const sb = editing.value.style.textShadowBlur ?? 4;
    base.textShadow = `0 0 ${sb}px ${sc}, 0 0 ${sb}px ${sc}`;
  }
  if (hasMedia) {
    if (ay === "flex-end") {
      base.top = "auto";
      base.bottom = "6vh";
    } else if (ay === "flex-start") {
      base.top = "6vh";
      base.bottom = "auto";
    } else {
      base.top = "50%";
      base.bottom = "auto";
      base.transform = "translateY(-50%)";
    }
  } else {
    base.justifyContent = ay;
  }
  return base;
});

onBeforeUnmount(() => {
  if (_imgObjUrl) URL.revokeObjectURL(_imgObjUrl);
  if (_vidObjUrl) URL.revokeObjectURL(_vidObjUrl);
});

async function saveItem(item: Announcement): Promise<void> {
  const plain: Announcement = {
    id: item.id,
    nome: item.nome,
    ordem: item.ordem,
    texto: item.texto || "",
    imageData: item.imageData instanceof ArrayBuffer ? item.imageData : undefined,
    imageMime: item.imageMime,
    imageName: item.imageName,
    videoData: item.videoData instanceof ArrayBuffer ? item.videoData : undefined,
    videoMime: item.videoMime,
    videoName: item.videoName,
    style: { ...item.style },
  };
  await $idb.put(TABLE, plain);
}

async function save(): Promise<void> {
  if (!editing.value) return;
  await saveItem(editing.value);
}

function addAnnouncement(): void {
  const max = sorted.value.length ? Math.max(...sorted.value.map((a) => a.ordem)) : 0;
  const a: Announcement = {
    id: crypto.randomUUID(),
    nome: `${tt("new")} ${max + 1}`,
    ordem: max + 1,
    style: {
      bgColor: "#000000",
      textColor: "#ffffff",
      fontSize: 64,
      align: "center",
      alignY: "center",
      textShadow: false,
      textShadowColor: "#000000",
      textShadowBlur: 4,
    },
  };
  announcements.value.push(a);
  void save();
  selectedId.value = a.id;
}

async function removeAnnouncement(a: Announcement): Promise<void> {
  if (!confirm(tt("delete_confirm"))) return;
  await $idb.del(TABLE, a.id);
  announcements.value = announcements.value.filter((x) => x.id !== a.id);
  if (selectedId.value === a.id) selectedId.value = null;
}

async function onDragEnd(): Promise<void> {
  for (let i = 0; i < sorted.value.length; i++) {
    sorted.value[i].ordem = i + 1;
  }
  await Promise.all(sorted.value.map((a) => saveItem(a)));
}

// ─── Mídia ───────────────────────────────────────────────────────────

async function onMediaSelected(e: Event, kind: "image" | "video"): Promise<void> {
  const input = e.target as HTMLInputElement;
  const f = input.files?.[0];
  if (!f || !editing.value) {
    input.value = "";
    return;
  }
  let work: Blob = f;
  let name = f.name;
  if (kind === "image" && isHeic(f.name, f.type)) {
    try {
      const c = await ensureRenderableImage(f.name, f);
      work = c.blob;
      name = c.name;
    } catch {
      /* HEIC fallback */
    }
  }
  const data = await work.arrayBuffer();
  if (kind === "image") {
    editing.value.imageData = data;
    editing.value.imageMime = work.type || "image/jpeg";
    editing.value.imageName = name;
  } else {
    editing.value.videoData = data;
    editing.value.videoMime = work.type || "video/mp4";
    editing.value.videoName = name;
  }
  await save();
  input.value = "";
}

function pickImage(): void {
  imageInput.value?.click();
}
function pickVideo(): void {
  videoInput.value?.click();
}
function onImageSelected(e: Event): void {
  void onMediaSelected(e, "image");
}
function onVideoSelected(e: Event): void {
  void onMediaSelected(e, "video");
}

function clearImage(): void {
  if (!editing.value) return;
  delete editing.value.imageData;
  delete editing.value.imageMime;
  delete editing.value.imageName;
  void save();
}
function clearVideo(): void {
  if (!editing.value) return;
  delete editing.value.videoData;
  delete editing.value.videoMime;
  delete editing.value.videoName;
  void save();
}

function setStyle(key: keyof AnnStyle, value: unknown): void {
  if (!editing.value) return;
  const base = editing.value.style || {
    bgColor: "#000000",
    textColor: "#ffffff",
    fontSize: 64,
    align: "center",
    alignY: "center",
  };
  editing.value.style = { ...base, [key]: value } as AnnStyle;
  void save();
}

// ─── Projeção ────────────────────────────────────────────────────────

function buildSlidesPayload(): Array<Record<string, unknown>> {
  return sorted.value.map((a) => ({
    id: a.id,
    nome: a.nome,
    ordem: a.ordem,
    texto: a.texto || "",
    imageData: a.imageData instanceof ArrayBuffer ? a.imageData : undefined,
    imageMime: a.imageMime,
    videoData: a.videoData instanceof ArrayBuffer ? a.videoData : undefined,
    videoMime: a.videoMime,
    style: a.style ? { ...a.style } : undefined,
  }));
}

async function project(): Promise<void> {
  const fp = useFileProjection();
  const idx = selectedId.value ? sorted.value.findIndex((a) => a.id === selectedId.value) : 0;
  const payload = { slides: buildSlidesPayload(), index: Math.max(0, idx) };
  await $idb.put(DB_TABLE.CACHE, {
    id: "announcements_projection_state",
    data: payload,
    ts: Date.now(),
  });
  projecting.value = true;
  const first = sorted.value[Math.max(0, idx)];
  fp.start("announcements", first?.nome || "", sorted.value.length, Math.max(0, idx));
  await openAnnouncementsWindow();
  await new Promise((r) => setTimeout(r, 300));
  $broadcast.send(BROADCAST_TYPE.ANNOUNCEMENTS_STATE, payload);
}

// ─── Setas do teclado ────────────────────────────────────────────────

function onKeyDown(e: KeyboardEvent): void {
  // Navegação da lista (projeção é tratada por Hotkeys em useFileProjection).
  if (!sorted.value.length) return;
  const cur = sorted.value.findIndex((a) => a.id === selectedId.value);
  if (e.key === "ArrowDown" || e.key === "ArrowRight") {
    e.preventDefault();
    const next = cur < sorted.value.length - 1 ? cur + 1 : 0;
    selectedId.value = sorted.value[next].id;
  } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
    e.preventDefault();
    const prev = cur > 0 ? cur - 1 : sorted.value.length - 1;
    selectedId.value = sorted.value[prev].id;
  }
}

// ─── Menu contextual ─────────────────────────────────────────────────

// O ContextMenuRoot do Reka guarda o estado aberto/fechado e a posição do
// cursor; aqui só resta lembrar sobre qual item o clique direito caiu.
// Importante: este handler NÃO chama preventDefault — o gatilho do Reka
// desiste de abrir quando o evento já vem cancelado (e ele mesmo cancela o
// menu nativo do navegador depois).
const contextMenuItem = ref<Announcement | null>(null);

function onContextMenu(a: Announcement): void {
  selectedId.value = a.id;
  contextMenuItem.value = a;
}

function ctxEdit(): void {
  const a = contextMenuItem.value;
  if (a) selectedId.value = a.id;
}

function ctxDuplicate(): void {
  const a = contextMenuItem.value;
  if (!a) return;
  const max = sorted.value.length ? Math.max(...sorted.value.map((x) => x.ordem)) : 0;
  const dup: Announcement = {
    ...structuredClone(a),
    id: crypto.randomUUID(),
    nome: `${a.nome} (cópia)`,
    ordem: max + 1,
  };
  // structuredClone do plain (após des selecionar) — safe.
  const plain: Announcement = {
    id: dup.id,
    nome: dup.nome,
    ordem: dup.ordem,
    texto: dup.texto || "",
    style: { ...dup.style },
  };
  announcements.value.push(plain);
  void save();
  selectedId.value = plain.id;
}

function ctxDelete(): void {
  const a = contextMenuItem.value;
  if (a) void removeAnnouncement(a);
}

function sendControl(action: "next" | "prev"): void {
  $broadcast.send(BROADCAST_TYPE.ANNOUNCEMENTS_CONTROL, { action });
}

async function stopProject(): Promise<void> {
  const fp = useFileProjection();
  projecting.value = false;
  await $idb.del(DB_TABLE.CACHE, "announcements_projection_state");
  fp.stopProjection();
  await closeAnnouncementsWindow();
}

onMounted(load);

function close(): void {
  if (projecting.value) void stopProject();
}
</script>

<style scoped>
.an-root {
  display: flex;
  gap: var(--lj-space-5);
  height: 100%;
  padding: var(--lj-space-5);
  overflow: hidden;
}
.an-list {
  width: 200px;
  flex-shrink: 0;
  border-right: 1px solid var(--lj-surface-border);
  padding-right: var(--lj-space-4);
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-2);
  overflow-y: auto;
}
.an-list-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: var(--lj-text-sm);
  font-weight: var(--lj-weight-semibold);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--lj-text-subtle);
  padding: 0 var(--lj-space-1) var(--lj-space-2);
}

/* Gatilho do menu de contexto: um invólucro sem estilo próprio, para o
   clique direito valer em toda a lista. O tabindex="-1" existe só para o
   Reka ter onde devolver o foco ao fechar o menu — de lá o keydown volta a
   borbulhar até o ModuleContainer, que é quem faz a navegação por setas. */
.an-list-drag:focus {
  outline: none;
}

.an-item {
  display: flex;
  align-items: center;
  gap: var(--lj-space-3);
  padding: var(--lj-space-2) var(--lj-space-3);
  border-radius: var(--lj-radius-lg);
  cursor: pointer;
  font-size: var(--lj-text-base);
  transition: background var(--lj-transition-normal);
}
.an-item:hover {
  background: var(--lj-surface-bg-hover);
}
.an-item--active {
  background: var(--lj-ui-accent-soft);
}
.an-item-order {
  font-size: var(--lj-text-xs);
  min-width: 16px;
  text-align: center;
  background: var(--lj-surface-bg-active);
  border-radius: 8px;
  line-height: 16px;
}
.an-item-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.an-drag-handle {
  cursor: grab;
  opacity: 0.3;
}
.an-item:hover .an-drag-handle {
  opacity: 0.7;
}
.an-item--ghost {
  opacity: 0.4;
  background: var(--lj-ui-accent-soft);
}
.an-item-delete {
  opacity: 0;
}
.an-item:hover .an-item-delete,
.an-item-delete:focus-visible {
  opacity: 0.6;
}
.an-hint {
  font-size: var(--lj-text-base);
  color: var(--lj-text-muted);
  padding: var(--lj-space-4) var(--lj-space-2);
}
.an-project {
  margin-top: auto;
  padding-top: var(--lj-space-4);
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-3);
}
.an-project-controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

/* Preview */
.an-preview {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--lj-surface-border);
  border-radius: var(--lj-radius-lg);
  overflow: hidden;
  background: var(--lj-color-projection-bg);
}
.an-preview-box {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--lj-space-7);
  position: relative;
}
.an-preview-media {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}
.an-preview-text {
  text-align: center;
  word-break: break-word;
  line-height: 1.3;
  padding: var(--lj-space-5);
}
.an-preview-text--over {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  z-index: 10;
  pointer-events: none;
}
.an-preview-empty {
  color: var(--lj-white-alpha-25);
  font-size: var(--lj-text-md);
}

/* Inputs */
.an-inputs {
  width: 260px;
  flex-shrink: 0;
  border-left: 1px solid var(--lj-surface-border);
  padding-left: var(--lj-space-4);
  display: flex;
  flex-direction: column;
}
.an-inputs-scroll {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-4);
}
.an-inputs--empty {
  flex: 0;
  border: none;
}
.an-section {
  font-size: var(--lj-text-sm);
  font-weight: var(--lj-weight-semibold);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--lj-text-subtle);
  margin-top: var(--lj-space-2);
}
.an-media-row {
  display: flex;
  align-items: center;
  gap: var(--lj-space-4);
  flex-wrap: wrap;
}
.an-style-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: var(--lj-space-4) var(--lj-space-5);
}
.an-style-field {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-2);
}

/* O painel é estreito: o rótulo do LjField volta ao tamanho denso e a margem
   inferior sai, porque quem espaça aqui é o gap do container. */
.an-inputs :deep(.lj-field) {
  margin-bottom: 0;
  font-size: var(--lj-text-sm);
}

/* `field-sizing` devolve o crescimento automático que o campo tinha antes;
   onde o navegador não suporta, ficam as 2 linhas do atributo `rows`. */
.an-textarea :deep(.lj-textarea) {
  field-sizing: content;
  min-height: 48px;
  max-height: 220px;
}

.an-color :deep(.lj-input) {
  width: 100%;
  padding-inline: var(--lj-space-2);
}
.an-color :deep(.lj-input__field) {
  cursor: pointer;
}
</style>

<!-- Sem `scoped`: o conteúdo do menu de contexto é emitido num portal no
     <body>, fora da árvore deste componente, onde nenhuma regra com escopo
     casaria. O isolamento vem do prefixo `an-ctx`. -->
<style>
.lj-menu__item.an-ctx__danger,
.lj-menu__item.an-ctx__danger .lj-menu__mark {
  color: var(--lj-danger);
}
</style>
