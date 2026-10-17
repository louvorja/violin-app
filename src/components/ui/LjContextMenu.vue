<template>
  <ContextMenuRoot v-model:open="open">
    <ContextMenuTrigger as-child :disabled="disabled">
      <slot />
    </ContextMenuTrigger>

    <ContextMenuPortal>
      <ContextMenuContent class="lj-ui-float lj-menu">
        <!-- Ações rápidas: as mais usadas, com ícone grande, numa linha no topo. -->
        <div v-if="quick.length" class="lj-menu__quick">
          <ContextMenuItem
            v-for="(item, index) in quick"
            :key="`q${index}`"
            class="lj-menu__quick-item"
            :disabled="item.disabled"
            @select="item.action?.()"
          >
            <LjIcon v-if="item.icon" :icon="item.icon" :size="18" />
            <span>{{ item.label }}</span>
          </ContextMenuItem>
        </div>
        <ContextMenuSeparator v-if="quick.length && items.length" class="lj-menu__separator" />
        <template v-for="(item, index) in items" :key="index">
          <ContextMenuSeparator v-if="item.separator" class="lj-menu__separator" />
          <!-- Lista que cresce (momentos, coletâneas…) vai para o segundo nível. -->
          <ContextMenuSub v-else-if="item.children">
            <ContextMenuSubTrigger class="lj-menu__item" :disabled="item.disabled">
              <span class="lj-menu__mark">
                <LjIcon v-if="item.icon" :icon="item.icon" :size="13" />
              </span>
              <span class="lj-menu__text">{{ item.label }}</span>
              <LjIcon :icon="ICONS.UI.CHEVRON_RIGHT" :size="13" class="lj-menu__sub-arrow" />
            </ContextMenuSubTrigger>
            <ContextMenuPortal>
              <ContextMenuSubContent class="lj-ui-float lj-menu" :side-offset="4">
                <template v-for="(child, childIndex) in item.children" :key="childIndex">
                  <ContextMenuSeparator v-if="child.separator" class="lj-menu__separator" />
                  <ContextMenuItem
                    v-else
                    class="lj-menu__item"
                    :disabled="child.disabled"
                    @select="child.action?.()"
                  >
                    <span class="lj-menu__mark">
                      <LjIcon v-if="child.icon" :icon="child.icon" :size="13" />
                    </span>
                    <span class="lj-menu__text">
                      {{ child.label }}
                      <small v-if="child.hint" class="lj-menu__hint">{{ child.hint }}</small>
                    </span>
                  </ContextMenuItem>
                </template>
              </ContextMenuSubContent>
            </ContextMenuPortal>
          </ContextMenuSub>
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
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "reka-ui";
import { ICONS } from "@/config/Icons";
import type { LjMenuItem } from "./LjMenu.vue";
// As classes `lj-menu*` e o estilo delas moram no LjMenu: os dois menus são
// o mesmo desenho, só muda o gatilho (clique direito aqui, botão lá).
import "./LjMenu.vue";

/**
 * Menu de contexto: abre no ponto do clique direito sobre o elemento do slot
 * (ou pela tecla de menu do teclado). Mesma lista de itens do `LjMenu`, mais:
 *
 * - `quick`: as ações mais usadas numa linha no topo, com ícone grande
 *   (como no FreeShow) — o operador acerta sem ler a lista.
 * - `children` num item: um submenu, para a lista que cresce com os dados
 *   do usuário e deixaria o menu comprido demais.
 */
withDefaults(
  defineProps<{
    items?: LjMenuItem[];
    quick?: LjMenuItem[];
    disabled?: boolean;
  }>(),
  { items: () => [], quick: () => [], disabled: false }
);

const open = ref(false);
</script>
