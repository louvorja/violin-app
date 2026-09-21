<template>
  <ComboboxRoot
    v-model="model"
    v-model:open="open"
    class="lj-combobox"
    :disabled="disabled"
    ignore-filter
    :by="sameItem"
  >
    <ComboboxAnchor
      class="lj-combobox__anchor"
      :class="[`lj-ui-size-${size}`, { 'is-invalid': invalid }]"
    >
      <LjIcon :icon="ICONS.ACTIONS.SEARCH" :size="iconSize" class="lj-combobox__icon" />
      <ComboboxInput
        :id="resolvedId"
        class="lj-combobox__input"
        :placeholder="placeholder ?? t('components.ui.search_placeholder')"
        :display-value="displayValue"
        :aria-label="ariaLabel"
        :aria-describedby="describedBy"
        @input="onInput"
      />
      <ComboboxTrigger class="lj-combobox__trigger">
        <LjIcon :icon="ICONS.UI.CHEVRON_DOWN" :size="iconSize" />
      </ComboboxTrigger>
    </ComboboxAnchor>

    <ComboboxPortal>
      <ComboboxContent
        class="lj-ui-float lj-combobox__content"
        position="popper"
        :side-offset="4"
        :style="{ '--lj-combobox-row': `${ROW_HEIGHT}px` }"
      >
        <ComboboxViewport class="lj-combobox__viewport">
          <div v-if="visible.length === 0" class="lj-combobox__empty">
            {{ emptyText ?? t("components.ui.no_results") }}
          </div>
          <ComboboxVirtualizer
            v-else
            v-slot="{ option }"
            :options="visible"
            :estimate-size="ROW_HEIGHT"
            :text-content="labelOf"
          >
            <ComboboxItem class="lj-combobox__item" :value="option">
              <span class="lj-combobox__check"><LjIcon :icon="ICONS.UI.CHECK" :size="12" /></span>
              <span class="lj-combobox__label">{{ labelOf(option) }}</span>
              <span v-if="detailOf(option)" class="lj-combobox__detail">
                {{ detailOf(option) }}
              </span>
            </ComboboxItem>
          </ComboboxVirtualizer>
        </ComboboxViewport>
      </ComboboxContent>
    </ComboboxPortal>
  </ComboboxRoot>
</template>

<script setup lang="ts">
import { LjIcon } from "@/components/ui";
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  ComboboxAnchor,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
  ComboboxPortal,
  ComboboxRoot,
  ComboboxTrigger,
  ComboboxViewport,
  ComboboxVirtualizer,
} from "reka-ui";
import { ICONS } from "@/config/Icons";
import Strings from "@/helpers/Strings";
import { useFieldContext } from "./fieldContext";
import type { UiSize } from "./types";
import { ICON_SIZE } from "./types";

type Item = string | number | Record<string, unknown>;

const props = withDefaults(
  defineProps<{
    modelValue?: Item | null;
    items?: Item[];
    itemValue?: string;
    itemLabel?: string;
    /**
     * Chave do texto secundário da linha (à direita, esmaecido): o que separa
     * itens de mesmo rótulo. Na regra padrão de busca ele não entra.
     */
    itemDetail?: string;
    /**
     * Regra de busca própria, no lugar do trecho do rótulo. Recebe o termo já
     * normalizado (`Strings.clean`) e roda a cada tecla sobre todos os itens:
     * calcule chaves de busca uma vez por lista, não aqui dentro.
     */
    filter?(item: Item, term: string): boolean;
    size?: UiSize;
    placeholder?: string;
    emptyText?: string;
    disabled?: boolean;
    invalid?: boolean;
    /** Nome acessível quando o combobox não está dentro de um LjField. */
    ariaLabel?: string;
    id?: string;
  }>(),
  {
    items: () => [],
    itemValue: "value",
    itemLabel: "label",
    itemDetail: "detail",
    size: "md",
  }
);

const emit = defineEmits<{ "update:modelValue": [value: Item] }>();

const { t } = useI18n();

// O root do Combobox é uma div sem papel: sem repassar explicitamente, o
// aria-label pousaria nela e o input com role="combobox" ficaria anônimo.
const field = useFieldContext();
const resolvedId = computed(() => props.id ?? field?.inputId.value);
const describedBy = computed(() => field?.describedById.value);
const isInvalid = computed(() => props.invalid || field?.invalid.value || false);

const open = ref(false);

// A lista é virtual: só as linhas visíveis existem no DOM, e o Reka as posiciona
// por altura fixa. Sem isso, cada abertura montava todas as linhas — milhares de
// nós para as ~1900 músicas do formulário de liturgia. O valor é o `--lj-ui-h-md`
// (26px) e chega ao CSS por `--lj-combobox-row`, para a altura da linha e a conta
// do virtualizador não divergirem.
const ROW_HEIGHT = 26;

