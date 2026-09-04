<template>
  <LjDialog
    :model-value="modelValue"
    :title="$t('shell.category.manage_categories')"
    :icon="ICONS.UI.TUNE"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <div class="cat-toolbar">
      <LjButton size="sm" variant="primary" :icon="ICONS.ACTIONS.ADD" @click="openNewCategory">
        {{ $t("shell.category.new_category") }}
      </LjButton>
    </div>

    <LjEmpty
      v-if="categories.length === 0"
      :icon="ICONS.UI.TAG"
      :title="$t('shell.category.no_categories')"
    />

    <div v-else class="cat-manage-list">
      <div v-for="cat in categories" :key="cat.id" class="cat-manage-item">
        <div class="cat-manage-item-icon" :style="{ background: cat.color }">
          <Icon v-if="cat.iconType === 'icon'" :icon="cat.icon" :size="18" />
          <img v-else :src="cat.icon" class="cat-manage-item-img" alt="" />
        </div>
        <span class="cat-manage-item-name lj-u-fill lj-u-truncate">{{ cat.name }}</span>
        <LjButton
          size="sm"
          variant="ghost"
          icon-only
          :icon="ICONS.ACTIONS.EDIT"
          :aria-label="$t('actions.edit')"
          @click="openEditCategory(cat)"
        />
        <LjButton
          size="sm"
          variant="ghost"
          icon-only
          class="cat-btn-danger"
          :icon="ICONS.ACTIONS.DELETE"
          :aria-label="$t('actions.delete')"
          @click="deleteCategory(cat)"
        />
      </div>
    </div>

    <template #footer>
      <LjButton size="sm" @click="$emit('update:modelValue', false)">
        {{ $t("actions.close") }}
      </LjButton>
    </template>
  </LjDialog>

  <!-- New/Edit Category Dialog -->
  <LjDialog
    v-model="showForm"
    :title="editingId ? $t('shell.category.edit_category') : $t('shell.category.new_category')"
    :icon="editingId ? ICONS.ACTIONS.EDIT : ICONS.ACTIONS.ADD"
  >
    <LjField layout="column" :label="$t('shell.category.category_name')">
      <LjInput v-model="form.name" />
    </LjField>

    <div class="cat-form-grid">
      <div class="cat-form-col">
        <span class="cat-label">{{ $t("components.customization.color") }}</span>
        <div class="cat-color-swatches">
          <button
            v-for="c in colorPresets"
            :key="c"
            type="button"
            class="cat-color-swatch"
            :class="{ 'cat-color-swatch--active': form.color === c }"
            :style="{ background: c }"
            :aria-label="c"
            :aria-pressed="form.color === c"
            @click="form.color = c"
          />
        </div>
      </div>

      <div class="cat-form-col">
        <span class="cat-label">{{ $t("shell.icon") }}</span>
        <div class="cat-icon-grid">
          <button
            v-for="opt in iconOptions"
            :key="opt.value"
            type="button"
            class="cat-icon-btn"
            :class="{ 'cat-icon-btn--active': form.icon === opt.value }"
            :aria-pressed="form.icon === opt.value"
            @click="form.icon = opt.value"
          >
            <Icon :icon="opt.value" :size="20" />
          </button>
        </div>

        <div class="cat-divider" />

        <span class="cat-label">{{ $t("shell.category.custom_image") }}</span>
        <div class="cat-upload-row">
          <LjButton
            size="sm"
            variant="subtle"
            :icon="ICONS.ACTIONS.UPLOAD"
            @click="triggerIconUpload"
          >
            {{ $t("shell.category.upload_image") }}
          </LjButton>
        </div>
        <input
          ref="iconFileInput"
          type="file"
          accept="image/*"
          class="cat-file-input"
          @change="onIconFile"
        />
        <div v-if="form.iconImage" class="cat-custom-icon-preview">
          <img :src="form.iconImage" class="cat-custom-icon-img" alt="" />
          <LjButton
            size="sm"
            variant="ghost"
            icon-only
            class="cat-custom-icon-remove cat-btn-danger"
            :icon="ICONS.ACTIONS.CLOSE"
            :aria-label="$t('components.ui.remove')"
            @click="removeCustomIcon"
          />
        </div>
      </div>
    </div>

    <template #footer>
      <LjButton
        v-if="editingId"
        size="sm"
        variant="danger"
        class="cat-footer-left"
        :icon="ICONS.ACTIONS.DELETE"
        @click="deleteFromForm"
      >
        {{ $t("actions.delete") }}
      </LjButton>
      <LjButton size="sm" @click="showForm = false">{{ $t("actions.cancel") }}</LjButton>
      <LjButton
        size="sm"
        variant="primary"
        :disabled="!form.name.trim() || saving"
        :loading="saving"
        @click="saveForm"
      >
        {{ $t("actions.save") }}
      </LjButton>
    </template>
  </LjDialog>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import Icon from "@/components/Icon.vue";
