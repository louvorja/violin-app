<template>
  <LjDialog
    :model-value="modelValue"
    :title="isEditing ? t('dialog.edit_title') : t('dialog.add_title')"
    :icon="isEditing ? ICONS.ACTIONS.EDIT : ICONS.ACTIONS.ADD"
    size="lg"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <!-- ─── Campos comuns a todos os tipos ─── -->
    <div class="lif-row">
      <LjField
        class="lif-field lif-field--type"
        :label="t('inputs.type')"
        :error="formErrors?.tipo"
      >
        <LjSelect
          :model-value="form.tipo"
          :items="typeOptions"
          @update:model-value="
            setFormField('tipo', $event);
            onTypeChange();
          "
        />
      </LjField>

      <LjField
        v-if="form.tipo !== LiturgyItemTypeEnum.ITENS_AGENDADOS"
        class="lif-field lif-field--grow"
        :label="t('inputs.item_name')"
        :error="formErrors?.item"
      >
        <LjInput
          :model-value="form.item"
          data-testid="item-name"
          :placeholder="t('inputs.item_name_placeholder')"
          @update:model-value="setFormField('item', $event)"
        />
      </LjField>

      <LjField class="lif-field lif-field--color" :label="t('inputs.color')">
        <div class="lif-color">
          <input
            :value="form.cor"
            type="color"
            class="lif-color__swatch"
            :aria-label="t('inputs.color')"
            @input="setFormField('cor', ($event.target as HTMLInputElement).value)"
          />
          <button
            type="button"
            class="lif-color__toggle"
            :title="t('inputs.color')"
            :aria-expanded="presetsOpen"
            :aria-label="t('inputs.color')"
            @click.stop="presetsOpen = !presetsOpen"
          >
            <LjIcon :icon="ICONS.UI.MENU_DOWN" :size="14" />
          </button>
          <div v-if="presetsOpen" class="lif-color__presets" @click="presetsOpen = false">
            <span
              v-for="c in colors"
              :key="c"
              class="lif-color__preset"
              :class="{ 'is-active': form.cor?.toLowerCase() === c.toLowerCase() }"
              :style="{ background: c }"
              @click="setFormField('cor', c)"
            />
          </div>
        </div>
      </LjField>

      <LjField class="lif-field lif-field--time" :label="t('inputs.time')">
        <!-- Um <input disabled> não dispara eventos de ponteiro, então o gatilho
             do tooltip é o invólucro, não o campo. -->
        <LjTooltip v-if="form.blocoId" :text="t('inputs.time_managed_by_bloco')">
          <span class="lif-tip-anchor">
            <LjInput :model-value="form.time" type="time" disabled />
          </span>
        </LjTooltip>
        <LjInput
          v-else
          :model-value="form.time"
          type="time"
          @update:model-value="setFormField('time', $event)"
        />
      </LjField>

      <LjField class="lif-field lif-field--duration" :label="t('inputs.duration_min')">
        <LjInput
          :model-value="form.duration"
          type="number"
          min="0"
          @update:model-value="setFormField('duration', Number($event))"
        />
      </LjField>
    </div>

    <div
      v-if="form.tipo !== LiturgyItemTypeEnum.BLOCO && blocoItems && blocoItems.length > 0"
      class="lif-row"
    >
      <LjField class="lif-field lif-field--grow" :label="t('inputs.bloco_select')">
        <LjSelect
          :model-value="form.blocoId || ''"
          :items="blocoOptions"
          @update:model-value="setFormField('blocoId', $event)"
        />
      </LjField>
    </div>

    <!-- ─── Painel ANOTAÇÃO ─── -->
    <section v-if="form.tipo === LiturgyItemTypeEnum.ANOTACAO" class="lif-panel">
      <h3 class="lif-panel__title">{{ t("types.anotacao") }}</h3>
      <LjField layout="column" :label="t('inputs.annotation')">
        <LjTextarea
          :model-value="form.subitem"
          :rows="4"
          :placeholder="t('inputs.annotation_placeholder')"
          @update:model-value="setFormField('subitem', $event)"
        />
      </LjField>
    </section>

    <!-- ─── Painel SITE ─── -->
    <section v-if="form.tipo === LiturgyItemTypeEnum.SITE" class="lif-panel">
      <h3 class="lif-panel__title">{{ t("types.site") }}</h3>
      <LjField layout="column" :label="t('inputs.url')">
        <div class="lif-inline lif-inline--half">
          <LjInput
            :model-value="form.url"
            placeholder="https://"
            @update:model-value="setFormField('url', $event)"
            @blur="setFormField('url', Liturgy.validateUrl(form.url))"
          />
          <LjButton
            variant="ghost"
            icon-only
            :icon="ICONS.UI.OPEN_IN_NEW"
            :title="t('actions.open')"
            :aria-label="t('actions.open')"
            @click="openSite"
          />
        </div>
      </LjField>
    </section>

    <!-- ─── Painel ARQUIVO ─── -->
    <section v-if="form.tipo === LiturgyItemTypeEnum.ARQUIVO" class="lif-panel">
      <h3 class="lif-panel__title">{{ t("types.arquivo") }}</h3>
      <LjField layout="column" :label="t('inputs.file_path')">
        <div class="lif-inline lif-inline--half">
          <LjInput
            :model-value="form.dir"
            :placeholder="t('inputs.file_path_placeholder')"
            @update:model-value="setFormField('dir', $event)"
          />
          <LjButton
            variant="ghost"
            icon-only
            :icon="ICONS.UI.FILE"
            :title="t('actions.choose_file')"
            :aria-label="t('actions.choose_file')"
            @click="chooseFile"
          />
        </div>
      </LjField>
    </section>

    <!-- ─── Painel MÚSICA ─── -->
    <section v-if="form.tipo === LiturgyItemTypeEnum.MUSICA" class="lif-panel">
      <LjCheckbox
        :model-value="form.escolha"
        :label="t('inputs.music_choose_later')"
        @update:model-value="setMusicChoice($event)"
      />

      <LjField v-if="!form.escolha" class="lif-field lif-spaced" :label="t('inputs.music_select')">
        <LjCombobox
          :model-value="selectedMusic"
          :items="musicOptions"
          :filter="musicMatches"
          :placeholder="t('inputs.music_placeholder')"
          @update:model-value="onMusicSelected($event as MusicOption)"
        />
      </LjField>

      <LjField
        v-if="!form.escolha && musicSelected"
        class="lif-field lif-spaced"
        :label="t('inputs.music_version_label')"
      >
        <LjSelect
          class="lif-fill"
          :model-value="form.subtipo"
          :items="availableVersions"
          @update:model-value="onVersionChange(String($event))"
        />
      </LjField>
    </section>

    <!-- ─── Painel ITENS AGENDADOS ─── -->
    <section v-if="form.tipo === 'itens-agendados'" class="lif-panel">
      <h3 class="lif-panel__title">{{ t("types.itens-agendados") }}</h3>
      <LjField layout="column" :label="t('inputs.scheduled_category')" :error="formErrors?.id">
        <div class="lif-inline lif-inline--half">
          <LjSelect
            :model-value="String(form.id ?? '')"
            :items="scheduledOptions"
            :placeholder="t('inputs.scheduled_pick')"
            @update:model-value="
              setFormField('id', $event);
              onScheduledCategoryChange();
            "
          />
          <LjButton
            variant="ghost"
            icon-only
            :icon="ICONS.UI.OPTIONS_OUTLINE"
            :title="t('actions.scheduled_manage')"
            :aria-label="t('actions.scheduled_manage')"
            @click="openSchedulesDialog"
          />
        </div>
      </LjField>
      <p v-if="scheduledCategories?.length === 0" class="lif-hint">
        {{ t("inputs.scheduled_empty") }}
      </p>
    </section>

    <!-- ─── Painel VÍDEO ON-LINE ─── -->
    <section v-if="form.tipo === 'video-online'" class="lif-panel">
      <h3 class="lif-panel__title">{{ t("types.video-online") }}</h3>

      <LjField layout="column" class="lif-spaced">
        <div>
          <LjButton variant="primary" :icon="ICONS.ACTIONS.SEARCH" @click="videoSearchOpen = true">
            {{ t("inputs.video_search_btn") }}
          </LjButton>
          <!--
            O X vem de `removable` (é o primitivo do design system, com
            aria-label de fábrica). Clicar limpa a escolha e devolve o campo
            de URL direta ao operador.
          -->
          <LjChip
            v-if="form.url"
            class="lif-selected"
            style="margin-left: 10px"
            :icon="ICONS.MEDIA.YOUTUBE"
            removable
            @remove="clearVideoSelection"
          >
            <span class="lif-selected__name">{{ selectedVideoName }}</span>
          </LjChip>
        </div>
      </LjField>
      <p v-if="!videosList?.length" class="lif-hint lif-spaced">
        {{ t("inputs.video_empty") }}
      </p>
      <LiturgyVideoSearch
        v-model="videoSearchOpen"
        :videos-list="videosList"
        @pick="onVideoSearchPicked"
      />
      <div style="margin: 20px 0 20px 0">OU</div>

      <!-- Em vez de procurar no catálogo: cola o link e confirma. -->
      <LjField layout="column" :label="t('inputs.video_url_or_select')">
        <div class="lif-inline lif-inline--half">
          <!--
            Com vídeo escolhido o campo fica desabilitado: são dois caminhos
            que se excluem (catálogo e link direto) e o que vale é o que está
            selecionado. O X do chip é quem devolve o campo.
          -->
          <LjInput
            v-model="videoUrl"
            :placeholder="t('inputs.video_url_placeholder')"
            :disabled="videoUrlBusy || !!form.url"
            @keydown.enter.prevent="confirmVideoUrl"
          />
          <LjButton
            variant="primary"
            :icon="ICONS.PROJECTION.START"
            :loading="videoUrlBusy"
            :disabled="videoUrlBusy || !!form.url"
            @click="confirmVideoUrl"
          >
            {{ t("inputs.video_url_ok") }}
          </LjButton>
        </div>
      </LjField>
      <LjCheckbox
        class="lif-spaced"
        :model-value="saveToMyVideos"
        :label="t('inputs.video_save_mine')"
        @update:model-value="setSaveToMyVideos($event)"
      />
    </section>

    <!-- ─── Painel BIBLIOTECA DE MÍDIA ─── -->
    <section v-if="form.tipo === LiturgyItemTypeEnum.MEDIA_LIBRARY" class="lif-panel">
      <h3 class="lif-panel__title">{{ t("types.biblioteca-midia") }}</h3>
      <LjField layout="column" :label="t('inputs.library_select')">
        <div>
          <LjButton variant="ghost" :icon="ICONS.ACTIONS.SEARCH" @click="openMediaLibrarySearch">
            {{ t("inputs.library_search_btn") }}
          </LjButton>
        </div>
      </LjField>
      <LjChip v-if="form.ref_id" class="lif-selected" :icon="mediaIconFor(form.subtipo)">
        <span class="lif-selected__name">{{ form.item || form.subitem }}</span>
      </LjChip>
      <LiturgyLibrarySearch
        v-model="librarySearchOpen"
        :title="t('library_search.title_media')"
        :icon="ICONS.MEDIA.LIBRARY"
        :items="libraryItems"
        @pick="onLibraryPicked"
      />
    </section>

    <!-- ─── Painel SOM DE FUNDO ─── -->
    <section v-if="form.tipo === LiturgyItemTypeEnum.BG_SOUND" class="lif-panel">
      <h3 class="lif-panel__title">{{ t("types.som-de-fundo") }}</h3>
      <LjField layout="column" :label="t('inputs.sound_select')">
        <div>
          <LjButton variant="ghost" :icon="ICONS.ACTIONS.SEARCH" @click="openBgSoundSearch">
            {{ t("inputs.sound_search_btn") }}
          </LjButton>
        </div>
      </LjField>
      <LjChip v-if="form.ref_id" class="lif-selected" :icon="ICONS.MUSIC.PLAYBACK">
        <span class="lif-selected__name">{{ form.item || form.subitem }}</span>
      </LjChip>
      <LiturgyLibrarySearch
        v-model="bgSoundSearchOpen"
        :title="t('library_search.title_sound')"
        :icon="ICONS.MUSIC.PLAYBACK"
        :items="bgSoundItems"
        show-detail
        @pick="onBgSoundPicked"
      />
    </section>

    <!-- ─── Painel ANÚNCIOS ─── -->
    <section v-if="form.tipo === LiturgyItemTypeEnum.ANUNCIOS" class="lif-panel">
      <h3 class="lif-panel__title">{{ t("types.anuncios") }}</h3>
      <p class="lif-label">{{ t("anuncios.select_label") }}</p>
      <div class="lif-checklist">
        <LjCheckbox
          :model-value="allAnnouncementsSelected"
          @update:model-value="toggleAllAnnouncements($event)"
        >
          <strong>{{ t("anuncios.all") }}</strong>
        </LjCheckbox>
        <LjCheckbox
          v-for="a in announcementItems"
          :key="a.id"
          :model-value="form.anuncios_ids?.includes(a.id) ?? false"
          :label="a.nome"
          @update:model-value="toggleAnnouncement(a.id, $event)"
        />
      </div>
    </section>

    <!-- ─── Painel OVERLAY ─── -->
    <section v-if="form.tipo === LiturgyItemTypeEnum.OVERLAY" class="lif-panel">
      <h3 class="lif-panel__title">{{ t("types.overlay") }}</h3>
      <LjField layout="column" :label="t('overlay.select_slot')">
        <LjSelect
          :model-value="form.overlay_id ?? ''"
          :items="overlayOptions"
          @update:model-value="setFormField('overlay_id', $event)"
        />
      </LjField>
      <LjField layout="column" :label="t('overlay.action')" group>
        <div class="lif-inline">
          <LjButton
            :variant="form.overlay_action !== 'deactivate' ? 'primary' : 'ghost'"
            :icon="ICONS.UI.EYE"
            @click="setFormField('overlay_action', 'activate')"
          >
            {{ t("overlay.activate") }}
          </LjButton>
          <LjButton
            :variant="form.overlay_action === 'deactivate' ? 'danger' : 'ghost'"
            :icon="ICONS.UI.EYE_OFF"
            @click="setFormField('overlay_action', 'deactivate')"
          >
            {{ t("overlay.deactivate") }}
          </LjButton>
        </div>
      </LjField>
    </section>

    <!-- ─── Vincular sobreposição quando há algo disponível ou um vínculo a remover ─── -->
    <section
      v-if="canShowOverlayLink && (overlaySlots.length > 0 || !!form.linked_overlay_id)"
      class="lif-panel"
    >
      <LjCheckbox
        :model-value="!!form.linked_overlay_id"
        :label="t('overlay.link_overlay')"
        @update:model-value="onLinkOverlayToggle($event)"
      />
      <p v-if="overlaySlots.length === 0" class="lif-hint">
        {{ t("overlay.no_slots") }}
      </p>
      <div v-if="form.linked_overlay_id && overlaySlots.length > 0" class="lif-spaced">
        <LjSelect
          :model-value="form.linked_overlay_id"
          :items="overlayOptions"
          :aria-label="t('overlay.select_slot')"
          @update:model-value="setFormField('linked_overlay_id', $event)"
        />
      </div>
    </section>

    <!-- ─── BLOCO ─── -->
    <section v-if="form.tipo === LiturgyItemTypeEnum.BLOCO" class="lif-panel">
      <h3 class="lif-panel__title">{{ t("types.bloco") }}</h3>
      <p class="lif-hint">{{ t("inputs.bloco_hint") }}</p>
    </section>

    <template #footer>
      <LjButton
        v-if="isEditing"
        size="sm"
        variant="danger"
        :icon="ICONS.ACTIONS.DELETE"
        @click="confirmRemove(editIndex, true)"
      >
        {{ t("actions.delete") }}
      </LjButton>
      <span class="lj-u-spacer" />
      <LjButton size="sm" @click="$emit('update:modelValue', false)">
        {{ t("actions.cancel") }}
      </LjButton>
      <LjButton
        size="sm"
        variant="primary"
        data-testid="item-save"
        :icon="isEditing ? ICONS.ACTIONS.SAVE : ICONS.ACTIONS.ADD"
        @click="saveItem"
      >
        {{ isEditing ? t("actions.save") : t("actions.add") }}
      </LjButton>
    </template>
  </LjDialog>
