<template>
  <ContextMenuRoot v-model:open="open">
    <ContextMenuTrigger as-child :disabled="disabled">
      <slot />
    </ContextMenuTrigger>

    <ContextMenuPortal>
      <ContextMenuContent class="lj-ui-float lj-menu">
        <template v-for="(item, index) in items" :key="index">
          <ContextMenuSeparator v-if="item.separator" class="lj-menu__separator" />
          <ContextMenuLabel
            v-else-if="item.label && !item.action && item.checked === undefined"
            class="lj-menu__label"
          >
            {{ item.label }}
          </ContextMenuLabel>
          <ContextMenuCheckboxItem
            v-else-if="item.checked !== undefined"
            class="lj-menu__item"
            :model-value="item.checked"
            :disabled="item.disabled"
            @select="item.action?.()"
          >
            <span class="lj-menu__mark">
              <LjIcon v-if="item.checked" :icon="ICONS.UI.CHECK" :size="12" />
              <LjIcon v-else-if="item.icon" :icon="item.icon" :size="13" />
            </span>
            <span class="lj-menu__text">
              {{ item.label }}
              <small v-if="item.hint" class="lj-menu__hint">{{ item.hint }}</small>
            </span>
            <kbd v-if="item.shortcut" class="lj-menu__kbd">{{ item.shortcut }}</kbd>
          </ContextMenuCheckboxItem>
          <ContextMenuItem
            v-else
            class="lj-menu__item"
            :disabled="item.disabled"
            @select="item.action?.()"
          >
            <span class="lj-menu__mark">
              <LjIcon v-if="item.icon" :icon="item.icon" :size="13" />
            </span>
            <span class="lj-menu__text">
              {{ item.label }}
              <small v-if="item.hint" class="lj-menu__hint">{{ item.hint }}</small>
            </span>
            <kbd v-if="item.shortcut" class="lj-menu__kbd">{{ item.shortcut }}</kbd>
          </ContextMenuItem>
        </template>
      </ContextMenuContent>
    </ContextMenuPortal>
  </ContextMenuRoot>
</template>

<script setup lang="ts">
import { LjIcon } from "@/components/ui";
import { ref } from "vue";
import {
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuPortal,
  ContextMenuRoot,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "reka-ui";
import { ICONS } from "@/config/Icons";
import type { LjMenuItem } from "./LjMenu.vue";
// As classes `lj-menu*` e o estilo delas moram no LjMenu: os dois menus são
// o mesmo desenho, só muda o gatilho (clique direito aqui, botão lá).
import "./LjMenu.vue";

/**
 * Menu de contexto: abre no ponto do clique direito sobre o elemento do slot
 * (ou pela tecla de menu do teclado). Mesma lista de itens do `LjMenu`.
 */
withDefaults(
  defineProps<{
    items?: LjMenuItem[];
    disabled?: boolean;
  }>(),
  { items: () => [], disabled: false }
);

const open = ref(false);
</script>
