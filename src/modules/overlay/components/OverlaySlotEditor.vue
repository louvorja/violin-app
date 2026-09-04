<template>
  <div class="editor-root">
    <LjTabs v-model="activeTab" :tabs="tabItems" :aria-label="t('title')" class="editor-tabs" />

    <!-- Content tab -->
    <div v-if="activeTab === 'content'" class="editor-pane">
      <LjField :label="t('slot.name')" layout="column">
        <LjInput :model-value="m.name" @update:model-value="set('name', $event)" />
      </LjField>

      <LjField :label="t('slot.type')" layout="column">
        <LjSelect
          :model-value="m.type"
          :items="typeOptions"
          @update:model-value="
            set('type', $event);
            onTypeChange();
          "
        />
      </LjField>

      <LjField v-if="m.type === 'text'" :label="t('slot.content')" layout="column">
        <LjTextarea
          :model-value="m.content"
          :rows="3"
          @update:model-value="set('content', $event)"
        />
      </LjField>

      <LjField v-if="m.type === 'module_mirror'" :label="t('slot.module_source')" layout="column">
        <LjSelect
          :model-value="m.source_module"
          :items="moduleOptions"
          @update:model-value="set('source_module', $event)"
        />
      </LjField>

      <div v-if="m.type === 'image'" class="editor-image-picker">
        <OverlayImagePicker :selected-id="m.file_id" @select="set('file_id', $event)" />
      </div>
    </div>

    <!-- Position tab -->
    <div v-if="activeTab === 'position'" class="editor-pane">
      <LjField :label="t('position.anchor')" layout="column" group>
        <div class="anchor-grid">
          <button
            v-for="anchor in anchors"
            :key="anchor"
            type="button"
            class="anchor-cell"
            :class="{ 'anchor-cell--active': m.position.anchor === anchor }"
            :aria-label="t('anchors.' + anchor)"
            :aria-pressed="m.position.anchor === anchor"
            @click="
              m.position.anchor = anchor;
              emitChange();
            "
          >
            <span class="anchor-dot" />
          </button>
        </div>
      </LjField>

      <div class="editor-grid">
        <LjField :label="t('position.offset_x')" layout="column">
          <LjInput
            :model-value="m.position.offset_x"
            type="number"
            @update:model-value="
              m.position.offset_x = Number($event);
              emitChange();
            "
          >
            <template #suffix><span class="editor-suffix">px</span></template>
          </LjInput>
        </LjField>
        <LjField :label="t('position.offset_y')" layout="column">
          <LjInput
            :model-value="m.position.offset_y"
            type="number"
            @update:model-value="
              m.position.offset_y = Number($event);
              emitChange();
            "
          >
            <template #suffix><span class="editor-suffix">px</span></template>
          </LjInput>
        </LjField>
      </div>
    </div>

    <!-- Appearance tab -->
    <div v-if="activeTab === 'appearance'" class="editor-pane">
      <LjField :label="t('style.font')" layout="column">
        <SelectFont
          :model-value="m.style.font"
          @update:model-value="
            m.style.font = $event;
            emitChange();
          "
        />
      </LjField>

      <LjField :label="t('style.font_size')" layout="column">
        <LjSlider
          :model-value="m.style.font_size"
          :min="1"
          :max="20"
          :step="0.5"
          show-value
          @update:model-value="
            m.style.font_size = $event;
            emitChange();
          "
        />
      </LjField>

      <div class="editor-grid">
        <LjField :label="t('style.color')" layout="column">
          <div class="editor-color">
            <LjInput
              :model-value="m.style.color"
              type="color"
              @update:model-value="
                m.style.color = $event;
                emitChange();
              "
            />
          </div>
        </LjField>
        <LjField :label="t('style.background')" layout="column">
          <div class="editor-color">
            <LjInput
              :model-value="m.style.background"
              type="color"
              @update:model-value="
                m.style.background = $event;
                emitChange();
              "
            />
          </div>
        </LjField>
      </div>

      <LjField :label="t('style.opacity')" layout="column">
        <LjSlider
          :model-value="m.style.opacity"
          :min="0"
          :max="100"
          show-value
          @update:model-value="
            m.style.opacity = $event;
            emitChange();
          "
        />
      </LjField>

      <LjField :label="t('style.text_align')" layout="column">
        <LjSelect
          :model-value="m.style.text_align"
          :items="alignOptions"
          @update:model-value="
            m.style.text_align = $event;
            emitChange();
          "
        />
      </LjField>

      <div class="editor-grid editor-checkboxes">
        <LjCheckbox
          :model-value="m.style.text_shadow"
          :label="t('style.text_shadow')"
          @update:model-value="
            m.style.text_shadow = $event;
            emitChange();
          "
        />
        <LjCheckbox
          :model-value="m.style.box_shadow"
          :label="t('style.box_shadow')"
          @update:model-value="
            m.style.box_shadow = $event;
            emitChange();
          "
        />
      </div>

      <LjField :label="t('style.padding')" layout="column">
        <LjInput
          :model-value="m.style.padding"
          @update:model-value="
            m.style.padding = $event;
            emitChange();
          "
        />
      </LjField>

      <LjField :label="t('style.border_radius')" layout="column">
        <LjInput
          :model-value="m.style.border_radius"
          @update:model-value="
            m.style.border_radius = $event;
            emitChange();
          "
        />
      </LjField>

      <LjField :label="t('style.border')" layout="column">
        <LjInput
          :model-value="m.style.border"
          placeholder="1px solid #fff"
          @update:model-value="
            m.style.border = $event;
            emitChange();
          "
        />
      </LjField>

      <template v-if="m.type === 'image'">
        <hr class="editor-divider" />

        <LjField :label="t('style.image_scale')" layout="column">
          <LjSlider
            :model-value="m.style.image_scale"
            :min="10"
            :max="200"
            :step="5"
            show-value
            @update:model-value="
              m.style.image_scale = $event;
              emitChange();
            "
          />
        </LjField>

        <LjField :label="t('style.image_fit')" layout="column">
          <LjSelect
            :model-value="m.style.object_fit"
            :items="fitOptions"
            @update:model-value="
              m.style.object_fit = $event;
              emitChange();
            "
          />
        </LjField>
      </template>
    </div>

    <!-- Animation tab -->
    <div v-if="activeTab === 'animation'" class="editor-pane">
      <LjField :label="t('animation.entrance')" layout="column">
        <LjSelect
          :model-value="m.style.animation"
          :items="animationOptions"
          @update:model-value="
            m.style.animation = $event;
            emitChange();
          "
        />
      </LjField>

      <LjField :label="t('animation.exit')" layout="column">
        <LjSelect
          :model-value="m.style.animation_exit"
          :items="animationOptions"
          @update:model-value="
            m.style.animation_exit = $event;
            emitChange();
          "
        />
      </LjField>

      <LjField :label="t('animation.duration')" layout="column">
        <LjSlider
          :model-value="m.style.animation_duration"
          :min="100"
          :max="1000"
          :step="50"
          show-value
          @update:model-value="
            m.style.animation_duration = $event;
            emitChange();
          "
        />
      </LjField>
    </div>

    <!-- Visibility tab -->
    <div v-if="activeTab === 'visibility'" class="editor-pane">
      <LjCheckbox
        :model-value="m.show_on_return"
        :label="t('visibility.show_on_return')"
        @update:model-value="
          m.show_on_return = $event;
          emitChange();
        "
      />
      <LjCheckbox
        :model-value="m.show_on_obs"
        :label="t('visibility.show_on_obs')"
        @update:model-value="
          m.show_on_obs = $event;
          emitChange();
        "
      />
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch, nextTick } from "vue";
import { useI18n } from "vue-i18n";
import OverlayImagePicker from "./OverlayImagePicker.vue";
import SelectFont from "@/components/inputs/SelectFont.vue";
import {
  LjCheckbox,
  LjField,
  LjInput,
  LjSelect,
  LjSlider,
  LjTabs,
  LjTextarea,
} from "@/components/ui";
import { OVERLAY_ANCHORS, OVERLAY_ANIMATIONS, OVERLAY_MODULE_SOURCES } from "@/types/Overlay";
import { getModuleTitle } from "@/config/modules";

