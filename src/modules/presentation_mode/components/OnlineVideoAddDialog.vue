<template>
  <LjDialog
    v-model="open"
    :title="tm('library.online_add_title')"
    :icon="ICONS.MEDIA.YOUTUBE"
    size="md"
  >
    <div class="pm-ovl-add" data-testid="pm-ovl-add-dialog">
      <LjField layout="column" :label="tm('library.online_add_url')">
        <LjInput
          v-model="url"
          :icon="ICONS.UI.LINK"
          :placeholder="tm('library.online_add_url_placeholder')"
          clearable
          data-testid="pm-ovl-add-url"
        />
      </LjField>
      <LjField layout="column" :label="tm('library.online_add_name')">
        <LjInput v-model="name" :placeholder="tm('library.online_add_name_placeholder')" />
      </LjField>
      <LjField layout="column" :label="tm('library.online_add_category')">
        <LjSelect v-model="categoryId" :items="categoryItems" item-label="title" />
      </LjField>
    </div>

    <template #footer>
      <LjButton :disabled="saving" @click="open = false">
        {{ tm("library.online_add_cancel") }}
      </LjButton>
      <LjButton
        variant="primary"
        :loading="saving"
        :disabled="!canSave || saving"
        data-testid="pm-ovl-add-save"
        @click="submit"
      >
        {{ tm("library.online_add_save") }}
      </LjButton>
    </template>
  </LjDialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { LjButton, LjDialog, LjField, LjInput, LjSelect } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { ModuleEnum } from "@/enums/ModuleEnum";
import { useModuleI18n } from "@/composables/useModuleI18n";

const props = defineProps<{
  modelValue: boolean;
  categories: { id: string; name: string }[];
  defaultCategoryId?: string;
  saving?: boolean;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  save: [payload: { url: string; name: string; categoryId: string }];
}>();

const { tm } = useModuleI18n(ModuleEnum.PRESENTATION_MODE);
const url = ref("");
const name = ref("");
const categoryId = ref("");

const open = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit("update:modelValue", value),
});

const categoryItems = computed(() => [
  { title: tm("library.online_uncategorized"), value: "" },
  ...props.categories.map((category) => ({ title: category.name, value: category.id })),
]);

const canSave = computed(() => url.value.trim().length > 0);

watch(
  () => props.modelValue,
  (value) => {
    if (!value) return;
    url.value = "";
    name.value = "";
    categoryId.value = props.defaultCategoryId || "";
  }
);

function submit(): void {
  if (!canSave.value || props.saving) return;
  emit("save", {
    url: url.value.trim(),
    name: name.value.trim(),
    categoryId: categoryId.value,
  });
}
</script>

<style scoped>
.pm-ovl-add {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-3);
}
</style>
