<template>
  <LjDialog
    v-model="open"
    :title="isNew ? tm('item_dialog.new_title') : tm('item_dialog.edit_title')"
    :icon="KIND_ICONS[kind]"
    size="md"
  >
    <form class="pm-item-form" data-testid="pm-item-dialog" @submit.prevent="save">
      <LjField :label="tm('item_dialog.kind')">
        <LjSelect
          v-model="kind"
          :items="kindOptions"
          item-value="value"
          item-label="label"
          :disabled="!isNew"
        />
      </LjField>

      <LjField v-if="kind === 'music'" :label="tm('item_dialog.music')">
        <div class="pm-item-form__pick">
          <span class="pm-item-form__picked">{{ music?.name || tm("item_dialog.none") }}</span>
          <LjButton :icon="ICONS.ACTIONS.SEARCH" @click="musicPickerOpen = true">
            {{ tm("item_dialog.choose_music") }}
          </LjButton>
        </div>
      </LjField>

      <LjField v-if="kind === 'music'" :label="tm('item_dialog.version')">
        <LjSelect
          v-model="musicMode"
          :items="modeOptions"
          item-value="value"
          item-label="label"
          data-testid="pm-item-version"
        />
      </LjField>

      <LjField v-else-if="kind === 'bible'" :label="tm('item_dialog.verse')">
        <div class="pm-item-form__pick">
          <span class="pm-item-form__picked">{{ bible?.reference || tm("item_dialog.none") }}</span>
          <LjButton :icon="ICONS.ACTIONS.SEARCH" @click="biblePickerOpen = true">
            {{ tm("item_dialog.choose_verse") }}
          </LjButton>
        </div>
      </LjField>

      <LjField
        v-else-if="kind === 'file'"
        :label="tm('item_dialog.file')"
        :hint="Platform.isDesktop ? undefined : tm('item_dialog.file_desktop_only')"
      >
        <div class="pm-item-form__pick">
          <span class="pm-item-form__picked" :title="filePath">
            {{ filePath ? basename(filePath) : tm("item_dialog.none") }}
          </span>
          <LjButton
            :icon="ICONS.ACTIONS.FOLDER_OPEN"
            :disabled="!Platform.isDesktop"
            @click="chooseFile"
          >
            {{ tm("item_dialog.choose_file") }}
          </LjButton>
        </div>
      </LjField>

      <LjField
        v-else-if="kind === 'folder'"
        :label="tm('item_dialog.folder')"
        :hint="
          libraryFolders.length ? tm('item_dialog.folder_hint') : tm('item_dialog.folder_none')
        "
      >
        <LjSelect
          v-model="folderPath"
          :items="libraryFolders"
          item-value="path"
          item-label="label"
          data-testid="pm-item-folder"
        />
      </LjField>

      <LjField v-else-if="kind === 'online_video'" :label="tm('item_dialog.url')">
        <LjInput v-model="url" type="url" placeholder="https://www.youtube.com/watch?v=…" />
      </LjField>

      <p v-if="kind === 'moment'" class="pm-item-form__hint">{{ tm("item_dialog.moment_hint") }}</p>

      <LjField :label="tm('item_dialog.title')">
        <LjInput v-model="title" :autofocus="!isNew || kind === 'note' || kind === 'moment'" />
      </LjField>

      <LjField v-if="kind === 'note'" :label="tm('item_dialog.note_text')">
        <LjTextarea v-model="noteText" :rows="3" />
      </LjField>
      <LjField v-else :label="tm('item_dialog.subtitle')">
        <LjInput v-model="subtitle" />
      </LjField>

      <LjField :label="tm('item_dialog.duration')">
        <div class="pm-item-form__minutes">
          <LjInput v-model="minutes" type="number" />
        </div>
      </LjField>
      <LjField :label="tm('item_dialog.session')">
        <LjSelect
          v-model="targetSessionId"
          :items="sessionOptions"
          item-value="value"
          item-label="label"
        />
      </LjField>

      <p v-if="error" class="pm-item-form__error">{{ error }}</p>
    </form>

    <template #footer>
      <LjButton v-if="!isNew" variant="danger" :icon="ICONS.ACTIONS.DELETE" @click="emit('remove')">
        {{ t("actions.delete") }}
      </LjButton>
      <span class="pm-item-form__spacer" />
      <LjButton @click="open = false">{{ t("actions.cancel") }}</LjButton>
      <LjButton variant="primary" data-testid="pm-item-save" @click="save">
        {{ t("actions.save") }}
      </LjButton>
    </template>
  </LjDialog>

  <!-- Os ícones de cada linha escolhem o formato do item; o clique na linha, o cantado. -->
  <MusicSpotlight
    v-if="musicPickerOpen"
    v-model="musicPickerOpen"
    mode="pick"
    :on-music-action="onMusicAction"
    @pick="onMusic"
  />
  <BibleSpotlight
    v-if="biblePickerOpen"
    v-model="biblePickerOpen"
    :project-locally="false"
    @select="onVerse"
  />
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, ref, watch } from "vue";
import { LjButton, LjDialog, LjField, LjInput, LjSelect, LjTextarea } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { ModuleEnum } from "@/enums/ModuleEnum";
import { LiturgyItemTypeEnum } from "@/enums/LiturgyItemTypeEnum";
import DateTime from "@/helpers/DateTime";
import Platform from "@/helpers/Platform";
import { useModuleI18n } from "@/composables/useModuleI18n";
import type { BibleSearchResult } from "@/types/Bible";
import type { SearchMusicItem } from "@/types/Music";
import type {
  ProgramBibleRef,
  ProgramItem,
  ProgramItemKind,
  ProgramSession,
} from "@/types/Presentation";
import { CREATABLE_KINDS, KIND_ICONS } from "../program/kinds";
import { kindFromPath, liturgyItem } from "../program/liturgy";
import { isMusicMode, modeOfAction, modesFor, type MusicMode } from "../program/musicModes";
import { MusicActionEnum } from "@/enums/MusicActionEnum";
import { newId } from "../composables/useProgram";
import { useFileLibrary } from "../composables/useFileLibrary";

