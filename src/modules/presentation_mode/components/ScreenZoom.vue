<template>
  <Teleport to="body">
    <div
      class="pm-screen-zoom"
      role="dialog"
      aria-modal="true"
      :aria-label="title"
      data-testid="pm-screen-zoom"
      @click.self="emit('close')"
    >
      <div class="pm-screen-zoom__frame">
        <slot />
      </div>
      <button
        type="button"
        class="pm-screen-zoom__close"
        :title="t('actions.close')"
        :aria-label="t('actions.close')"
        data-testid="pm-screen-zoom-close"
        @click="emit('close')"
      >
        <LjIcon :icon="ICONS.ACTIONS.CLOSE" :size="16" />
      </button>
      <span class="pm-screen-zoom__title">{{ title }}</span>
      <dl v-if="size" class="pm-screen-zoom__info">
        <dt>{{ tm("zoom.width") }}</dt>
        <dd>{{ size.width }} px</dd>
        <dt>{{ tm("zoom.height") }}</dt>
        <dd>{{ size.height }} px</dd>
        <dt>{{ tm("zoom.ratio") }}</dt>
        <dd>{{ ratio }}</dd>
      </dl>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from "vue";
import { LjIcon } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { ModuleEnum } from "@/enums/ModuleEnum";
import Hotkeys from "@/helpers/Hotkeys";
import { useModuleI18n } from "@/composables/useModuleI18n";

/**
 * A miniatura de uma tela em tamanho cheio, como no FreeShow: o operador vê
 * de perto o que está no telão ou no retorno. Fecha no X, no Esc ou clicando
 * fora. Com o monitor conhecido, mostra a resolução dele.
 */

const props = defineProps<{ title: string; size?: { width: number; height: number } | null }>();
const emit = defineEmits<{ close: [] }>();

const { t, tm } = useModuleI18n(ModuleEnum.PRESENTATION_MODE);

const ratio = computed(() => {
  if (!props.size) return "";
  const r = props.size.width / props.size.height;
  return `${r.toFixed(2)}${Math.abs(r - 16 / 9) < 0.01 ? " (16:9)" : Math.abs(r - 4 / 3) < 0.01 ? " (4:3)" : ""}`;
});

// No módulo, o Esc tira o conteúdo do ar. Com a tela cheia aberta, ele só a
// fecha: o atalho registrado por último é o que vale.
const close = () => emit("close");
onMounted(() =>
  Hotkeys.register("Escape", close, {
    context: "global",
    description: "modules.presentation_mode.zoom.close",
  })
);
onBeforeUnmount(() => Hotkeys.unregister("Escape", close));
</script>

<style>
/* Sem `scoped`: o conteúdo é teleportado para o <body>. Retoma o ponteiro,
   que um diálogo modal da Reka aberto por baixo teria tirado do <body>. */
.pm-screen-zoom {
  position: fixed;
  inset: 0;
  z-index: var(--lj-z-popup);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: var(--lj-black-alpha-75);
  pointer-events: auto;
}

.pm-screen-zoom__frame {
  width: min(calc(100vw - 48px), calc((100vh - 48px) * 16 / 9));
}

.pm-screen-zoom__close {
  position: absolute;
  top: 12px;
  right: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: 1px solid var(--lj-white-alpha-25);
  border-radius: var(--lj-radius-sm);
  background: var(--lj-black-alpha-75);
  color: var(--lj-white);
  cursor: pointer;
}

.pm-screen-zoom__close:hover {
  background: var(--lj-danger);
}

.pm-screen-zoom__title {
  position: absolute;
  top: 18px;
  left: 24px;
  color: var(--lj-white);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.6px;
  text-transform: uppercase;
}

.pm-screen-zoom__info {
  position: absolute;
  right: 12px;
  bottom: 12px;
  display: grid;
  grid-template-columns: auto auto;
  gap: 2px 16px;
  margin: 0;
  padding: 8px 10px;
  border-radius: var(--lj-radius-sm);
  background: var(--lj-black-alpha-75);
  color: var(--lj-white);
  font-size: 11px;
}

.pm-screen-zoom__info dt {
  font-weight: 700;
}

.pm-screen-zoom__info dd {
  margin: 0;
  text-align: right;
}
</style>