import { LjButton, LjDialog, LjEmpty, LjField, LjInput } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { MediaFile } from "@/types/Media";

export interface CategoryFileData {
  id: string;
  name: string;
  icon: string;
  iconType: "icon" | "image";
  iconData?: ArrayBuffer;
  iconMime?: string;
  color: string;
  files?: MediaFile[];
}

const props = defineProps<{
  modelValue: boolean;
  categories: CategoryFileData[];
  saving: boolean;
  iconOptions: { value: string }[];
  colorPresets: string[];
  moduleId: string;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  save: [category: CategoryFileData];
  delete: [id: string];
}>();

const { t } = useI18n();

const showForm = ref(false);
const editingId = ref<string | null>(null);
const iconFileInput = ref<HTMLInputElement | null>(null);

const form = ref<{
  name: string;
  icon: string;
  iconType: "icon" | "image";
  iconImage: string;
  iconData: ArrayBuffer | null;
  iconMime: string;
  color: string;
}>({
  name: "",
  icon: "",
  iconType: "icon",
  iconImage: "",
  iconData: null,
  iconMime: "",
  color: props.colorPresets[0] || "#4CAF50",
});

watch(showForm, (v) => {
  if (!v) editingId.value = null;
});

function openNewCategory(): void {
  editingId.value = null;
  form.value = {
    name: "",
    icon: props.iconOptions[0]?.value || "",
    iconType: "icon",
    iconImage: "",
    iconData: null,
    iconMime: "",
    color: props.colorPresets[0] || "#4CAF50",
  };
  showForm.value = true;
}

function openEditCategory(cat: CategoryFileData): void {
  editingId.value = cat.id;
  form.value = {
    name: cat.name,
    icon: cat.icon,
    iconType: cat.iconType,
    iconImage: cat.iconType === "image" ? cat.icon : "",
    iconData: cat.iconData || null,
    iconMime: cat.iconMime || "",
    color: cat.color,
  };
  showForm.value = true;
}

function deleteCategory(cat: CategoryFileData): void {
  if (!window.confirm(t("shell.category.confirm_delete_category"))) return;
  emit("delete", cat.id);
}

function deleteFromForm(): void {
  if (!editingId.value) return;
  if (!window.confirm(t("shell.category.confirm_delete_category"))) return;
  emit("delete", editingId.value);
  showForm.value = false;
}

function saveForm(): void {
  if (!form.value.name.trim()) return;
  const cat: CategoryFileData = {
    id: editingId.value || crypto.randomUUID(),
    name: form.value.name.trim(),
    icon: form.value.iconType === "image" ? form.value.iconImage : form.value.icon,
    iconType: form.value.iconType,
    color: form.value.color,
  };
  if (form.value.iconType === "image" && form.value.iconData) {
    cat.iconData = form.value.iconData;
    cat.iconMime = form.value.iconMime || "image/png";
  }
  emit("save", cat);
  showForm.value = false;
}

function triggerIconUpload(): void {
  iconFileInput.value?.click();
}

function onIconFile(e: Event): void {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const data = reader.result as ArrayBuffer;
    form.value.iconData = data;
    form.value.iconMime = file.type || "image/png";
    form.value.iconImage = URL.createObjectURL(file);
    form.value.iconType = "image";
    form.value.icon = form.value.iconImage;
  };
  reader.readAsArrayBuffer(file);
  input.value = "";
}

function removeCustomIcon(): void {
  if (form.value.iconImage?.startsWith("blob:")) URL.revokeObjectURL(form.value.iconImage);
  form.value.iconData = null;
  form.value.iconMime = "";
  form.value.iconImage = "";
  form.value.iconType = "icon";
  form.value.icon = props.iconOptions[0]?.value || "";
}
</script>

<!-- O conteúdo dos diálogos vai para um portal, mas é compilado AQUI (slot do
     consumidor), então o Vue carimba o atributo de escopo nele e `scoped`
     funciona — inclusive na raiz dos primitivos filhos. -->
<style scoped>
/* ── Diálogo de gerenciamento ─────────────────────────────────────────── */

