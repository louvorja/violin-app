<template>
  <ModuleContainer ref="moduleContainer" :manifest="manifest" min-width="700px">
    <div class="si-root">
      <!-- Categorias -->
      <aside class="si-cats">
        <div class="si-cats-head">
          <span>{{ tt("categories") }}</span>
          <LjButton
            size="sm"
            variant="ghost"
            icon-only
            :icon="ICONS.ACTIONS.ADD"
            :aria-label="tt('new_category')"
            @click="openAddCategory"
          />
        </div>
        <div
          v-for="cat in categories"
          :key="String(cat.id)"
          class="si-cat"
          :class="{ 'si-cat--active': String(selectedCategoryId) === String(cat.id) }"
          :style="{ '--cat-color': (cat.color as string) || '#1976d2' }"
          @click="selectedCategoryId = cat.id"
        >
          <Icon :icon="ICONS.MODULES.SCHEDULED_ITEMS" :size="16" />
          <span class="si-cat-name">{{ cat.nome }}</span>
          <span class="si-cat-count">{{ itemsOf(cat.id).length }}</span>
          <span class="si-cat-actions">
            <LjButton
              size="sm"
              variant="ghost"
              icon-only
              :icon="ICONS.ACTIONS.EDIT"
              :aria-label="t('actions.edit')"
              @click.stop="openRenameCategory(cat)"
            />
            <LjButton
              size="sm"
              variant="ghost"
              icon-only
              class="si-cat-del"
              :icon="ICONS.ACTIONS.DELETE"
              :aria-label="t('actions.delete')"
              @click.stop="removeCategory(cat)"
            />
          </span>
        </div>
        <div v-if="!categories.length" class="si-hint">{{ tt("no_categories") }}</div>
        <div v-else-if="!selectedCategoryId" class="si-hint">
          {{ tt("select_category_hint") }}
        </div>
      </aside>

      <!-- Calendário -->
      <div class="si-cal" @click.capture="onCalendarCaptureClick">
        <div class="si-cal-toolbar">
          <LjButton
            size="md"
            variant="ghost"
            icon-only
            :icon="ICONS.ACTIONS.PREVIOUS"
            :aria-label="t('actions.previous')"
            @click="calShift(-1)"
          />
          <LjButton
            size="md"
            variant="ghost"
            icon-only
            :icon="ICONS.ACTIONS.NEXT"
            :aria-label="t('actions.next')"
            @click="calShift(1)"
          />
          <LjButton size="md" variant="subtle" @click="goToday">
            {{ tt("today") }}
          </LjButton>
          <div class="si-cal-type" role="group" :aria-label="tt('view_mode')">
            <LjButton
              size="md"
              :variant="calendarType === 'month' ? 'primary' : 'default'"
              :aria-pressed="calendarType === 'month'"
              @click="calendarType = 'month'"
            >
              {{ tt("view_month") }}
            </LjButton>
            <LjButton
              size="md"
              :variant="calendarType === 'week' ? 'primary' : 'default'"
              :aria-pressed="calendarType === 'week'"
              @click="calendarType = 'week'"
            >
              {{ tt("view_week") }}
            </LjButton>
          </div>
          <LjButton
            size="md"
            class="si-cal-title"
            :icon-end="ICONS.UI.CHEVRON_DOWN"
            @click="yearMonthMenuOpen = true"
          >
            {{ calTitle }}
          </LjButton>
        </div>
        <v-calendar
          ref="calendarRef"
          :model-value="focusDate"
          :type="calendarType"
          :events="calendarEvents"
          event-start="start"
          event-end="end"
          :max-events="5"
          :event-height="calendarType === 'week' ? 20 : 18"
          :event-more-text="moreEventsText"
          :event-timed="() => false"
          :interval-height="calendarType === 'week' ? 0 : 48"
          :interval-count="calendarType === 'week' ? 1 : 24"
          :locale="calLocale"
          @click:day="(e, d) => onDayClick(d, e)"
          @click:event="(_e, d) => onEventClick(d)"
        />
      </div>
    </div>

    <!-- Diálogo: ir para mês/ano -->
    <LjDialog
      v-model="yearMonthMenuOpen"
      :title="tt('go_to_month')"
      :icon="ICONS.CALENDAR.BLANK"
      size="sm"
    >
      <div class="si-ym-row">
        <select v-model="pickerYear" class="si-select" :aria-label="tt('year')">
          <option v-for="y in yearRange" :key="y" :value="y">{{ y }}</option>
        </select>
        <select v-model="pickerMonth" class="si-select" :aria-label="tt('month')">
          <option v-for="(m, idx) in monthNames" :key="idx" :value="idx + 1">
            {{ m }}
          </option>
        </select>
      </div>
      <template #footer>
        <LjButton size="sm" variant="primary" @click="onYearMonthPick">OK</LjButton>
      </template>
    </LjDialog>

    <!-- Diálogo: nova / renomear categoria -->
    <LjDialog
      v-model="categoryDialog"
      :title="editingCatId ? tt('rename_category') : tt('new_category')"
      :icon="editingCatId ? ICONS.ACTIONS.EDIT : ICONS.ACTIONS.ADD"
      size="sm"
    >
      <LjField layout="column" :label="tt('category_name')">
        <LjInput v-model="categoryNameInput" autofocus @keydown.enter="confirmCategoryDialog" />
      </LjField>
      <label class="si-color-row">
        <span class="si-color-label">{{ tt("color") }}</span>
        <input v-model="categoryColorInput" type="color" class="si-color-input" />
      </label>
      <template #footer>
        <LjButton size="sm" @click="categoryDialog = false">{{ t("actions.cancel") }}</LjButton>
        <LjButton
          size="sm"
          variant="primary"
          :disabled="!categoryNameInput.trim()"
          @click="confirmCategoryDialog"
        >
          {{ t("actions.save") }}
        </LjButton>
      </template>
    </LjDialog>

    <!-- Diálogo: agendamento do dia -->
    <LjDialog
      v-model="entryDialog"
      :title="tt('entry_title')"
      :icon="ICONS.CALENDAR.CLOCK"
      size="md"
    >
      <LjField layout="row" :label="tt('entry_date')" class="si-entry-when">
        <div class="si-entry-when-row">
          <LjInput v-model="entryDate" type="date" />
          <span v-if="entryWeekday" class="si-entry-weekday">{{ entryWeekday }}</span>
        </div>
      </LjField>
      <div class="si-entry-cat-row">
        <span class="si-entry-cat-dot" :style="{ background: entryCategoryColor }" />
        <select
          v-model="entryCategoryId"
          class="si-select si-select--full"
          :aria-label="tt('pick_category')"
        >
          <option value="">{{ tt("pick_category") }}</option>
          <option v-for="c in categories" :key="c.id" :value="c.id">
            {{ c.nome }}
          </option>
        </select>
      </div>
      <div class="si-file-row">
        <LjButton size="md" variant="subtle" :icon="ICONS.UI.FILE_PLUS" @click="chooseEntryFile">
          {{ tt("choose_file") }}
        </LjButton>
        <span v-if="entryFileName" class="si-file-name">{{ entryFileName }}</span>
      </div>
      <input ref="fileInput" type="file" class="si-file-input" @change="onFileSelected" />
      <div v-if="entryFile || entryFileName" class="si-entry-detail">
        <div class="si-entry-line">
          <Icon :icon="entryKindIcon" :size="18" />
          <span>{{ entryKindLabel }}</span>
        </div>
        <div class="si-entry-line si-entry-loc">
          <Icon :icon="ICONS.UI.FILE" :size="16" />
          <span>{{ entryFile || tt("web_only_name") }}</span>
        </div>
        <img
          v-if="previewUrl && entryKind === 'image'"
          :src="previewUrl"
          class="si-entry-preview"
          alt=""
        />
        <audio
          v-else-if="previewUrl && entryKind === 'audio'"
          :src="previewUrl"
          controls
          class="si-entry-preview"
        />
        <video
          v-else-if="previewUrl && entryKind === 'video'"
          :src="previewUrl"
          controls
          muted
          class="si-entry-preview"
          @loadeddata="onVideoLoaded"
        />
      </div>
      <template #footer>
        <LjButton
          v-if="entryId"
          size="sm"
          variant="danger"
          class="si-footer-start"
          @click="removeEntry"
        >
          {{ tt("remove") }}
        </LjButton>
        <LjButton size="sm" @click="entryDialog = false">{{ t("actions.cancel") }}</LjButton>
        <LjButton
          size="sm"
          variant="primary"
          :disabled="(!entryFile && !entryId) || !entryCategoryId"
          @click="saveEntry"
        >
          {{ t("actions.save") }}
        </LjButton>
      </template>
    </LjDialog>

    <!-- Diálogo: Adicionar Automaticamente -->
    <LjDialog
      v-model="autoPopulateDialog"
      :title="tt('add_auto_dialog')"
      :icon="ICONS.CALENDAR.MULTISELECT"
      size="md"
    >
      <div class="si-auto-cat">
        <span class="si-entry-cat-dot" :style="{ background: autoCategoryColor }" />
        <select
          v-model="autoPopulateTargetCat"
          class="si-select si-select--full"
          :aria-label="tt('pick_category')"
        >
          <option value="">{{ tt("pick_category") }}</option>
          <option v-for="c in categories" :key="c.id" :value="c.id">{{ c.nome }}</option>
        </select>
      </div>

      <div class="si-auto-folder-row">
        <LjButton
          size="md"
          variant="subtle"
          :icon="ICONS.UI.FOLDER_OPEN"
          :disabled="!Platform.isDesktop"
          @click="chooseAutoFolder"
        >
          {{ tt("add_auto_choose_folder") }}
        </LjButton>
        <span v-if="autoPopulateFolder" class="si-file-name">{{ autoPopulateFolder }}</span>
      </div>

      <div class="si-auto-hint" v-html="tt('add_auto_hint')" />

      <div
        v-if="autoPopulateResult"
        class="si-auto-result"
        :class="{ 'si-auto-result--ok': autoPopulateResult.includes('sucesso') }"
      >
        {{ autoPopulateResult }}
      </div>
      <template #footer>
        <LjButton size="sm" @click="autoPopulateDialog = false">
          {{ t("actions.cancel") }}
        </LjButton>
        <LjButton
          size="sm"
          variant="primary"
          :icon="ICONS.ACTIONS.SEARCH"
          :disabled="!autoPopulateFolder || !autoPopulateTargetCat || !Platform.isDesktop"
          @click="executeAutoPopulate"
        >
          {{ tt("add_auto_scan") }}
        </LjButton>
      </template>
    </LjDialog>
  </ModuleContainer>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { module as manifest } from "../manifest";