const MusicSpotlight = defineAsyncComponent(() => import("@/components/MusicSpotlight.vue"));
const BibleSpotlight = defineAsyncComponent(() => import("@/components/BibleSpotlight.vue"));

const props = defineProps<{
  modelValue: boolean;
  /** `null` cria um item novo. */
  item: ProgramItem | null;
  sessionId: string | null;
  sessions: ProgramSession[];
}>();

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  save: [payload: { item: ProgramItem; sessionId: string }];
  remove: [];
}>();

const { t, tm } = useModuleI18n(ModuleEnum.PRESENTATION_MODE);

const open = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit("update:modelValue", value),
});

const isNew = computed(() => props.item === null);

type MusicPick = { id_music: number; name: string; has_instrumental_music: boolean };

const kind = ref<ProgramItemKind>("music");
const title = ref("");
const subtitle = ref("");
const minutes = ref<string | number>(0);
const targetSessionId = ref<string | null>(null);
const music = ref<MusicPick | null>(null);
/** "ask": a versão fica para a hora — o duplo clique pede a escolha antes de abrir. */
const ASK = "ask" as const;
const musicMode = ref<MusicMode | typeof ASK>(ASK);

const modeOptions = computed(() => [
  { value: ASK, label: tm("music_modes.ask") },
  ...modesFor(!!music.value?.has_instrumental_music).map((m) => ({
    value: m.value,
    label: tm(m.label),
  })),
]);