</template>

<script setup lang="ts">
import { useLiturgyI18n } from "../i18n";
import { ref, watch, computed, nextTick } from "vue";
import {
  LjButton,
  LjCheckbox,
  LjChip,
  LjCombobox,
  LjDialog,
  LjField,
  LjIcon,
  LjInput,
  LjSelect,
  LjTextarea,
  LjTooltip,
} from "@/components/ui";
import { ICONS } from "@/config/Icons";
import Liturgy from "@/helpers/Liturgy";
import DateTime from "@/helpers/DateTime";
import LiturgyVideoSearch, { type VideoSearchItem } from "./LiturgyVideoSearch.vue";
import LiturgyLibrarySearch, { type LibrarySearchItem } from "./LiturgyLibrarySearch.vue";
import $idb from "@/helpers/IndexedDB";
import { DB_TABLE } from "@/constants/DbTables";
import type { LiturgyItem, LiturgyMusicItem, ScheduledCategory } from "@/types/Liturgy";
import type { OverlaySlot } from "@/types/Overlay";
import { LiturgyItemTypeEnum } from "@/enums/LiturgyItemTypeEnum";
import { canLinkOverlay } from "../overlayLink";
import Platform from "@/helpers/Platform";
import $userdata from "@/helpers/UserData";
import { KEYS } from "@/constants/UserDataKeys";
import { buildMusicOptions, musicMatches, type MusicOption } from "../musicOptions";
import $snackbar from "@/helpers/Snackbar";
import { downloadAvailable, fetchYoutubeTitle, videoIdFromUrl } from "@/helpers/OnlineVideo";
import { useOnlineVideoDownloads } from "@/composables/useOnlineVideoDownloads";
import { i18nAtual } from "@/i18n";
import { useMusicCatalog } from "@/composables/useMusicCatalog";
import { useI18n } from "vue-i18n";