import ModuleContainer from "@/components/ModuleContainer.vue";
import Icon from "@/components/Icon.vue";
import { LjButton, LjDialog, LjField, LjInput } from "@/components/ui";
import $liturgy from "@/helpers/Liturgy";
import Platform from "@/helpers/Platform";
import $alert from "@/helpers/Alert";
import { ICONS } from "@/config/Icons";
import { isHeic, heicToJpeg } from "@/helpers/ImageConvert";
import { ModuleEnum } from "@/enums/ModuleEnum";
import { useBroadcastListener } from "@/composables/useBroadcastListener";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import type { ScheduledCategory, ScheduledItem } from "@/types/Liturgy";
import { AUDIO_EXT, IMAGE_EXT, VIDEO_EXT } from "@/constants/FileTypes";

const { t, locale } = useI18n();
function tt(key: string): string {
  return t(`modules.scheduled_items.${key}`);
}

// ─── Estado ──────────────────────────────────────────────────────────

const categories = ref<ScheduledCategory[]>([]);
const items = ref<ScheduledItem[]>([]);
const selectedCategoryId = ref<string | number>("");

const categoryDialog = ref(false);
const editingCatId = ref<string | number | null>(null);
const categoryNameInput = ref("");
const categoryColorInput = ref("#1976d2");