// Trocar para uma música sem instrumental não pode deixar "Playback" escolhido.
watch(modeOptions, (options) => {
  if (!options.some((o) => o.value === musicMode.value)) musicMode.value = ASK;
});
const bible = ref<ProgramBibleRef | null>(null);
const filePath = ref("");
const url = ref("");
/** Pasta de um item `folder`: uma das pastas da biblioteca (a que está aberta na edição, se não estiver mais lá). */
const folderPath = ref<string | null>(null);
const library = useFileLibrary();
const libraryFolders = computed(() => {
  const list = library.folders.value;
  const current = props.item?.folder;
  return current && !list.some((f) => f.path === current)
    ? [...list, { path: current, label: basename(current) }]
    : list;
});
const folderLabel = (path: string | null): string =>
  path ? (libraryFolders.value.find((f) => f.path === path)?.label ?? basename(path)) : "";
// O título começa com o nome da pasta — e acompanha a troca de pasta enquanto
// o operador não escreveu outro.
watch(folderPath, (path, previous) => {
  if (kind.value !== "folder" || !path) return;
  if (!title.value.trim() || title.value === folderLabel(previous)) title.value = folderLabel(path);
});
const noteText = ref("");
const error = ref("");
const musicPickerOpen = ref(false);
const biblePickerOpen = ref(false);

const kindOptions = computed(() => {
  const kinds: ProgramItemKind[] = isNew.value ? [...CREATABLE_KINDS] : [kind.value];
  return kinds.map((k) => ({ value: k, label: tm(`kinds.${k}`) }));
});

const sessionOptions = computed(() => props.sessions.map((s) => ({ value: s.id, label: s.label })));