const props = withDefaults(
  defineProps<{
    modelValue?: boolean;
    editIndex?: number;
    form: LiturgyItem;
    formErrors?: Record<string, string>;
    colors?: string[];
    musicsList?: LiturgyMusicItem[];
    scheduledCategories?: ScheduledCategory[];
    blocoItems?: LiturgyItem[];
    videosList?: { id: string; name: string; url: string }[];
    overlaySlots?: OverlaySlot[];
    setFormField: (key: string, value: unknown) => void;
    onTypeChange: () => void;
    onMusicChange: () => void;
    onScheduledCategoryChange: () => void;
    setMusicChoice: (choice: string | boolean) => void;
    saveItem: () => void;
    confirmRemove: (index: number, closeDialog?: boolean) => void;
    openSite: () => void;
    chooseFile: () => Promise<void>;
    openSchedulesDialog: () => void;
    /** Recarrega a lista depois de salvar em Meus Vídeos Online. */
    reloadVideos?: () => Promise<void>;
  }>(),
  {
    modelValue: false,
    editIndex: -1,
    colors: () => [],
    musicsList: () => [],
    scheduledCategories: () => [],
    blocoItems: () => [],
    videosList: () => [],
    overlaySlots: () => [],
    reloadVideos: async () => {},
  }
);