// O virtualizador desliga o filtro do Reka, então o filtro é nosso: por trecho,
// sem distinguir acento, caixa, espaço nem pontuação — a mesma regra da busca de
// músicas, para o mesmo texto achar o mesmo nos dois seletores ("santo santo"
// acha "Santo, Santo, Santo"). As chaves são normalizadas uma vez por lista, não
// a cada tecla.
const query = ref("");
const entries = computed(() =>
  props.items.map((item) => ({ item, key: Strings.clean(labelOf(item)) }))
);
const visible = computed<Item[]>(() => {
  const term = Strings.clean(query.value);
  if (!term) return props.items;
  const { filter } = props;
  if (filter) return props.items.filter((item) => filter(item, term));
  return entries.value.filter((e) => e.key.includes(term)).map((e) => e.item);
});

// O texto do campo também muda por conta do Reka (mostra o rótulo do escolhido),
// então só o evento `input` — o que a pessoa digitou — vira termo de busca. O
// termo zera ao fechar, não ao abrir: a primeira tecla abre a lista e chega
// antes da abertura, e zerar ali a engoliria.
function onInput(event: Event) {
  query.value = (event.target as HTMLInputElement).value;
}
watch(open, (isOpen) => {
  if (!isOpen) query.value = "";
});

// Compara pelo valor do item, não pela identidade: a lista pode ser recriada
// (troca de idioma, itens novos) enquanto o item escolhido segue sendo o mesmo.
function sameItem(a: Item, b: Item): boolean {
  return valueOf(a) === valueOf(b);
}

const model = computed({
  get: () => props.modelValue ?? undefined,
  set: (value) => emit("update:modelValue", value as Item),
});

const iconSize = computed(() => ICON_SIZE[props.size]);

function valueOf(item: Item): string | number {
  return typeof item === "object" && item !== null
    ? (item[props.itemValue] as string | number)
    : item;
}

function labelOf(item: Item): string {
  return typeof item === "object" && item !== null
    ? String(item[props.itemLabel] ?? "")
    : String(item);
}

function detailOf(item: Item): string {
  return typeof item === "object" && item !== null ? String(item[props.itemDetail] ?? "") : "";
}

function displayValue(item: unknown): string {
  return item ? labelOf(item as Item) : "";
}
</script>

<!-- Sem `scoped`: o conteúdo vai para um portal no <body> e o Vue não propaga
     o atributo de escopo para lá, então regras scoped simplesmente não casariam.
     O isolamento vem do prefixo `lj-` nas classes. -->
<style>
.lj-combobox__anchor {
  display: inline-flex;
  align-items: center;
  box-sizing: border-box;
  width: 100%;
  background: var(--lj-surface-bg);
  border: var(--lj-ui-border);
  border-radius: var(--lj-ui-radius);
  color: var(--lj-text);
  transition:
    border-color var(--lj-transition-fast),
    box-shadow var(--lj-transition-fast);
}

.lj-combobox__anchor:focus-within {
  border-color: var(--lj-ui-accent);
  box-shadow: var(--lj-ui-focus);
}

.lj-combobox__anchor.is-invalid {
  border-color: var(--lj-danger);
}

.lj-combobox__icon {
  color: var(--lj-text-subtle);
  flex-shrink: 0;
}

.lj-combobox__input {
  flex: 1;
  min-width: 0;
  height: 100%;
  padding: 0;
  border: none;
  outline: none;
  background: transparent;
  color: inherit;
  font: inherit;
}

.lj-combobox__input::placeholder {
  color: var(--lj-text-subtle);
}

.lj-combobox__trigger {
  display: inline-flex;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--lj-text-subtle);
  cursor: pointer;
  flex-shrink: 0;
}

.lj-combobox__content {
  min-width: var(--reka-combobox-trigger-width);
  max-height: 280px;
  overflow: hidden;
  z-index: var(--lj-z-popup);
}

.lj-combobox__viewport {
  max-height: 280px;
  overflow: auto;
  padding: var(--lj-space-1);
}

.lj-combobox__item {
  display: flex;
  align-items: center;
  gap: var(--lj-space-2);
  box-sizing: border-box;
  width: 100%;
  height: var(--lj-combobox-row, var(--lj-ui-h-md));
  padding-inline: var(--lj-space-2) var(--lj-space-5);
  border-radius: var(--lj-radius-xs);
  font-size: var(--lj-text-base);
  cursor: pointer;
  outline: none;
}

.lj-combobox__item[data-highlighted] {
  background: var(--lj-surface-bg-hover);
}

/* Altura fixa: rótulo longo trunca em vez de quebrar linha, senão a linha
   cresceria além do que o virtualizador reservou e sobreporia a seguinte. */
.lj-combobox__label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* O detalhe fica à direita e cede espaço antes do rótulo: é o título que a
   pessoa procura, o álbum só desempata. */
.lj-combobox__detail {
  flex: 0 1 auto;
  min-width: 0;
  max-width: 45%;
  margin-left: auto;
  padding-left: var(--lj-space-4);
  overflow: hidden;
  color: var(--lj-text-subtle);
  font-size: var(--lj-text-sm);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lj-combobox__check {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  flex-shrink: 0;
  color: var(--lj-ui-accent-text);
  visibility: hidden;
}

.lj-combobox__item[data-state="checked"] .lj-combobox__check {
  visibility: visible;
}

.lj-combobox__empty {
  padding: var(--lj-space-5);
  color: var(--lj-text-subtle);
  font-size: var(--lj-text-sm);
  text-align: center;
}
</style>
