<template>
  <LjDialog :model-value="true" :title="t('options.storage.setup_title')" persistent size="md">
    <StorageLocations setup @complete="emit('complete')" />
  </LjDialog>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { LjDialog } from "@/components/ui";
import StorageLocations from "@/components/StorageLocations.vue";

const { t } = useI18n();
const emit = defineEmits<{ complete: [] }>();
</script>