const props = defineProps({
  slotData: { type: Object, required: true },
});

const emit = defineEmits(["change"]);

const activeTab = ref("content");

const { t: _t } = useI18n();
const t = (key) => _t(`modules.overlay.${key}`);

const m = reactive({ ...props.slotData, style: { ...props.slotData.style } });

// Sync parent → local (external updates via broadcast)
let externalUpdate = false;
watch(
  () => props.slotData,
  (val) => {
    if (val && val.id === m.id) {
      externalUpdate = true;
      Object.assign(m, val);
      if (val.style) Object.assign(m.style, val.style);
      nextTick(() => {
        externalUpdate = false;
      });
    }
  },
  { deep: true }
);

// Sync local → parent
watch(
  m,
  () => {
    if (!externalUpdate) emit("change", { ...m, style: { ...m.style } });
  },
  { deep: true }
);

function set(key, value) {
  m[key] = value;
}

function emitChange() {
  emit("change");
}

const anchors = OVERLAY_ANCHORS;

// Os rótulos das abas eram interpolados no template e reagiam à troca de
// idioma; o LjTabs recebe a lista pronta, então ela precisa ser computada.
const tabItems = computed(() => [
  { value: "content", label: t("slot.content") },
  { value: "position", label: t("position.title") },
  { value: "appearance", label: t("style.title") },
  { value: "animation", label: t("animation.title") },
  { value: "visibility", label: t("visibility.title") },
]);