const entryDialog = ref(false);
const entryId = ref<string | number | null>(null);
const entryDate = ref("");
const entryCategoryId = ref<string | number>("");
const entryFile = ref("");
const entryFileName = ref("");
const entryKind = ref<"image" | "audio" | "video" | "other">("other");
const previewUrl = ref("");
let previewObjectUrl: string | null = null;
/** Duração do arquivo de mídia em segundos. */
const entryDuration = ref<number | null>(null);
/** Blob JPEG convertido de HEIC (usado no save para não reconverter). */
let heicJpegBlob: Blob | null = null;

const entryCategoryColor = computed(() => {
  if (!entryCategoryId.value) return "#999";
  const cat = categories.value.find((c) => String(c.id) === String(entryCategoryId.value));
  return (cat?.cor as string) || (cat?.color as string) || "#1976d2";
});

const autoCategoryColor = computed(() => {
  if (!autoPopulateTargetCat.value) return "#999";
  const cat = categories.value.find((c) => String(c.id) === String(autoPopulateTargetCat.value));
  return (cat?.cor as string) || (cat?.color as string) || "#1976d2";
});

/** Flag para distinguir clique em evento (.v-event) vs espaço vazio no dia. */
const _lastClickWasEvent = ref(false);
const _lastClickWasMore = ref(false);
const _lastClickedEventId = ref("");

const entryKindIcon = computed(
  () =>
    ({
      image: ICONS.MEDIA.IMAGE,
      audio: ICONS.MUSIC.NOTE,
      video: ICONS.MEDIA.VIDEO_FILE,
      other: ICONS.UI.FILE,
    })[entryKind.value]
);

const entryKindLabel = computed(
  () =>
    ({
      image: tt("kind_image"),
      audio: tt("kind_audio"),
      video: tt("kind_video"),
      other: tt("kind_other"),
    })[entryKind.value]
);

const fileInput = ref<HTMLInputElement | null>(null);

function extOf(name: string): string {
  return name.split(".").pop()?.toLowerCase() || "";
}
function detectKind(name: string): "image" | "audio" | "video" | "other" {
  const e = extOf(name);
  if (IMAGE_EXT.includes(e)) return "image";
  if (AUDIO_EXT.includes(e)) return "audio";
  if (VIDEO_EXT.includes(e)) return "video";
  return "other";
}
function basenameOf(p: string): string {
  return p.split(/[\\/]/).pop() || p;
}
function localUrl(p: string): string {
  if (!Platform.isDesktop) return "";
  if (p.startsWith("/")) return "louvorja://local" + p;
  if (/^[A-Za-z]:\\/.test(p)) return "louvorja://local/" + p.replace(/\\/g, "/");
  return "louvorja://local/" + p;
}

// Libera o objectURL e reseta o estado do formulário ao fechar o diálogo.
watch(entryDialog, (open) => {
  if (!open) {
    if (previewObjectUrl) {
      URL.revokeObjectURL(previewObjectUrl);
      previewObjectUrl = null;
    }
    entryId.value = null;
    entryDate.value = "";
    entryFile.value = "";
    entryFileName.value = "";
    entryKind.value = "other";
    previewUrl.value = "";
    entryDuration.value = null;
    if (fileInput.value) fileInput.value.value = "";
  }
});

// Carrega a duração (segundos) de um arquivo de mídia via elemento oculto.
function loadDuration(url: string, kind: "video" | "audio"): Promise<number | null> {
  return new Promise((resolve) => {
    const el = document.createElement(kind === "video" ? "video" : "audio") as HTMLMediaElement;
    el.preload = "metadata";
    el.muted = true;
    const finish = (d: number | null) => {
      el.remove();
      resolve(d);
    };
    el.onloadedmetadata = () =>
      finish(Number.isFinite(el.duration) ? Math.round(el.duration) : null);
    el.onerror = () => finish(null);
    el.src = url;
  });
}

/** Converte HEIC/HEIF para JPEG via fetch + heic2any e devolve um objectURL. */
function loadHeicPreview(filePath: string): Promise<string | null> {
  return new Promise((resolve) => {
    const url = localUrl(filePath);
    fetch(url)
      .then((r) => r.blob())
      .then((blob) => heicToJpeg(blob))
      .then((jpeg) => resolve(URL.createObjectURL(jpeg)))
      .catch(() => resolve(null));
  });
}