defineEmits<{ "update:modelValue": [value: boolean] }>();

const { t } = useLiturgyI18n();

const isEditing = computed(() => props.editIndex >= 0);

function onLinkOverlayToggle(checked: boolean) {
  props.setFormField("linked_overlay_id", checked ? props.overlaySlots?.[0]?.id || "" : "");
}

// Música personalizada tem id negativo; 0 é nenhuma e -1 é o "escolher depois".
const musicSelected = computed(() => {
  const id = Number(props.form.musica);
  return id !== 0 && id !== -1 && !Number.isNaN(id);
});

watch(
  () => props.form.musica,
  (newVal, oldVal) => {
    if (musicSelected.value && newVal !== oldVal && !props.form.escolha) {
      const sub = props.form.subtipo;
      const hasInstr = hasInstrumental(Number(newVal));
      if (!sub || sub === "ja" || sub === "div") {
        props.setFormField("subtipo", "sung");
      } else if ((sub === "pb" || sub === "audio_pb") && !hasInstr) {
        props.setFormField("subtipo", "sung");
      }
      updateDurationForVersion(props.form.subtipo || "sung");
    }
  }
);

interface VersionOption {
  value: string;
  label: string;
}

const availableVersions = computed((): VersionOption[] => {
  const base: VersionOption[] = [
    { value: "sung", label: t("inputs.music_version_sung") },
    { value: "lyric", label: t("inputs.music_version_lyric") },
    { value: "audio", label: t("inputs.music_version_audio-only") },
  ];

  if (hasInstrumental(Number(props.form.musica))) {
    base.splice(1, 0, { value: "pb", label: t("inputs.music_version_pb") });
    base.push({ value: "audio_pb", label: t("inputs.music_version_playback-only") });
  }

  return base;
});