.cat-toolbar {
  display: flex;
  justify-content: flex-end;
  margin-bottom: var(--lj-space-5);
}

.cat-manage-list {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-3);
}

.cat-manage-item {
  display: flex;
  align-items: center;
  gap: var(--lj-space-5);
  padding: var(--lj-space-4);
  background: var(--lj-surface-bg-soft);
  border: 1px solid var(--lj-surface-border);
  border-radius: var(--lj-radius-md);
}

.cat-manage-item-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: var(--lj-ui-h-lg);
  height: var(--lj-ui-h-lg);
  border-radius: 50%;
  overflow: hidden;
  /* Círculo colorido pelo dado da categoria: o ícone herda o branco fixo. */
  color: var(--lj-white);
}

.cat-manage-item-img {
  width: 18px;
  height: 18px;
  object-fit: contain;
}

.cat-manage-item-name {
  font-size: var(--lj-text-lg);
  font-weight: var(--lj-weight-medium);
}

/* Ação destrutiva discreta: mantém o fantasma do LjButton e só troca a cor.
   O seletor descendente supera a regra `.lj-btn--ghost` do próprio primitivo. */
.cat-manage-item .cat-btn-danger,
.cat-custom-icon-preview .cat-btn-danger {
  color: var(--lj-danger);
}

.cat-manage-item .cat-btn-danger:hover,
.cat-custom-icon-preview .cat-btn-danger:hover {
  background: var(--lj-danger-soft);
  color: var(--lj-danger);
}

/* ── Diálogo de formulário ────────────────────────────────────────────── */

.cat-form-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: var(--lj-space-6);
}

@media (min-width: 600px) {
  .cat-form-grid {
    grid-template-columns: 1fr 1fr;
  }
}

.cat-form-col {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-3);
  min-width: 0;
}

.cat-label {
  color: var(--lj-text-muted);
  font-size: var(--lj-text-base);
  font-weight: var(--lj-weight-medium);
}

.cat-divider {
  margin: var(--lj-space-2) 0;
  border-top: 1px solid var(--lj-surface-divider);
}

.cat-color-swatches,
.cat-icon-grid {
  display: flex;
  flex-wrap: wrap;
  gap: var(--lj-space-2);
}

.cat-color-swatch {
  width: var(--lj-space-8);
  height: var(--lj-space-8);
  padding: 0;
  border: 2px solid transparent;
  border-radius: 50%;
  cursor: pointer;
  transition: transform var(--lj-transition-fast);
}

.cat-color-swatch:hover {
  transform: scale(1.15);
}

.cat-color-swatch--active {
  border-color: var(--lj-ui-accent);
  transform: scale(1.15);
}

.cat-color-swatch:focus-visible {
  outline: none;
  box-shadow: var(--lj-ui-focus);
}

.cat-icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: var(--lj-ui-h-lg);
  height: var(--lj-ui-h-lg);
  padding: 0;
  background: var(--lj-surface-bg-soft);
  border: 1px solid transparent;
  border-radius: var(--lj-ui-radius);
  color: var(--lj-text-muted);
  cursor: pointer;
  transition:
    background var(--lj-transition-fast),
    border-color var(--lj-transition-fast);
}

.cat-icon-btn:hover {
  background: var(--lj-surface-bg-hover);
  color: var(--lj-text);
}

.cat-icon-btn--active {
  background: var(--lj-ui-accent-soft);
  border-color: var(--lj-ui-accent);
  color: var(--lj-ui-accent-text);
}

.cat-icon-btn:focus-visible {
  outline: none;
  box-shadow: var(--lj-ui-focus);
}

.cat-upload-row {
  display: flex;
}

.cat-file-input {
  display: none;
}

.cat-custom-icon-preview {
  position: relative;
  display: inline-block;
  margin-top: var(--lj-space-2);
}

.cat-custom-icon-img {
  display: block;
  width: 40px;
  height: 40px;
  object-fit: contain;
  background: var(--lj-surface-bg-soft);
  border: 1px solid var(--lj-surface-border);
  border-radius: var(--lj-radius-sm);
}

.cat-custom-icon-remove {
  position: absolute;
  top: calc(-1 * var(--lj-space-3));
  right: calc(-1 * var(--lj-space-3));
  background: var(--lj-surface-bg);
  border: 1px solid var(--lj-surface-border);
  border-radius: 50%;
}

/* O rodapé do LjDialog alinha à direita; a exclusão fica isolada à esquerda. */
.cat-footer-left {
  margin-right: auto;
}
</style>