const CAT_COLORS = ["#1976d2", "#00897b", "#8e44ad", "#e67e22", "#c62828", "#455a64"];
let _refreshTimer: ReturnType<typeof setInterval> | null = null;

// ─── Categorias ──────────────────────────────────────────────────────

async function refresh(): Promise<void> {
  categories.value = $liturgy
    .scheduledCategories()
    .map((c, i) => ({
      ...c,
      color: (c as ScheduledCategory & { cor?: string }).cor || CAT_COLORS[i % CAT_COLORS.length],
    }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt"));
  items.value = $liturgy.scheduledItems();
  if (!categories.value.find((c) => String(c.id) === String(selectedCategoryId.value))) {
    selectedCategoryId.value = categories.value[0]?.id ?? "";
  }
}

// Popula categorias/itens ao abrir o módulo (o cache já foi hidratado no boot).
onMounted(() => {
  void refresh();
  _refreshTimer = setInterval(() => void refresh(), 3000);
});
onBeforeUnmount(() => {
  if (_refreshTimer != null) clearInterval(_refreshTimer);
});

// ─── Ribbon action: Adicionar Automaticamente ──────────────────────────

useBroadcastListener(BROADCAST_TYPE.MODULE_RIBBON_ACTION, (payload) => {
  const data = payload as { module?: string; action?: string } | null;
  if (data?.module !== ModuleEnum.SCHEDULED_ITEMS) return;
  if (data.action === "add_auto") openAutoPopulate();
});

const autoPopulateDialog = ref(false);
const autoPopulateFolder = ref("");
const autoPopulateResult = ref("");
const autoPopulateTargetCat = ref<string | number>("");

function openAutoPopulate(): void {
  if (!Platform.isDesktop) {
    $alert.error({ text: tt("add_auto_desktop_only") });
    return;
  }
  autoPopulateTargetCat.value = selectedCategoryId.value || categories.value[0]?.id || "";
  // Pré-preenche a pasta salva na categoria.
  const cat = categories.value.find((c) => String(c.id) === String(autoPopulateTargetCat.value));
  autoPopulateFolder.value = (cat?.auto_folder as string) || "";
  autoPopulateResult.value = "";
  autoPopulateDialog.value = true;
}

async function chooseAutoFolder(): Promise<void> {
  const dir = await Platform.storage?.chooseDir();
  if (dir) autoPopulateFolder.value = dir;
}

async function executeAutoPopulate(): Promise<void> {
  if (!autoPopulateFolder.value || !autoPopulateTargetCat.value) return;
  const catId = String(autoPopulateTargetCat.value);
  const files = await Platform.readDir(autoPopulateFolder.value);
  if (!files || !files.length) {
    autoPopulateResult.value = tt("add_auto_no_files");
    return;
  }
  let created = 0;
  let updated = 0;
  const PADRAO = /(\d{2})-(\d{2})-(\d{2})_(.+)\.\w+$/;
  const existingItems = $liturgy.scheduledItems();
  for (const file of files) {
    const m = file.match(PADRAO);
    if (!m) continue;
    const [, dd, mm, yy] = m;
    const year = `20${yy}`;
    const date = `${year}-${mm}-${dd}`;
    const path = `${autoPopulateFolder.value}/${file}`;
    // Verifica se já existe item para essa categoria+dia — se sim, sobrescreve.
    const existing = existingItems.find((i) => i.data === date && String(i.categoria) === catId);
    if (existing) {
      $liturgy.updateScheduledItemEntry(existing.id, {
        arquivo: path,
        nome: m[4],
      });
      updated++;
    } else {
      $liturgy.addScheduledItemEntry(catId, date, m[4], path, "E");
      created++;
    }
  }
  if (created > 0 || updated > 0) {
    // Salva a pasta na categoria para pré-preenchimento futuro.
    $liturgy.updateScheduledCategory(autoPopulateTargetCat.value, {
      auto_folder: autoPopulateFolder.value,
    });
    const parts: string[] = [];
    if (created) parts.push(tt("add_auto_created").replace("{n}", String(created)));
    if (updated) parts.push(tt("add_auto_updated").replace("{n}", String(updated)));
    autoPopulateResult.value = parts.join(". ") + ".";
    void refresh();
    selectedCategoryId.value = catId;
  } else {
    autoPopulateResult.value = tt("add_auto_no_files");
  }
}

function openAddCategory(): void {
  editingCatId.value = null;
  categoryNameInput.value = "";
  categoryColorInput.value = CAT_COLORS[categories.value.length % CAT_COLORS.length];
  categoryDialog.value = true;
}

function openRenameCategory(cat: ScheduledCategory): void {
  editingCatId.value = cat.id;
  categoryNameInput.value = cat.nome;
  categoryColorInput.value = (cat.cor as string) || (cat.color as string) || CAT_COLORS[0];
  categoryDialog.value = true;
}

function confirmCategoryDialog(): void {
  const nome = categoryNameInput.value.trim();
  if (!nome) return;
  const cor = categoryColorInput.value;
  if (editingCatId.value != null) {
    $liturgy.updateScheduledCategory(editingCatId.value, { nome, cor });
  } else {
    const id = $liturgy.addScheduledCategory(nome);
    // Cor para o calendário (definida pelo usuário).
    $liturgy.updateScheduledCategory(id, { cor });
    selectedCategoryId.value = id;
  }
  categoryDialog.value = false;
  void refresh();
}

function removeCategory(cat: ScheduledCategory): void {
  if (!confirm(tt("delete_category"))) return;
  if (String(selectedCategoryId.value) === String(cat.id)) selectedCategoryId.value = "";
  $liturgy.removeScheduledCategory(cat.id);
  void refresh();
}

function itemsOf(catId: string | number): ScheduledItem[] {
  return items.value.filter((i) => String(i.categoria) === String(catId));
}

function categoryName(catId?: string | number): string {
  if (!catId) return "";
  return categories.value.find((c) => String(c.id) === String(catId))?.nome || "";
}

// ─── Calendário ──────────────────────────────────────────────────────

const calendarRef = ref<Record<string, unknown> | null>(null);

const calLocale = computed(() => (locale.value === "es" ? "es" : "pt-BR"));

/** Mês/ano em foco (YYYY-MM-DD — o dia 1º do mês navegado). */
const focusDate = ref(new Date().toISOString().slice(0, 10));
const calendarType = ref<"month" | "week">("month");

// Re-stampa data-date quando o tipo ou data do calendário muda.
watch([calendarType, focusDate], () => {
  nextTick(() => _stampDataDates());
});

const yearMonthMenuOpen = ref(false);
const now = new Date();
const pickerYear = ref(now.getFullYear());
const pickerMonth = ref(now.getMonth() + 1);

const monthNames = computed(() => {
  const fmt = new Intl.DateTimeFormat(calLocale.value, { month: "long" });
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(2000, i, 1);
    const name = fmt.format(d);
    return name.charAt(0).toUpperCase() + name.slice(1);
  });
});