/* ─── Opções dos selects ───
   O <select> nativo comparava tudo como texto do DOM; o LjSelect compara o
   valor de verdade. Onde o id pode chegar como número (categorias agendadas),
   a lista é normalizada para string para o item selecionado continuar casando. */

const typeOptions = computed(() => [
  { value: LiturgyItemTypeEnum.ANOTACAO, label: t("types.anotacao") },
  { value: LiturgyItemTypeEnum.ANUNCIOS, label: t("types.anuncios") },
  { value: LiturgyItemTypeEnum.ARQUIVO, label: t("types.arquivo") },
  { value: LiturgyItemTypeEnum.MEDIA_LIBRARY, label: t("types.biblioteca-midia") },
  { value: LiturgyItemTypeEnum.BLOCO, label: t("types.bloco") },
  { value: LiturgyItemTypeEnum.ITENS_AGENDADOS, label: t("types.itens-agendados") },
  { value: LiturgyItemTypeEnum.MUSICA, label: t("types.musica") },
  { value: LiturgyItemTypeEnum.SITE, label: t("types.site") },
  { value: LiturgyItemTypeEnum.OVERLAY, label: t("types.overlay") },
  { value: LiturgyItemTypeEnum.BG_SOUND, label: t("types.som-de-fundo") },
  { value: LiturgyItemTypeEnum.VIDEO_ONLINE, label: t("types.video-online") },
]);

const blocoOptions = computed(() => [
  { value: "", label: t("inputs.bloco_pick") },
  ...props.blocoItems.map((b) => ({
    value: b.id,
    label: b.time ? `${b.item} — ${b.time}` : b.item,
  })),
]);

// Sem o item "-- selecione --" que o select carregava: no combobox isso é o
// placeholder do campo, e "sem música" é o checkbox "Escolher na hora do culto".
const { t: appT } = useI18n();
const { musics: availableMusics } = useMusicCatalog(() => props.musicsList);
const musicOptions = computed(() =>
  buildMusicOptions(availableMusics.value, appT("components.music_search.custom_album"))
);

const musicOptionById = computed(() => new Map(musicOptions.value.map((o) => [o.value, o])));
const selectedMusic = computed(() => musicOptionById.value.get(Number(props.form.musica)) ?? null);

function onMusicSelected(option: MusicOption) {
  props.setFormField("musica", option.value);
  props.onMusicChange();
}

const scheduledOptions = computed(() => [
  { value: "", label: t("inputs.scheduled_pick") },
  ...props.scheduledCategories.map((c) => ({ value: String(c.id), label: c.nome })),
]);

const overlayOptions = computed(() => [
  { value: "", label: t("overlay.pick") },
  ...props.overlaySlots.map((slot) => ({ value: slot.id, label: slot.name || slot.id })),
]);

function hasInstrumental(musicId: number): boolean {
  const m = props.musicsList?.find((x) => Number(x.id_music) === musicId);
  if (!m) return false;
  return !!(m as Record<string, unknown>).has_instrumental_music;
}

const presetsOpen = ref(false);

function updateDurationForVersion(version: string) {
  if (version === "lyric") return;
  const musicId = props.form.musica;
  if (musicId <= 0) return;
  const m = props.musicsList?.find((x) => Number(x.id_music) === musicId);
  if (!m) return;
  const raw = m as Record<string, unknown>;
  const useInstrumental = version === "pb" || version === "audio_pb";
  const timeStr: string = useInstrumental
    ? (raw.instrumental_duration as string) || (raw.duration as string) || ""
    : (raw.duration as string) || (raw.instrumental_duration as string) || "";
  if (!timeStr) return;
  const totalSeconds = DateTime.toNumber(timeStr);
  const minutes = Math.ceil(totalSeconds / 60);
  props.setFormField("duration", minutes);
}

function onVideoSearchPicked(v: { name: string; url: string }): void {
  props.setFormField("url", v.url);
  props.setFormField("item", v.name);
  props.setFormField("subitem", v.name);
  /*
   * O link colado deixa de valer: sem isto o campo desabilitado ainda
   * carregaria o URL antigo, e o botão "Usar" o reaplicaria por cima da
   * escolha nova sem ninguém ver.
   */
  videoUrl.value = "";
}

/** O X do chip: devolve o campo de URL direta ao operador. */
function clearVideoSelection(): void {
  props.setFormField("url", "");
  props.setFormField("item", "");
  props.setFormField("subitem", "");
  videoUrl.value = "";
}

