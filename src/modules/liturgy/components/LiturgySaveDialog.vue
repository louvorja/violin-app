<template>
  <LjDialog v-model="internalShow" :title="t('library.save_title')" size="sm">
    <LjField layout="column" :label="t('library.save_name_label')" :error="nameError">
      <LjInput
        v-model="name"
        autofocus
        :placeholder="t('library.save_name_placeholder')"
        @keyup.enter="doSave"
      />
    </LjField>

    <template #footer>
      <LjButton variant="ghost" @click="internalShow = false">
        {{ t("actions.cancel") }}
      </LjButton>
      <LjButton
        variant="primary"
        :icon="ICONS.ACTIONS.SAVE"
        :disabled="!name.trim()"
        @click="doSave"
      >
        {{ t("actions.save") }}
      </LjButton>
    </template>
  </LjDialog>
</template>

<script setup lang="ts">
import { useLiturgyI18n } from "../i18n";
import { LjButton, LjDialog, LjField, LjInput } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { ref, watch } from "vue";
import $alert from "@/helpers/Alert";
import $liturgy from "@/helpers/Liturgy";
import { useLiturgyLibrary } from "../composables/useLiturgyLibrary";
import type { LiturgyItem } from "@/types/Liturgy";

const props = defineProps<{
  modelValue: boolean;
  items: LiturgyItem[];
}>();
const emit = defineEmits<{
  (e: "update:modelValue", v: boolean): void;
  (e: "saved"): void;
}>();

const { t } = useLiturgyI18n();

const library = useLiturgyLibrary();
const internalShow = ref(props.modelValue);
watch(
  () => props.modelValue,
  (v) => {
    internalShow.value = v;
  }
);
watch(internalShow, (v) => emit("update:modelValue", v));

const name = ref("");
const nameError = ref("");

watch(internalShow, (v) => {
  if (v) {
    name.value = "";
    nameError.value = "";
    const id = $liturgy.getCurrentLiturgyId();
    if (id) {
      library.get(id).then((item) => {
        if (item) name.value = item.name;
      });
    }
  }
});

async function doSave() {
  const n = name.value.trim();
  if (!n) return;
  nameError.value = "";
  const currentId = $liturgy.getCurrentLiturgyId();
  const existing = await library.getByName(n);
  if (existing && existing.id !== currentId) {
    nameError.value = t("library.name_exists");
    return;
  }
  if (existing && existing.id === currentId) {
    const ok = await new Promise<boolean>((resolve) => {
      $alert.yesno(
        { title: t("library.save_title"), text: t("library.save_overwrite_confirm") },
        (btn?: string) => resolve(btn === "yes")
      );
    });
    if (!ok) return;
  }
  await library.save({
    id: currentId ?? undefined,
    name: n,
    items: props.items,
  });
  if (currentId) {
    $liturgy.setCurrentLiturgyId(currentId);
  } else {
    const saved = await library.getByName(n);
    if (saved) $liturgy.setCurrentLiturgyId(saved.id);
  }
  internalShow.value = false;
  emit("saved");
}
</script>