const yearRange = computed(() => {
  const y = now.getFullYear();
  return Array.from({ length: 11 }, (_, i) => y - 5 + i);
});

function calShift(delta: number): void {
  if (calendarType.value === "month") {
    const d = new Date(`${focusDate.value}T00:00:00`);
    d.setMonth(d.getMonth() + delta);
    focusDate.value = d.toISOString().slice(0, 10);
  } else {
    const d = new Date(`${focusDate.value}T00:00:00`);
    d.setDate(d.getDate() + delta * 7);
    focusDate.value = d.toISOString().slice(0, 10);
  }
}

function goToday(): void {
  focusDate.value = new Date().toISOString().slice(0, 10);
}

function onYearMonthPick(): void {
  const m = String(pickerMonth.value).padStart(2, "0");
  focusDate.value = `${pickerYear.value}-${m}-01`;
  yearMonthMenuOpen.value = false;
}

const calTitle = computed(() => {
  const [y, m] = focusDate.value.split("-").map(Number);
  const label = new Intl.DateTimeFormat(calLocale.value, {
    month: "long",
    year: "numeric",
  }).format(new Date(y, m - 1, 1));
  return label.charAt(0).toUpperCase() + label.slice(1);
});

const moreEventsText = computed(() => {
  return locale.value === "es" ? "+{0} más" : "+{0} mais";
});

