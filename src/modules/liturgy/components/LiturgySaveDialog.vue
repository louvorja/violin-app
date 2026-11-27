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
      <LjButton size="sm" variant="ghost" @click="internalShow = false">
        {{ t("actions.cancel") }}
      </LjButton>
      <LjButton
        size="sm"
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
import $alert, { escapeHtml } from "@/helpers/Alert";
import $snackbar from "@/helpers/Snackbar";
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
  try {
    let targetId = currentId ?? undefined;
    if (targetId) {
      const current = await library.get(targetId);
      if (!current) {
        $liturgy.clearLibraryReferences(targetId);
        targetId = undefined;
      }
    }
    const existing = await library.getByName(n);
    if (existing && existing.id !== targetId) {
      nameError.value = t("library.name_exists");
      return;
    }
    if (existing && existing.id === targetId) {
      const ok = await new Promise<boolean>((resolve) => {
        $alert.yesno(
          {
            title: escapeHtml(t("library.save_title")),
            text: escapeHtml(t("library.save_overwrite_confirm")),
            translate: false,
          },
          (btn?: string) => resolve(btn === "yes")
        );
      });
      if (!ok) return;
    }
    const saved = await library.save({
      id: targetId,
      name: n,
      items: props.items,
    });
    $liturgy.setCurrentLiturgyId(saved.id);
    internalShow.value = false;
    emit("saved");
  } catch (error) {
    console.error("[Liturgia] save dialog falhou:", error);
    $snackbar.error(t("library.save_error"));
  }
}
</script>