const typeOptions = [
  { label: t("slot.type_text"), value: "text" },
  { label: t("slot.type_image"), value: "image" },
  { label: t("slot.type_module_mirror"), value: "module_mirror" },
];

const moduleOptions = [
  ...OVERLAY_MODULE_SOURCES.map((source) => ({
    label: _t(getModuleTitle(source)) || source,
    value: source,
  })),
];

const animationOptions = OVERLAY_ANIMATIONS.map((a) => ({
  label: t("animations." + a),
  value: a,
}));

const alignOptions = [
  { label: t("style.align_left"), value: "left" },
  { label: t("style.align_center"), value: "center" },
  { label: t("style.align_right"), value: "right" },
];

const fitOptions = [
  { label: t("style.fit_contain"), value: "contain" },
  { label: t("style.fit_cover"), value: "cover" },
  { label: t("style.fit_fill"), value: "fill" },
  { label: t("style.fit_none"), value: "none" },
  { label: t("style.fit_scale_down"), value: "scale-down" },
];

function onTypeChange() {
  if (m.type !== "module_mirror") m.source_module = null;
  if (m.type !== "image") m.file_id = "";
}
</script>

<style scoped>
.editor-root {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.editor-tabs {
  flex-shrink: 0;
}

.editor-pane {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-5);
  padding: var(--lj-space-5) 0;
}

/* O LjField já reserva margem inferior própria; aqui quem espaça é o gap do
   painel, senão cada campo ganharia o dobro do respiro. */
.editor-pane :deep(.lj-field) {
  margin-bottom: 0;
}

.editor-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--lj-space-5);
}

.editor-checkboxes {
  align-items: center;
}

.editor-divider {
  height: 0;
  margin: var(--lj-space-2) 0;
  border: 0;
  border-top: 1px solid var(--lj-surface-divider);
}

.editor-suffix {
  color: var(--lj-text-subtle);
  font-size: var(--lj-text-sm);
}

/* O seletor de cor é um <input type="color"> nativo: o invólucro existe só
   para o CSS com escopo alcançar a moldura do LjInput. */
.editor-color :deep(.lj-input) {
  width: 100%;
  padding-inline: var(--lj-space-2);
}

.editor-color :deep(.lj-input__field) {
  cursor: pointer;
}

.anchor-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--lj-space-2);
  padding: var(--lj-space-4);
  background: var(--lj-surface-bg-soft);
  border: 1px solid var(--lj-surface-border);
  border-radius: var(--lj-radius-md);
}

.anchor-cell {
  display: flex;
  align-items: center;
  justify-content: center;
  aspect-ratio: 1;
  padding: 0;
  background: var(--lj-surface-bg-hover);
  border: 1px solid transparent;
  border-radius: var(--lj-radius-xs);
  cursor: pointer;
  transition:
    background var(--lj-transition-fast),
    border-color var(--lj-transition-fast);
}

.anchor-cell:hover {
  background: var(--lj-ui-accent-soft);
}

.anchor-cell:focus-visible {
  outline: none;
  box-shadow: var(--lj-ui-focus);
}

.anchor-cell--active {
  background: var(--lj-ui-accent-soft);
  border-color: var(--lj-ui-accent);
}

.anchor-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--lj-text-subtle);
}

.anchor-cell--active .anchor-dot {
  background: var(--lj-ui-accent);
}

.editor-image-picker {
  min-height: 120px;
}
</style>