const entryWeekday = computed(() => {
  if (!entryDate.value) return "";
  const d = new Date(`${entryDate.value}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(calLocale.value, { weekday: "long" }).format(d);
});

interface CalEvent extends ScheduledItem {
  title: string;
  start: string;
  end: string;
  color: string;
  categoryNome: string;
}

const calendarEvents = computed<CalEvent[]>(() => {
  const catById = new Map(categories.value.map((c) => [String(c.id), c] as const));
  return items.value.map((it): CalEvent => {
    const cat = catById.get(String(it.categoria));
    return {
      ...it,
      id: String(it.id),
      data: String(it.data),
      nome: String(it.nome ?? ""),
      arquivo: String(it.arquivo ?? ""),
      title:
        String(it.nome ?? "") && String(it.nome ?? "") !== (cat?.nome ?? "")
          ? `${cat?.nome} · ${String(it.nome ?? "")}`
          : (cat?.nome ?? String(it.nome ?? "")),
      start: String(it.data),
      end: String(it.data),
      color: (cat?.color as string) || "#1976d2",
      name: String(it.nome ?? "") || basenameOf(String(it.arquivo ?? "")) || (cat?.nome ?? ""),
      categoryNome: cat?.nome ?? "",
    };
  });
});

/** Capture phase: detecta clique em .v-event-more, .v-event ou espaço vazio. */
function onCalendarCaptureClick(e: MouseEvent): void {
  const target = (e.target as HTMLElement) || null;

  // 1) "+N more" → muda para semana
  if (target?.closest?.(".v-event-more")) {
    _lastClickWasEvent.value = false;
    _lastClickWasMore.value = true;
    _lastClickedEventId.value = "";
    return;
  }

  // 2) Evento (.v-event) → guarda o ID do item correspondente
  const eventEl = target?.closest?.(".v-event");
  if (eventEl) {
    _lastClickWasEvent.value = true;
    _lastClickWasMore.value = false;
    const eventText =
      (eventEl.querySelector(".v-event-summary") as HTMLElement)?.textContent?.trim() || "";
    // Encontra o calendarEvent pelo name (que é o que o VCalendar mostra)
    const match = calendarEvents.value.find((c) => c.name === eventText || c.title === eventText);
    _lastClickedEventId.value = match ? String(match.id) : "";
    return;
  }

  // 3) Espaço vazio → adição
  _lastClickWasEvent.value = false;
  _lastClickWasMore.value = false;
  _lastClickedEventId.value = "";
}

/** Muda para modo semana focando no domingo da semana da data informada. */
function switchToWeek(dateStr: string): void {
  const d = new Date(`${dateStr}T00:00:00`);
  const dow = d.getDay();
  d.setDate(d.getDate() - dow); // volta para domingo
  focusDate.value = d.toISOString().slice(0, 10);
  calendarType.value = "week";
}

function onDayClick(args: unknown, _nativeEvent?: Event): void {
  _stampDataDates();

  // Extrai a data dos args de @click:day (sempre confiável).
  const a = (args || {}) as Record<string, unknown>;
  let date: string | undefined;
  const raw1 = a.date;
  const raw2 = (a.day as Record<string, unknown> | undefined)?.date;
  if (raw1 != null) {
    date = raw1 instanceof Date ? raw1.toISOString().slice(0, 10) : String(raw1);
  } else if (raw2 != null) {
    date = raw2 instanceof Date ? raw2.toISOString().slice(0, 10) : String(raw2);
  }
  if (!date) date = new Date().toISOString().slice(0, 10);

  // "+N more" → muda para semana da data clicada.
  if (_lastClickWasMore.value) {
    _lastClickWasMore.value = false;
    _lastClickWasEvent.value = false;
    switchToWeek(date);
    return;
  }

  // Clique em evento → busca item existente e abre edição.
  // Espaço vazio → abre criação (forceCreate = true).
  const wasEventClick = _lastClickWasEvent.value;
  const clickedEventId = _lastClickedEventId.value;
  _lastClickWasEvent.value = false;
  _lastClickWasMore.value = false;
  _lastClickedEventId.value = "";
  openEntryFor(
    date,
    clickedEventId ? undefined : undefined,
    clickedEventId || undefined,
    !wasEventClick
  );
}

function onEventClick(native: {
  event?: {
    input?: ScheduledItem;
    start?: string;
  };
}): void {
  const input = native?.event?.input as ScheduledItem | undefined;
  if (!input) return;
  selectedCategoryId.value = input.categoria as string | number;
  openEntryFor(String(input.data), input.categoria as string | number);
}

/**
 * Grava data-date em todas as células do dia do calendário.
 * O VCalendar não atribui data-date nativamente — usamos days do ref.
 */
function _stampDataDates(): void {
  const cal = calendarRef.value as Record<string, unknown> | null;
  const days = (cal?.days as Array<{ date: string }> | undefined) || [];
  if (!days.length) return;
  const cells = document.querySelectorAll(".v-calendar-weekly__day, .v-calendar-daily__day");
  cells.forEach((cell, i) => {
    if (i < days.length && !cell.getAttribute("data-date")) {
      cell.setAttribute("data-date", days[i].date);
    }
  });
}

function openEntryFor(
  date: string,
  catId?: string | number,
  preferItemId?: string | number,
  forceCreate = false
): void {
  entryDate.value = date;
  entryCategoryId.value = catId ?? "";
  entryFileName.value = "";
  entryKind.value = "other";
  previewUrl.value = "";
  entryDuration.value = null;
  entryId.value = null;

  if (!forceCreate) {
    // Busca item existente: primeiro por ID, depois por data+categoria, depois primeiro da data.
    let existing: ScheduledItem | undefined;
    if (preferItemId) {
      existing = items.value.find((i) => String(i.id) === String(preferItemId));
    }
    if (!existing && catId) {
      existing = items.value.find((i) => i.data === date && String(i.categoria) === String(catId));
    }
    if (!existing && !catId) {
      existing = items.value.find((i) => i.data === date);
    }
    if (existing) {
      entryId.value = existing.id;
      entryCategoryId.value = String(existing.categoria);
      entryFile.value = String(existing.arquivo || "");
      entryFileName.value = basenameOf(entryFile.value) || String(existing.nome || "");
      entryKind.value = detectKind(entryFileName.value);
      // Preview: HEIC com jpeg cache → usa blob direto; HEIC sem cache → converte; outros → objectURL local.
      const jpegData = (existing as Record<string, unknown>).arquivo_jpeg as
        | ArrayBuffer
        | undefined;
      if (entryFile.value && isHeic(entryFileName.value)) {
        if (jpegData) {
          const blob = new Blob([jpegData], { type: "image/jpeg" });
          previewUrl.value = URL.createObjectURL(blob);
        } else {
          loadHeicPreview(entryFile.value).then((url) => {
            if (url) previewUrl.value = url;
          });
        }
      } else {
        previewUrl.value = entryFile.value ? localUrl(entryFile.value) : "";
      }
      entryDuration.value =
        typeof (existing as Record<string, unknown>).duracao === "number"
          ? ((existing as Record<string, unknown>).duracao as number)
          : null;
      if ((entryKind.value === "video" || entryKind.value === "audio") && entryFile.value) {
        loadDuration(localUrl(entryFile.value), entryKind.value).then((d) => {
          if (d != null) entryDuration.value = d;
        });
      }
    }
  }
  entryDialog.value = true;
}

// ─── Arquivo do agendamento ──────────────────────────────────────────

function chooseEntryFile(): void {
  fileInput.value?.click();
}

async function onFileSelected(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement;
  const f = input.files?.[0];
  if (!f) return;
  // Electron 32+ removeu File.path; usar webUtils para obter o caminho real.
  const filePath =
    Platform.webUtils?.getPathForFile?.(f) || (f as unknown as { path?: string }).path || "";
  if (!Platform.isDesktop || !filePath) {
    $alert.error({ text: tt("desktop_only_hint") });
  }
  entryFile.value = filePath || "";
  entryFileName.value = f.name;
  entryKind.value = detectKind(f.name);
  // Preview: converte HEIC/HEIF para JPEG antes de criar objectURL.
  if (previewObjectUrl) {
    URL.revokeObjectURL(previewObjectUrl);
    previewObjectUrl = null;
  }
  let blobForPreview: Blob = f;
  if (isHeic(f.name, f.type)) {
    try {
      blobForPreview = await heicToJpeg(f);
      heicJpegBlob = blobForPreview;
    } catch {
      blobForPreview = f;
      heicJpegBlob = null;
    }
  } else {
    heicJpegBlob = null;
  }
  previewObjectUrl = URL.createObjectURL(blobForPreview);
  previewUrl.value = previewObjectUrl;
  // Duração da mídia (vídeo/áudio).
  entryDuration.value = null;
  if (entryKind.value === "video" || entryKind.value === "audio") {
    loadDuration(previewUrl.value, entryKind.value).then((d) => {
      if (d != null) entryDuration.value = d;
    });
  }
  input.value = "";
}

function onVideoLoaded(e: Event): void {
  // Inicia sempre com mudo ativado, conforme solicitado.
  (e.target as HTMLVideoElement).muted = true;
}

async function saveEntry(): Promise<void> {
  const catId = entryCategoryId.value || selectedCategoryId.value || categories.value[0]?.id;
  if (!catId) return;
  if (!entryFile.value && !entryFileName.value) return;

  // Valida: somente 1 item por categoria por dia.
  const duplicate = items.value.find(
    (i) =>
      i.data === entryDate.value &&
      String(i.categoria) === String(catId) &&
      String(i.id) !== String(entryId.value ?? "")
  );
  if (duplicate) {
    $alert.error({ text: tt("duplicate_category_day") });
    return;
  }

  const nome = categoryName(catId);
  const arquivo = entryFile.value || entryFileName.value;
  const dur = entryDuration.value ?? undefined;
  if (entryId.value) {
    $liturgy.updateScheduledItemEntry(entryId.value, {
      data: entryDate.value,
      categoria: catId,
      nome,
      arquivo,
      ...(dur != null ? { duracao: dur } : {}),
      ...(heicJpegBlob ? { arquivo_jpeg: await heicJpegBlob.arrayBuffer() } : {}),
    });
  } else {
    const jpegData = heicJpegBlob ? await heicJpegBlob.arrayBuffer() : undefined;
    const id = $liturgy.addScheduledItemEntry(
      String(catId),
      entryDate.value,
      nome,
      arquivo,
      "E",
      dur
    );
    // Salva arquivo_jpeg separadamente (addScheduledItemEntry não suporta o campo).
    if (jpegData) {
      $liturgy.updateScheduledItemEntry(id, { arquivo_jpeg: jpegData });
    }
    entryId.value = id;
  }
  void refresh();
  entryDialog.value = false;
}

function removeEntry(): void {
  if (!entryId.value) return;
  if (!confirm(tt("remove_confirm"))) return;
  $liturgy.removeScheduledItemEntry(entryId.value);
  entryId.value = null;
  entryDialog.value = false;
  void refresh();
}
</script>

<style scoped>
.si-root {
  display: flex;
  gap: var(--lj-space-5);
  height: 100%;
  padding: var(--lj-space-4);
  overflow: hidden;
}
.si-cats {
  width: 230px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-2);
  border-right: 1px solid var(--lj-surface-border);
  padding-right: var(--lj-space-4);
  overflow-y: auto;
}
.si-cats-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: var(--lj-text-base);
  font-weight: var(--lj-weight-semibold);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--lj-text-muted);
  padding: 0 var(--lj-space-1) var(--lj-space-2);
}
.si-cat {
  display: flex;
  align-items: center;
  gap: var(--lj-space-3);
  padding: var(--lj-space-3) var(--lj-space-4);
  border-radius: var(--lj-radius-lg);
  cursor: pointer;
  font-size: var(--lj-text-md);
  border-left: 3px solid var(--cat-color);
  transition: background var(--lj-transition-normal);
}
.si-cat:hover {
  background: var(--lj-surface-bg-hover);
}
.si-cat--active {
  background: color-mix(in srgb, var(--cat-color) 18%, transparent);
  font-weight: var(--lj-weight-medium);
}
.si-cat-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.si-cat-count {
  font-size: var(--lj-text-xs);
  background: rgba(var(--lj-on-surface-ch), 0.1);
  border-radius: 10px;
  padding: 0 var(--lj-space-3);
  line-height: 16px;
}
.si-cat-actions {
  display: none;
  align-items: center;
}
.si-cat:hover .si-cat-actions {
  display: inline-flex;
}
/* Seletor com o pai de propósito: empata em especificidade com a regra
   `.lj-btn--ghost` do primitivo e o desempate por ordem não é garantido. */
.si-cat-actions .si-cat-del {
  color: var(--lj-danger);
}
.si-cat-actions .si-cat-del:hover {
  background: var(--lj-danger-soft);
  color: var(--lj-danger);
}
.si-hint {
  font-size: var(--lj-text-base);
  color: var(--lj-text-muted);
  padding: var(--lj-space-4) var(--lj-space-2);
}
.si-cal {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.si-cal-toolbar {
  display: flex;
  align-items: center;
  gap: var(--lj-space-2);
  padding: 0 var(--lj-space-2) var(--lj-space-4);
}
/* Grupo mês/semana: os dois botões colados formam um único controle. */
.si-cal-type {
  display: inline-flex;
  gap: var(--lj-space-1);
}
.si-cal-toolbar .si-cal-title {
  font-weight: var(--lj-weight-semibold);
}
:deep(.v-event-more) {
  cursor: pointer;
  font-weight: var(--lj-weight-medium);
}

/* ── Controles nativos ainda sem primitivo ─────────────────────────────
   O <select> nativo permanece por escolha: o painel flutuante do LjSelect
   é desenhado abaixo do diálogo (z-index 2400 contra 2501), e aqui ele
   vive dentro de diálogos. O traço, o raio e o anel de foco vêm do mesmo
   contrato dos primitivos para não destoar ao lado deles. */
.si-select {
  height: var(--lj-ui-h-md);
  padding: 0 var(--lj-space-4);
  border: var(--lj-ui-border);
  border-radius: var(--lj-ui-radius);
  background: var(--lj-surface-bg);
  color: var(--lj-text);
  font-family: inherit;
  font-size: var(--lj-ui-font-md);
  outline: none;
  cursor: pointer;
}
.si-select:hover {
  border-color: var(--lj-ui-accent);
}
.si-select:focus-visible {
  border-color: var(--lj-ui-accent);
  box-shadow: var(--lj-ui-focus);
}
.si-select--full {
  width: 100%;
}
.si-ym-row {
  display: flex;
  align-items: center;
  gap: var(--lj-space-4);
}
.si-ym-row .si-select {
  flex: 1;
  min-width: 0;
}

/* ── Diálogo de categoria ──────────────────────────────────────────── */
.si-color-row {
  margin-top: var(--lj-space-5);
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-3);
}
.si-color-label {
  font-size: var(--lj-text-base);
  color: var(--lj-text-muted);
}
.si-color-input {
  width: 100%;
  height: var(--lj-ui-h-lg);
  padding: 2px;
  border: var(--lj-ui-border);
  border-radius: var(--lj-ui-radius);
  background: var(--lj-surface-bg);
  cursor: pointer;
}
.si-color-input:focus-visible {
  border-color: var(--lj-ui-accent);
  box-shadow: var(--lj-ui-focus);
  outline: none;
}

/* ── Diálogo de agendamento ────────────────────────────────────────── */
.si-entry-when {
  margin-bottom: var(--lj-space-5);
}
.si-entry-when-row {
  display: flex;
  align-items: center;
  gap: var(--lj-space-4);
}
/* A classe passada ao LjInput cai no <input> interno (ele usa inheritAttrs:
   false), não na moldura. Por isso a medida vem do invólucro, com :deep. */
.si-entry-when-row :deep(.lj-input) {
  max-width: 170px;
}
.si-entry-weekday {
  font-size: var(--lj-text-base);
  color: var(--lj-text-muted);
  text-transform: capitalize;
}
.si-entry-cat-row {
  display: flex;
  align-items: center;
  gap: var(--lj-space-4);
  margin-bottom: var(--lj-space-5);
}
.si-entry-cat-dot {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  flex-shrink: 0;
  border: 1px solid var(--lj-surface-border-strong);
}
.si-file-row {
  display: flex;
  align-items: center;
  gap: var(--lj-space-4);
  min-height: 36px;
}
.si-file-name {
  font-size: var(--lj-text-base);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}
.si-file-input {
  display: none;
}
.si-entry-detail {
  margin-top: var(--lj-space-5);
  border-top: 1px solid var(--lj-surface-divider);
  padding-top: var(--lj-space-4);
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-4);
}
.si-entry-line {
  display: flex;
  align-items: center;
  gap: var(--lj-space-4);
  font-size: var(--lj-text-md);
}
.si-entry-loc {
  color: var(--lj-text-muted);
  font-size: var(--lj-text-sm);
}
.si-entry-loc span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.si-entry-preview {
  max-width: 100%;
  max-height: 220px;
  border-radius: var(--lj-radius-lg);
  margin-top: var(--lj-space-2);
}
/* Empurra "Remover agendamento" para a esquerda do rodapé do diálogo. */
.si-footer-start {
  margin-right: auto;
}

/* ── Diálogo de auto-preenchimento ─────────────────────────────────── */
.si-auto-cat {
  display: flex;
  align-items: center;
  gap: var(--lj-space-4);
  margin-bottom: var(--lj-space-5);
}
.si-auto-folder-row {
  display: flex;
  align-items: center;
  gap: var(--lj-space-4);
  margin-bottom: var(--lj-space-5);
}
.si-auto-hint {
  font-size: var(--lj-text-sm);
  color: var(--lj-text-muted);
  line-height: 1.5;
  padding: var(--lj-space-4) var(--lj-space-5);
  background: var(--lj-surface-bg-soft);
  border-radius: var(--lj-radius-lg);
  margin-bottom: var(--lj-space-5);
}
.si-auto-hint code {
  font-family: var(--lj-font-mono);
  font-size: var(--lj-text-xs);
  background: rgba(var(--lj-on-surface-ch), 0.08);
  padding: 1px var(--lj-space-2);
  border-radius: var(--lj-radius-sm);
}
.si-auto-result {
  font-size: var(--lj-text-base);
  padding: var(--lj-space-3) var(--lj-space-5);
  border-radius: var(--lj-radius-lg);
  background: var(--lj-danger-soft);
  color: var(--lj-alert-error-color, var(--lj-danger));
}
.si-auto-result--ok {
  background: var(--lj-success-soft);
  color: var(--lj-success);
}
</style>
