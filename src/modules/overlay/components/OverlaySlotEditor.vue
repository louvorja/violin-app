<template>
  <div class="editor-root">
    <LjTabs v-model="activeTab" :tabs="tabItems" :aria-label="tm('title')" class="editor-tabs" />

    <!-- Content tab -->
    <div v-if="activeTab === 'content'" class="editor-pane">
      <LjField :label="tm('slot.name')" layout="column">
        <LjInput :model-value="m.name" @update:model-value="set('name', $event)" />
      </LjField>

      <LjField :label="tm('slot.type')" layout="column">
        <LjSelect
          :model-value="m.type"
          :items="typeOptions"
          @update:model-value="
            set('type', $event);
            onTypeChange();
          "
        />
      </LjField>

      <LjField v-if="m.type === 'text'" :label="tm('slot.content')" layout="column">
        <LjTextarea
          :model-value="m.content"
          :rows="3"
          @update:model-value="set('content', $event)"
        />
      </LjField>

      <LjField v-if="m.type === 'module_mirror'" :label="tm('slot.module_source')" layout="column">
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
      <div class="editor-position">
        <LjField
          :label="tm('position.anchor')"
          layout="column"
          group
          class="editor-position__anchor"
        >
          <div class="anchor-grid">
            <button
              v-for="anchor in anchors"
              :key="anchor"
              type="button"
              class="anchor-cell"
              :class="{ 'anchor-cell--active': m.position.anchor === anchor }"
              :aria-label="tm('anchors.' + anchor)"
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

        <div class="editor-position__offsets">
          <LjField :label="tm('position.offset_x')" layout="column">
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
          <LjField :label="tm('position.offset_y')" layout="column">
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
    </div>

    <!-- Appearance tab -->
    <div v-if="activeTab === 'appearance'" class="editor-pane">
      <LjField :label="tm('style.font')" layout="column">
        <div class="editor-font">
          <SelectFont
            :model-value="m.style.font"
            @update:model-value="
              m.style.font = $event;
              emitChange();
            "
          />
        </div>
      </LjField>

      <LjField :label="tm('style.font_size')" layout="column">
        <LjSlider
          :model-value="m.style.font_size"
          :min="1"
          :max="20"
          :step="0.5"
          unit="%"
          show-value
          @update:model-value="
            m.style.font_size = $event;
            emitChange();
          "
        />
      </LjField>

      <div class="editor-grid">
        <LjField :label="tm('style.color')" layout="column">
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
        <LjField :label="tm('style.text_align')" layout="column">
          <LjSelect
            :model-value="m.style.text_align"
            :items="alignOptions"
            @update:model-value="
              m.style.text_align = $event;
              emitChange();
            "
          />
        </LjField>
      </div>

      <LjField :label="tm('style.background')" layout="column">
        <div class="editor-background">
          <div class="editor-color editor-background__color">
            <LjInput
              :model-value="backgroundColor"
              type="color"
              :disabled="noBackground"
              @update:model-value="setBackground($event)"
            />
          </div>
          <LjCheckbox
            :model-value="noBackground"
            :label="tm('style.no_background')"
            @update:model-value="setNoBackground($event)"
          />
        </div>
      </LjField>

      <LjField :label="tm('style.opacity')" layout="column">
        <LjSlider
          :model-value="m.style.opacity"
          :min="0"
          :max="100"
          unit="%"
          show-value
          @update:model-value="
            m.style.opacity = $event;
            emitChange();
          "
        />
      </LjField>

      <div class="editor-grid editor-checkboxes">
        <LjCheckbox
          :model-value="m.style.text_shadow"
          :label="tm('style.text_shadow')"
          @update:model-value="
            m.style.text_shadow = $event;
            emitChange();
          "
        />
        <LjCheckbox
          :model-value="m.style.box_shadow"
          :label="tm('style.box_shadow')"
          @update:model-value="
            m.style.box_shadow = $event;
            emitChange();
          "
        />
      </div>

      <div class="editor-grid">
        <LjField :label="tm('style.padding')" layout="column">
          <LjInput
            :model-value="m.style.padding"
            @update:model-value="
              m.style.padding = $event;
              emitChange();
            "
          />
        </LjField>

        <LjField :label="tm('style.border_radius')" layout="column">
          <LjInput
            :model-value="m.style.border_radius"
            @update:model-value="
              m.style.border_radius = $event;
              emitChange();
            "
          />
        </LjField>
      </div>

      <LjField :label="tm('style.border')" layout="column">
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

        <LjField :label="tm('style.image_scale')" layout="column">
          <LjSlider
            :model-value="m.style.image_scale"
            :min="10"
            :max="200"
            :step="5"
            unit="%"
            show-value
            @update:model-value="
              m.style.image_scale = $event;
              emitChange();
            "
          />
        </LjField>

        <LjField :label="tm('style.image_fit')" layout="column">
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
      <LjField :label="tm('animation.entrance')" layout="column">
        <LjSelect
          :model-value="m.style.animation"
          :items="animationOptions"
          @update:model-value="
            m.style.animation = $event;
            emitChange();
          "
        />
      </LjField>

      <LjField :label="tm('animation.exit')" layout="column">
        <LjSelect
          :model-value="m.style.animation_exit"
          :items="animationOptions"
          @update:model-value="
            m.style.animation_exit = $event;
            emitChange();
          "
        />
      </LjField>

      <LjField :label="tm('animation.duration')" layout="column">
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
        :label="tm('visibility.show_on_return')"
        @update:model-value="
          m.show_on_return = $event;
          emitChange();
        "
      />
      <LjCheckbox
        :model-value="m.show_on_obs"
        :label="tm('visibility.show_on_obs')"
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
const tm = (key) => _t(`modules.overlay.${key}`);

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
  { value: "content", label: tm("slot.content") },
  { value: "position", label: tm("position.title") },
  { value: "appearance", label: tm("style.title") },
  { value: "animation", label: tm("animation.title") },
  { value: "visibility", label: tm("visibility.title") },
]);