const videoSearchOpen = ref(false);

// --- URL colada: em vez de procurar no catálogo, o operador cola o link ---
const videoUrl = ref("");
const videoUrlBusy = ref(false);
const saveToMyVideos = ref(false);
const videoDownloads = useOnlineVideoDownloads();

/*
 * Reabre limpo: o checkbox é opt-in e o campo não guarda texto da sessão
 * anterior — senão o operador confirmaria um link sem querer.
 */
watch(
  () => props.modelValue,
  (aberto) => {
    if (aberto) {
      videoUrl.value = "";
      saveToMyVideos.value = false;
    }
  }
);

function setSaveToMyVideos(ativo: boolean): void {
  saveToMyVideos.value = ativo;
}

/**
 * Confirma o link colado: preenche o item e dá partida no download.
 *
 * O download acontece sempre, ligado ou não o checkbox — a opção controla só
 * se o vídeo é salvo na lista. O progresso já vai por tarefa em segundo plano;
 * o aviso é só para não parecer que o botão não fez nada.
 */
async function confirmVideoUrl(): Promise<void> {
  const digitado = videoUrl.value.trim();
  if (!digitado || videoUrlBusy.value) return;
  videoUrlBusy.value = true;
  try {
    const url = Liturgy.validateUrl(digitado);
    const ytId = videoIdFromUrl(url);
    if (!ytId) {
      $snackbar.error(t("inputs.video_url_invalid"));
      return;
    }
    const nome = (await fetchYoutubeTitle(ytId)) || url;
    props.setFormField("url", url);
    props.setFormField("item", nome);
    props.setFormField("subitem", "YouTube");
    videoUrl.value = url;

    if (saveToMyVideos.value) {
      await $idb.put(DB_TABLE.CUSTOM_ONLINE_VIDEOS, {
        id: crypto.randomUUID(),
        name: nome,
        url,
        createdAt: new Date().toISOString(),
      });
      await props.reloadVideos?.();
    }

    /*
     * Aviso só onde há download de verdade: no web/PWA o `download` devolve
     * false e o operador veria "Baixando" sem que nada baixasse.
     */
    if (downloadAvailable()) {
      const globalT = i18nAtual()?.global?.t;
      const aviso = globalT ? String(globalT("online_video.preparing")) : "";
      if (aviso) $snackbar.info(aviso, { key: "liturgy-video-download", timeout: 5000 });
    }
    void videoDownloads.download(ytId, nome, { keep: saveToMyVideos.value });
  } finally {
    videoUrlBusy.value = false;
  }
}

const selectedVideoName = computed(() => {
  const url = props.form.url || "";
  if (!url) return "";
  const video: VideoSearchItem | undefined = props.videosList?.find((v) => v.url === url);
  return video?.name || props.form.item || url;
});

// ─── Biblioteca de Mídia / Som de fundo ──────────────────────────────

const librarySearchOpen = ref(false);
const bgSoundSearchOpen = ref(false);
const libraryItems = ref<LibrarySearchItem[]>([]);
const bgSoundItems = ref<LibrarySearchItem[]>([]);

const MEDIA_TYPE_ICONS: Record<string, string> = {
  image: ICONS.MEDIA.IMAGE,
  video: ICONS.MEDIA.VIDEO_FILE,
  pdf: ICONS.UI.FILE_PDF,
};

function mediaIconFor(subtipo?: string): string {
  return MEDIA_TYPE_ICONS[subtipo || ""] || ICONS.MEDIA.LIBRARY;
}

async function openMediaLibrarySearch(): Promise<void> {
  const all = await $idb.getAll<{
    id: string;
    name: string;
    type: "image" | "video" | "pdf";
  }>(DB_TABLE.MEDIA_LIBRARY);
  libraryItems.value = all.map((f) => ({
    id: f.id,
    name: f.name,
    icon: mediaIconFor(f.type),
    detail: t("library_search.detail_type_" + f.type),
  }));
  librarySearchOpen.value = true;
}

async function openBgSoundSearch(): Promise<void> {
  const all = await $idb.getAll<{
    id: string;
    name: string;
    fileName?: string;
    mime?: string;
  }>(DB_TABLE.BACKGROUND_SOUND_LIBRARY);
  // O som de fundo guarda o rótulo em fileName ("name" pode vir vazio).
  bgSoundItems.value = all.map((s) => ({
    id: s.id,
    name: s.fileName || s.name || s.id,
    icon: ICONS.MUSIC.PLAYBACK,
    detail: s.mime?.replace("audio/", "").toUpperCase(),
  }));
  bgSoundSearchOpen.value = true;
}

function onLibraryPicked(item: LibrarySearchItem): void {
  props.setFormField("ref_id", item.id);
  props.setFormField("item", item.name);
  props.setFormField("subitem", item.name);
  props.setFormField(
    "subtipo",
    Object.entries(MEDIA_TYPE_ICONS).find(([, icon]) => icon === item.icon)?.[0] || ""
  );
}

function onBgSoundPicked(item: LibrarySearchItem): void {
  props.setFormField("ref_id", item.id);
  props.setFormField("item", item.name);
  props.setFormField("subitem", item.name);
  props.setFormField("subtipo", "audio");
}

