<template>
  <DropdownMenuRoot v-model:open="open">
    <DropdownMenuTrigger as-child>
      <slot name="trigger" />
    </DropdownMenuTrigger>

    <DropdownMenuPortal>
      <DropdownMenuContent class="lj-ui-float lj-menu" :side="side" :align="align" :side-offset="4">
        <template v-for="(item, index) in items" :key="index">
          <DropdownMenuSeparator v-if="item.separator" class="lj-menu__separator" />
          <DropdownMenuLabel
            v-else-if="item.label && !item.action && item.checked === undefined"
            class="lj-menu__label"
          >
            {{ item.label }}
          </DropdownMenuLabel>
          <!-- Item marcável usa CheckboxItem: só ele expõe role="menuitemcheckbox"
               e aria-checked, sem os quais a seleção não existe para leitor de tela. -->
          <DropdownMenuCheckboxItem
            v-else-if="item.checked !== undefined"
            class="lj-menu__item"
            :model-value="item.checked"
            :disabled="item.disabled"
            @select="item.action?.()"
          >
            <span class="lj-menu__mark">
              <Icon v-if="item.checked" :icon="ICONS.UI.CHECK" :size="12" />
              <Icon v-else-if="item.icon" :icon="item.icon" :size="13" />
            </span>
            <span class="lj-menu__text">
              {{ item.label }}
              <small v-if="item.hint" class="lj-menu__hint">{{ item.hint }}</small>
            </span>
            <kbd v-if="item.shortcut" class="lj-menu__kbd">{{ item.shortcut }}</kbd>
          </DropdownMenuCheckboxItem>
          <DropdownMenuItem
            v-else
            class="lj-menu__item"
            :disabled="item.disabled"
            @select="item.action?.()"
          >
            <span class="lj-menu__mark">
              <Icon v-if="item.icon" :icon="item.icon" :size="13" />
            </span>
            <span class="lj-menu__text">
              {{ item.label }}
              <small v-if="item.hint" class="lj-menu__hint">{{ item.hint }}</small>
            </span>
            <kbd v-if="item.shortcut" class="lj-menu__kbd">{{ item.shortcut }}</kbd>
          </DropdownMenuItem>
        </template>
        <slot />
      </DropdownMenuContent>
    </DropdownMenuPortal>
  </DropdownMenuRoot>
</template>

<script setup lang="ts">
import { ref } from "vue";
import {
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "reka-ui";
import Icon from "@/components/Icon.vue";
import { ICONS } from "@/config/Icons";

export interface LjMenuItem {
  label?: string;
  icon?: string;
  hint?: string;
  shortcut?: string;
  checked?: boolean;
  disabled?: boolean;
  separator?: boolean;
  action?: () => void;
}

withDefaults(
  defineProps<{
    items?: LjMenuItem[];
    side?: "top" | "right" | "bottom" | "left";
    align?: "start" | "center" | "end";
  }>(),
  { items: () => [], side: "bottom", align: "start" }
);

const open = ref(false);
</script>

<!-- Sem `scoped`: o conteúdo vai para um portal no <body> e o Vue não propaga
     o atributo de escopo para lá, então regras scoped simplesmente não casariam.
     O isolamento vem do prefixo `lj-` nas classes. -->
<style>
.lj-menu {
  min-width: 180px;
  max-width: 320px;
  /* Um menu que lista dados do usuário (músicas, coletâneas) cresce sem limite
     e passava da viewport. A variável é publicada pelo Reka com o espaço real
     disponível abaixo do gatilho. */
  max-height: min(400px, var(--reka-dropdown-menu-content-available-height, 400px));
  overflow-y: auto;
  padding: var(--lj-space-1);
  z-index: var(--lj-z-popup);
  color: var(--lj-text);
  font-family: var(--lj-font-shell);
  font-size: var(--lj-text-base);
}

.lj-menu__item {
  display: flex;
  align-items: center;
  gap: var(--lj-space-3);
  min-height: var(--lj-ui-h-md);
  padding: var(--lj-space-1) var(--lj-space-4) var(--lj-space-1) var(--lj-space-2);
  border-radius: var(--lj-radius-xs);
  cursor: pointer;
  outline: none;
  user-select: none;
}

.lj-menu__item[data-highlighted] {
  background: var(--lj-surface-bg-hover);
}

.lj-menu__item[data-disabled] {
  opacity: var(--lj-ui-disabled-opacity);
  pointer-events: none;
}

/* Calha fixa para ícone ou marca de seleção — mantém os rótulos alinhados
   mesmo quando só alguns itens têm ícone. */
.lj-menu__mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  flex-shrink: 0;
  color: var(--lj-text-muted);
}

.lj-menu__text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.lj-menu__hint {
  color: var(--lj-text-subtle);
  font-size: var(--lj-text-xs);
}

.lj-menu__kbd {
  flex-shrink: 0;
  padding: 0 var(--lj-space-2);
  background: var(--lj-kbd-bg, var(--lj-surface-bg-active));
  border: 1px solid var(--lj-kbd-border, var(--lj-surface-border));
  border-radius: var(--lj-radius-xs);
  color: var(--lj-text-subtle);
  font-family: var(--lj-font-mono);
  font-size: var(--lj-text-xs);
}

.lj-menu__label {
  padding: var(--lj-space-2) var(--lj-space-4);
  color: var(--lj-text-subtle);
  font-size: var(--lj-text-xs);
  font-weight: var(--lj-weight-semibold);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.lj-menu__separator {
  height: 1px;
  margin: var(--lj-space-1) 0;
  background: var(--lj-surface-divider);
}
</style>