const typeOptions = [
  { label: tm("slot.type_text"), value: "text" },
  { label: tm("slot.type_image"), value: "image" },
  { label: tm("slot.type_module_mirror"), value: "module_mirror" },
];

const moduleOptions = [
  ...OVERLAY_MODULE_SOURCES.map((source) => ({
    label: _t(getModuleTitle(source)) || source,
    value: source,
  })),
];

const animationOptions = OVERLAY_ANIMATIONS.map((a) => ({
  label: tm("animations." + a),
  value: a,
}));

const alignOptions = [
  { label: tm("style.align_left"), value: "left" },
  { label: tm("style.align_center"), value: "center" },
  { label: tm("style.align_right"), value: "right" },
];

const fitOptions = [
  { label: tm("style.fit_contain"), value: "contain" },
  { label: tm("style.fit_cover"), value: "cover" },
  { label: tm("style.fit_fill"), value: "fill" },
  { label: tm("style.fit_none"), value: "none" },
  { label: tm("style.fit_scale_down"), value: "scale-down" },
];

// <input type="color"> não representa "transparente": sem esta ponte ele
// mostrava preto para um fundo que na verdade não pinta nada, e depois de
// escolher uma cor não havia como voltar.
const noBackground = computed(() => !m.style.background || m.style.background === "transparent");
const backgroundColor = computed(() => (noBackground.value ? lastBackground : m.style.background));
let lastBackground = noBackground.value ? "#000000" : m.style.background;

function setBackground(color) {
  lastBackground = color;
  m.style.background = color;
  emitChange();
}

function setNoBackground(none) {
  m.style.background = none ? "transparent" : lastBackground;
  emitChange();
}

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

/* Cinco abas com o respiro padrão pedem 409px; com este, 369px — o que cabe no
   cartão da lista sem rolagem horizontal. */
.editor-tabs :deep(.lj-tabs__trigger) {
  padding-inline: var(--lj-space-4);
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

/* `minmax(0, 1fr)` e largura 100% nos campos: o <input> nasce com ~177px de
   largura intrínseca, e uma coluna `1fr` comum não encolhe abaixo disso — no
   painel estreito o segundo campo estourava a moldura do cartão. */
.editor-grid,
.editor-position__offsets {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--lj-space-5);
}

.editor-grid :deep(.lj-input),
.editor-grid :deep(.lj-select),
.editor-position__offsets :deep(.lj-input) {
  width: 100%;
  min-width: 0;
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

/* O SelectFont vem com a largura fixa da tela de Opções; aqui ele acompanha os
   demais campos do painel. */
.editor-font :deep(.select-font) {
  width: 100%;
}

.editor-background {
  display: flex;
  align-items: center;
  gap: var(--lj-space-5);
}

.editor-background__color {
  flex: 1;
  min-width: 0;
}

/* A grade é uma miniatura da tela (16:9): cada célula fica onde a âncora cai na
   projeção, e o conjunto cabe ao lado dos deslocamentos em vez de ocupar a
   largura toda. */
.editor-position {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: var(--lj-space-6);
}

.editor-position__anchor {
  flex: 0 0 auto;
}

.editor-position__offsets {
  flex: 1 1 200px;
  min-width: 0;
}

.anchor-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  grid-template-rows: repeat(3, 1fr);
  gap: var(--lj-space-2);
  width: 176px;
  aspect-ratio: 16 / 9;
  padding: var(--lj-space-3);
  background: var(--lj-surface-bg-soft);
  border: 1px solid var(--lj-surface-border);
  border-radius: var(--lj-radius-md);
}

.anchor-cell {
  display: flex;
  align-items: center;
  justify-content: center;
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