// ─── Anúncios ────────────────────────────────────────────────────────

interface AnnouncementOption {
  id: string;
  nome: string;
  ordem: number;
}

const announcementItems = ref<AnnouncementOption[]>([]);
const canShowOverlayLink = computed(() => {
  const scheduled =
    props.form.tipo === LiturgyItemTypeEnum.ITENS_AGENDADOS
      ? Liturgy.findScheduledForToday(props.form.id, Liturgy.getActiveDate())
      : null;
  const selectedMusicRecord =
    props.form.tipo === LiturgyItemTypeEnum.MUSICA
      ? props.musicsList.find((music) => Number(music.id_music) === Number(props.form.musica))
      : null;
  const item = selectedMusicRecord
    ? {
        ...props.form,
        id_music: Number(selectedMusicRecord.id_music),
        ref_id: selectedMusicRecord.custom_song_id || props.form.ref_id,
      }
    : props.form;
  return canLinkOverlay(item, {
    scheduledPath: typeof scheduled?.arquivo === "string" ? scheduled.arquivo : "",
    availableAnnouncementIds: announcementItems.value.map((item) => String(item.id)),
    systemMediaPlayer:
      Platform.isDesktop &&
      $userdata.get<boolean>(KEYS.OPTIONS.USE_SYSTEM_MEDIA_PLAYER, false) === true,
  });
});
const allAnnouncementsSelected = computed(() => {
  const ids = props.form.anuncios_ids || [];
  return (
    announcementItems.value.length > 0 &&
    announcementItems.value.every((item) => ids.includes(item.id))
  );
});

async function loadAnnouncementOptions(): Promise<void> {
  const all = await $idb.getAll<{ id: string; nome: string; ordem: number }>(
    DB_TABLE.ANNOUNCEMENTS
  );
  announcementItems.value = all.sort((a, b) => a.ordem - b.ordem);
  // Item padrão para passar na validação de nome.
  if (!props.form.item) {
    props.setFormField("item", t("types.anuncios"));
  }
}

watch(announcementItems, () => {
  if (announcementItems.value.length && !Array.isArray(props.form.anuncios_ids)) {
    props.setFormField(
      "anuncios_ids",
      announcementItems.value.map((a) => a.id)
    );
  }
});

// Carrega a lista quando o tipo muda para Anúncios.
watch(
  () => props.form.tipo,
  (tipo) => {
    if (tipo === LiturgyItemTypeEnum.ANUNCIOS) {
      // nextTick garante que o DOM e o IDB estão prontos.
      void nextTick(() => void loadAnnouncementOptions());
    }
  },
  { immediate: true }
);

function toggleAllAnnouncements(checked: boolean): void {
  props.setFormField("anuncios_ids", checked ? announcementItems.value.map((a) => a.id) : []);
}

function toggleAnnouncement(id: string, checked: boolean): void {
  const ids = new Set(props.form.anuncios_ids || []);
  if (checked) ids.add(id);
  else ids.delete(id);
  props.setFormField("anuncios_ids", [...ids]);
}

function onVersionChange(version: string) {
  props.setFormField("subtipo", version);
  updateDurationForVersion(version);
}
</script>

<!-- O corpo do diálogo viaja num portal, mas é compilado AQUI (slot do
     consumidor), então o Vue carimba o atributo de escopo nele — inclusive na
     raiz dos primitivos filhos — e `scoped` funciona normalmente. -->
<style scoped>
/* ====================== Linhas de campos ======================
   Formulário denso: o rótulo fica à esquerda do controle, não acima, e vários
   campos dividem a mesma linha. */
.lif-row {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: var(--lj-space-6);
  margin-bottom: var(--lj-space-6);
}

.lif-row :deep(.lj-field) {
  margin-bottom: 0;
}

/* O LjField reserva 180px para o rótulo em `row`, medida das telas de Opções.
   Aqui os rótulos são curtos e o formulário é denso, então o rótulo encolhe
   até o texto e o controle fica com a largura restante. */
.lif-row :deep(.lj-field__label),
.lif-panel :deep(.lj-field__label) {
  min-width: 0;
  white-space: nowrap;
}

.lif-row :deep(.lj-field__label) {
  color: var(--lj-text);
}

.lif-panel :deep(.lj-field--row .lj-field__control) {
  flex: 1;
  min-width: 0;
}

.lif-field--grow {
  flex: 1;
  min-width: 200px;
}

.lif-field--grow :deep(.lj-field__control) {
  flex: 1;
}

.lif-field--type :deep(.lj-select) {
  width: 170px;
}

.lif-field--time :deep(.lj-input) {
  width: 100px;
}

.lif-field--duration :deep(.lj-input) {
  width: 72px;
}

.lif-field--color {
  flex-shrink: 0;
}

/* O invólucro existe só para o tooltip ter um alvo que receba mouse: um
   <input disabled> não dispara eventos de ponteiro. */
.lif-tip-anchor {
  display: inline-flex;
}

/* ====================== Painéis por tipo ====================== */
.lif-panel {
  padding-top: var(--lj-space-5);
  border-top: 1px solid var(--lj-surface-divider);
}

