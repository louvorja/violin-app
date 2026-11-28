<template>
  <button
    type="button"
    class="pm-native-src__group"
    :aria-expanded="expanded"
    @click="expanded = !expanded"
  >
    <LjIcon :icon="expanded ? ICONS.UI.CHEVRON_UP : ICONS.UI.CHEVRON_RIGHT" :size="10" />
    {{ tm("library.media_library_section") }}
  </button>

  <div class="pm-collapse" :class="{ 'pm-collapse--open': expanded }" :inert="!expanded">
    <div class="pm-collapse__inner">
      <div class="pm-native-src__list">
        <CategoryListItem
          category-id="*"
          :name="tm('library.media_library_all')"
          :icon="ICONS.MODULES.MEDIA_LIBRARY"
          icon-type="icon"
          color="var(--lj-orange)"
          :count="native.countOf(ALL)"
          :active="active && native.filter.value === ALL"
          :show-menu="false"
          data-testid="pm-native-src-all"
          @select="select(ALL)"
        />
        <CategoryListItem
          v-for="category in native.categories.value"
          :key="category.id"
          :category-id="category.id"
          :name="category.name"
          :icon="categoryIcon(category)"
          :icon-type="categoryIconType(category)"
          :color="category.color || 'var(--lj-orange)'"
          :count="native.countOf(category.id)"
          :active="active && native.filter.value === category.id"
          :show-menu="false"
          :data-testid="`pm-native-src-category-${category.id}`"
          @select="select(category.id)"
        />
        <CategoryListItem
          category-id=""
          :name="t('shell.category.uncategorized')"
          :icon="ICONS.UI.FOLDER_OPEN"
          icon-type="icon"
          color="var(--lj-orange)"
          :count="native.countOf('')"
          :active="active && native.filter.value === ''"
          :show-menu="false"
          data-testid="pm-native-src-uncategorized"
          @select="select('')"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import CategoryListItem from "./CategoryListItem.vue";
import { LjIcon } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { ModuleEnum } from "@/enums/ModuleEnum";
import { useModuleI18n } from "@/composables/useModuleI18n";
import {
  ALL,
  useNativeMediaLibrary,
  type NativeMediaCategory,
} from "../composables/useNativeMediaLibrary";

/**
 * O grupo "Biblioteca de mídia" da lateral da aba Mídia: as mesmas categorias
 * do módulo, com Todas e Sem categoria. Selecionar uma delas troca a grade de
 * arquivos pela grade da Biblioteca, que fica na área de itens.
 */

withDefaults(defineProps<{ active?: boolean }>(), { active: false });
const emit = defineEmits<{ select: [categoryId: string] }>();

const { t, tm } = useModuleI18n(ModuleEnum.PRESENTATION_MODE);
const native = useNativeMediaLibrary();
const expanded = ref(true);

function select(categoryId: string): void {
  native.filter.value = categoryId;
  emit("select", categoryId);
}

function categoryIcon(category: NativeMediaCategory): string {
  const image = native.categoryImageOf(category);
  if (image) return image;
  return category.iconType === "image" ? ICONS.MEDIA.IMAGE : category.icon || ICONS.UI.FOLDER;
}

function categoryIconType(category: NativeMediaCategory): "icon" | "image" {
  return native.categoryImageOf(category) ? "image" : "icon";
}

onMounted(() => {
  if (native.supported) void native.load();
});
onBeforeUnmount(() => native.disposeCategoryIcons());
</script>

<style scoped>
.pm-native-src__group {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  padding: 8px 9px 3px 12px;
  border: none;
  background: transparent;
  color: var(--lj-text-subtle);
  font: inherit;
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.5px;
  text-align: left;
  text-transform: uppercase;
  cursor: pointer;
}

.pm-native-src__list {
  display: flex;
  flex-direction: column;
}

.pm-collapse {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 180ms var(--lj-ease);
}

.pm-collapse--open {
  grid-template-rows: 1fr;
}

.pm-collapse__inner {
  min-height: 0;
  overflow: hidden;
}
</style>