function basename(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

function reset(): void {
  const item = props.item;
  const source = item?.source;
  error.value = "";
  kind.value = item?.kind ?? "music";
  title.value = item?.title ?? "";
  subtitle.value = item?.subtitle ?? "";
  minutes.value = item?.plannedMinutes ?? 0;
  targetSessionId.value = props.sessionId ?? props.sessions[0]?.id ?? null;
  music.value =
    source?.tipo === LiturgyItemTypeEnum.MUSICA && source.id_music
      ? {
          id_music: source.id_music,
          name: source.item,
          has_instrumental_music: source.has_instrumental_music,
        }
      : null;
  // Item novo nasce com a versão em aberto; o existente mostra a que tem (ou "na hora").
  musicMode.value = isMusicMode(source?.subtipo) ? source.subtipo : ASK;
  bible.value = item?.bible ?? null;
  filePath.value = source?.tipo === LiturgyItemTypeEnum.ARQUIVO ? source.dir : "";
  url.value = source?.url ?? "";
  folderPath.value = item?.folder ?? null;
  noteText.value =
    item?.notes ?? (source?.tipo === LiturgyItemTypeEnum.ANOTACAO ? source.subitem : "");
}

watch(
  () => props.modelValue,
  (value) => {
    if (value) reset();
  },
  { immediate: true }
);

function onMusic(picked: SearchMusicItem): void {
  music.value = {
    id_music: Number(picked.id_music),
    name: picked.name,
    has_instrumental_music: !!picked.has_instrumental_music,
  };
  title.value = picked.name;
  const seconds = DateTime.toNumber(picked.duration);
  if (seconds > 0) minutes.value = Math.ceil(seconds / 60);
  musicPickerOpen.value = false;
}

function onMusicAction(picked: SearchMusicItem, action: MusicActionEnum): void {
  onMusic(picked);
  musicMode.value = modeOfAction(action) ?? "sung";
}

function onVerse(result: BibleSearchResult): void {
  bible.value = {
    reference: result.reference,
    text: result.text,
    book_id: result.id_bible_book,
    chapter: result.chapter,
    verses: [result.verse],
    version_id: result.id_bible_version,
  };
  if (!title.value) title.value = result.reference;
  subtitle.value = result.reference;
}

async function chooseFile(): Promise<void> {
  const chosen = (await Platform.api?.storage?.chooseFile?.()) as string | null | undefined;
  if (!chosen) return;
  filePath.value = chosen;
  if (!title.value) title.value = basename(chosen).replace(/\.[^.]+$/, "");
}

/** Monta o item; devolve a chave do erro quando falta o conteúdo. */
function build(): ProgramItem | string {
  const base = props.item;
  const plannedMinutes = Math.max(0, Math.round(Number(minutes.value) || 0));
  const common = {
    id: base?.id ?? newId(),
    title: title.value.trim(),
    subtitle: subtitle.value.trim() || undefined,
    plannedMinutes,
  };

  // Item vindo da liturgia com tipo que o diálogo não cria: só o texto e o tempo mudam.
  if (base && !(CREATABLE_KINDS as readonly string[]).includes(base.kind)) {
    return {
      ...base,
      ...common,
      source: base.source && { ...base.source, item: common.title, subitem: common.subtitle ?? "" },
    };
  }

  const sourceId = base?.source?.id ?? newId();
  switch (kind.value) {
    case "music":
      if (!music.value) return "item_dialog.missing_music";
      return {
        ...common,
        kind: "music",
        title: common.title || music.value.name,
        source: liturgyItem({
          ...(base?.source ?? {}),
          id: sourceId,
          tipo: LiturgyItemTypeEnum.MUSICA,
          subtipo: musicMode.value === ASK ? "" : musicMode.value,
          id_music: music.value.id_music,
          musica: music.value.id_music,
          item: music.value.name,
          has_instrumental_music: music.value.has_instrumental_music,
          escolha: false,
        }),
      };
    case "bible":
      if (!bible.value) return "item_dialog.missing_verse";
      return {
        ...common,
        kind: "bible",
        title: common.title || bible.value.reference,
        bible: bible.value,
      };
    case "file":
      if (!filePath.value) return "item_dialog.missing_file";
      return {
        ...common,
        kind: kindFromPath(filePath.value),
        title: common.title || basename(filePath.value),
        source: liturgyItem({
          id: sourceId,
          tipo: LiturgyItemTypeEnum.ARQUIVO,
          dir: filePath.value,
          item: common.title || basename(filePath.value),
        }),
      };
    case "moment":
      if (!common.title) return "item_dialog.missing_title";
      return { ...common, kind: "moment", children: base?.children ?? [] };
    case "folder": {
      const folder = libraryFolders.value.find((f) => f.path === folderPath.value);
      if (!folderPath.value) return "item_dialog.missing_folder";
      return {
        ...common,
        kind: "folder",
        title: common.title || (folder?.label ?? basename(folderPath.value)),
        folder: folderPath.value,
      };
    }
    case "online_video":
      if (!/^https?:\/\//i.test(url.value.trim())) return "item_dialog.missing_url";
      return {
        ...common,
        kind: "online_video",
        title: common.title || url.value.trim(),
        source: liturgyItem({
          id: sourceId,
          tipo: LiturgyItemTypeEnum.VIDEO_ONLINE,
          url: url.value.trim(),
          item: common.title,
        }),
      };
    default: {
      if (!common.title) return "item_dialog.missing_title";
      const text = noteText.value.trim();
      return {
        ...common,
        kind: "note",
        subtitle: undefined,
        notes: text || undefined,
        source: liturgyItem({
          id: sourceId,
          tipo: LiturgyItemTypeEnum.ANOTACAO,
          item: common.title,
          subitem: text,
        }),
      };
    }
  }
}

function save(): void {
  const result = build();
  if (typeof result === "string") {
    error.value = tm(result);
    return;
  }
  if (!targetSessionId.value) return;
  emit("save", { item: result, sessionId: targetSessionId.value });
  open.value = false;
}
</script>

<style scoped>
.pm-item-form__hint {
  margin: 0;
  font-size: 12px;
  color: var(--lj-text-muted);
}

.pm-item-form {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-5);
}

.pm-item-form__pick {
  display: flex;
  align-items: center;
  gap: var(--lj-space-4);
}

.pm-item-form__picked {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--lj-text-muted);
}

.pm-item-form__minutes {
  width: 96px;
}

.pm-item-form__error {
  margin: 0;
  color: var(--lj-danger);
  font-size: var(--lj-text-sm);
}

.pm-item-form__spacer {
  flex: 1;
}
</style>