.lif-panel + .lif-panel {
  margin-top: var(--lj-space-5);
}

.lif-panel__title {
  margin: 0 0 var(--lj-space-4);
  color: var(--lj-text-muted);
  font-size: var(--lj-text-base);
  font-weight: var(--lj-weight-medium);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.lif-panel :deep(.lj-field:last-child) {
  margin-bottom: 0;
}

.lif-label {
  margin: 0 0 var(--lj-space-4);
  color: var(--lj-text-muted);
  font-size: var(--lj-text-base);
  font-weight: var(--lj-weight-medium);
}

.lif-hint {
  margin: 0;
  padding: var(--lj-space-2) 0;
  color: var(--lj-text-subtle);
  font-size: var(--lj-text-sm);
}

.lif-spaced {
  margin-top: var(--lj-space-4);
}

/* Campo + botão de ação na mesma linha (abrir site, escolher arquivo, buscar) */
.lif-inline {
  display: flex;
  align-items: center;
  gap: var(--lj-space-2);
  /* A largura que decide o tamanho do campo é a da LINHA, não a da janela: o
     diálogo tem max-width fixo (860px no tamanho lg), então uma media query
     trataria uma tela de 2560px como "larga" para um campo que continua
     medindo ~790px. Mesma convenção de `overlay-module` e `lj-slide`. */
  container-type: inline-size;
  container-name: lif-inline;
}

/* O campo ocupa uma parte da linha e o botão fica ao lado. A escada sobe de
   50% para 100% conforme a linha encolhe, para o campo não virar um traço
   estreito em tela pequena nem uma barra de 600px em tela grande.

   A largura vai no WRAPPER, via :deep(), e não na classe do controle:
   `LjInput` e `LjSelect` usam `inheritAttrs: false` e repassam `$attrs` para
   o elemento interno (o <input> e o gatilho do select). No `LjInput` a
   classe ia parar no <input>, que não é flex item da linha — por isso o
   `flex: 1` desta regra nunca teve efeito nenhum. */
.lif-inline--half :deep(.lj-input),
.lif-inline--half :deep(.lj-select) {
  flex: 1 1 100%;
  min-width: 0;
}

@container lif-inline (min-width: 480px) {
  .lif-inline--half :deep(.lj-input),
  .lif-inline--half :deep(.lj-select) {
    flex: 0 1 75%;
  }
}

@container lif-inline (min-width: 640px) {
  .lif-inline--half :deep(.lj-input),
  .lif-inline--half :deep(.lj-select) {
    flex: 0 1 50%;
  }
}

/* No degrau de 100% o botão não caberia ao lado — `.lif-inline` não faz wrap,
   e ele seria espremado a um alvo de 2px. Ele quebra para a linha de baixo,
   encostado na direita. */
@container lif-inline (max-width: 479px) {
  .lif-inline--half {
    flex-wrap: wrap;
  }
  .lif-inline--half > :last-child {
    margin-left: auto;
  }
}

.lif-fill {
  width: 100%;
}

.lif-checklist {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--lj-space-3);
}

/* Item já escolhido nos painéis de busca — nome longo trunca em vez de
   empurrar a largura do diálogo. */
.lif-selected {
  max-width: 100%;
}

.lif-selected .lif-selected__name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ====================== Seletor de cor ======================
   Sem primitivo equivalente no catálogo: o <input type="color"> nativo abre o
   seletor do sistema e a paleta ao lado é atalho para as cores da liturgia. */
.lif-color {
  display: inline-flex;
  align-items: center;
  position: relative;
}

.lif-color__swatch {
  width: var(--lj-fixed-btn-width);
  height: var(--lj-ui-h-md);
  padding: 0;
  background: transparent;
  border: var(--lj-ui-border);
  border-right: 0;
  border-radius: var(--lj-ui-radius) 0 0 var(--lj-ui-radius);
  cursor: pointer;
}

.lif-color__toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: var(--lj-ui-h-md);
  padding: 0;
  background: var(--lj-surface-bg);
  border: var(--lj-ui-border);
  border-radius: 0 var(--lj-ui-radius) var(--lj-ui-radius) 0;
  color: var(--lj-text);
  cursor: pointer;
}

.lif-color__toggle:hover {
  background: var(--lj-surface-bg-hover);
}

.lif-color__toggle:focus-visible {
  outline: none;
  box-shadow: var(--lj-ui-focus);
  border-color: var(--lj-ui-accent);
}

.lif-color__presets {
  position: absolute;
  top: calc(100% + var(--lj-space-2));
  left: 0;
  z-index: 1;
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: var(--lj-space-2);
  padding: var(--lj-space-3);
  background: var(--lj-surface-bg);
  border: var(--lj-ui-float-border);
  border-radius: var(--lj-radius-md);
  box-shadow: var(--lj-ui-float-shadow);
}

.lif-color__preset {
  width: 18px;
  height: 18px;
  border: var(--lj-ui-border);
  border-radius: var(--lj-radius-xs);
  cursor: pointer;
}

.lif-color__preset:hover {
  transform: scale(1.15);
}

.lif-color__preset.is-active {
  border-color: var(--lj-white);
  box-shadow: 0 0 0 2px var(--lj-ui-accent);
}
</style>
