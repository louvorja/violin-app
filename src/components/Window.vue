<template>
  <DialogRoot v-model:open="visible">
    <DialogPortal>
      <DialogOverlay class="lj-window__scrim" />
      <DialogContent
        class="lj-window"
        :style="{ width: w_width, height: w_height }"
        :data-theme="dark ? 'dark' : undefined"
        v-bind="ariaSemOrfa"
        @open-auto-focus="onOpenAutoFocus"
        @escape-key-down="onEscapeKeyDown"
        @pointer-down-outside="onPointerDownOutside"
      >
        <div class="lj-window-card" :style="color ? { background: color } : undefined">
          <slot name="toolbar">
            <header class="lj-window-toolbar">
              <div v-if="icon" class="lj-window-icon">
                <Icon :icon="icon" size="20" />
              </div>
              <div
                v-if="image && viewport.width.value > 500"
                class="lj-window-image"
                :style="{ width: (imageSize || 65) + 'px', height: (imageSize || 65) + 'px' }"
              >
                <img :src="image" alt="" loading="lazy" />
              </div>
              <div class="lj-window-titles">
                <DialogTitle v-if="title" as-child>
                  <h2 class="lj-window-title">{{ title }}</h2>
                </DialogTitle>
                <p v-if="subtitle" class="lj-window-subtitle">{{ subtitle }}</p>
              </div>
              <div class="lj-window-actions">
                <slot name="system_buttons" />

                <span v-if="$slots.system_buttons" class="lj-window-divider" />

                <button
                  v-if="minimizable"
                  type="button"
                  class="lj-window-btn"
                  :title="$t('shell.window.minimize')"
                  @click="minimize()"
                >
                  <Icon :icon="ICONS.ACTIONS.MINUS" size="16" />
                </button>
                <button
                  v-if="closable"
                  type="button"
                  class="lj-window-btn lj-window-btn--close"
                  :title="$t('alert.close')"
                  @click="close()"
                >
                  <Icon :icon="ICONS.ACTIONS.CLOSE" size="16" />
                </button>
              </div>
            </header>
          </slot>

          <div v-if="$slots.header" class="lj-window-header">
            <slot name="header" />
          </div>

          <div ref="container" class="lj-window-body">
            <div
              v-if="$slots.left"
              :style="`height:${container_height}px;${slotLeftStyle};`"
              :class="slotLeftClass"
            >
              <slot name="left" />
            </div>
            <div
              ref="main_container"
              class="lj-window-main"
              :class="{ 'lj-window-main--compact': compact }"
              @scroll="scroll"
            >
              <slot />
            </div>
            <div
              v-if="$slots.right"
              :style="`height:${container_height}px;${slotRightStyle};`"
              :class="slotRightClass"
            >
              <slot name="right" />
            </div>
          </div>

          <div
            v-if="$slots.footer"
            class="lj-window-footer"
            :class="{ 'lj-window-footer--compact': compact_footer }"
          >
            <slot name="footer" />
          </div>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<script setup>
import Icon from "@/components/Icon.vue";
import { ICONS } from "@/config/Icons";
import { ref, computed, watch, onMounted, useSlots } from "vue";
import { DialogContent, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from "reka-ui";
import { useViewport } from "@/composables/useViewport";

const props = defineProps({
  modelValue: {
    type: Boolean,
    default: false,
  },
  title: String,
  subtitle: String,
  icon: String,
  image: String,
  compact: Boolean,
  compact_footer: Boolean,
  closable: Boolean,
  minimizable: Boolean,
  dark: Boolean,
  index: [Boolean, Number, String],
  size: String,
  imageSize: Number,
  color: String,
  slotLeftClass: String,
  slotRightClass: String,
  slotLeftStyle: [String, Object],
  slotRightStyle: [String, Object],
});

const emit = defineEmits([
  "update:modelValue",
  "close",
  "minimize",
  "scroll",
  "hasScroll",
  "resize",
]);

const viewport = useViewport();
const slots = useSlots();
const container = ref(null);
const main_container = ref(null);
const container_height = ref(0);
let resizeObserver = null;

const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit("update:modelValue", value),
});

// A Reka aponta aria-labelledby e aria-describedby para ids que ela reserva,
// existam ou não os elementos. Id órfão faz o leitor de tela anunciar a janela
// sem nome nenhum. Descrição a janela nunca tem; título, só quando a barra de
// título é a nossa e há texto nela.
const ariaSemOrfa = computed(() =>
  props.title && !slots.toolbar
    ? { "aria-describedby": undefined }
    : { "aria-describedby": undefined, "aria-labelledby": undefined }
);

const compact_screen = computed(() => viewport.width.value <= 600);
const compact_height = computed(() => viewport.height.value <= 600);

const w_width = computed(() => {
  if (compact_screen.value) return "100%";
  if (props.size == "small") return "500px";
  if (props.size == "large") return "95%";
  return "90%";
});

const w_height = computed(() => {
  if (compact_screen.value || compact_height.value) return "100%";
  if (props.size == "small") return "550px";
  return "90%";
});

watch(visible, (val) => listenerResize(val));

watch(
  () => props.index,
  () => {
    checkScroll();
    windowResize();
  }
);

onMounted(() => {
  // ResizeObserver dispara em layout changes — atualiza height E scroll
  // (antes só chamava checkScroll, deixando container_height em 0 quando
  // o diálogo abria com layout async, resultando em #left/#right invisíveis
  // e o body do Window aparecendo vazio/preto).
  resizeObserver = new ResizeObserver(() => {
    windowResize();
    checkScroll();
  });
  if (visible.value) listenerResize(true);
});

function close() {
  emit("close");
}

function minimize() {
  emit("minimize");
}

// ESC sempre fecha quando o módulo é fechável (padronização UX).
// Cai em minimize só quando não há close disponível.
function onEsc() {
  if (props.closable) emit("close");
  else if (props.minimizable) emit("minimize");
}

// A janela é persistente: quem decide o que ESC e o clique fora fazem é o
// módulo dono, não a Reka. Sem barrar o dispensar padrão, ela fecharia por
// conta própria e o `close`/`minimize` do módulo nunca rodaria.
function onEscapeKeyDown(event) {
  event.preventDefault();
  onEsc();
}

function onPointerDownOutside(event) {
  event.preventDefault();
  minimize();
}

// Mesmo acordo do LjDialog: focar o primeiro controle abriria a janela com um
// campo já selecionado. O contêiner recebe o foco e o Tab segue dali.
function onOpenAutoFocus(event) {
  event.preventDefault();
  event.currentTarget?.focus?.();
}

function scroll() {
  const el = main_container.value;
  emit("scroll", {
    scroll_top: el.scrollTop,
    client_height: el.clientHeight,
    scroll_height: el.scrollHeight,
    scroll_bottom: el.scrollHeight - el.scrollTop - el.clientHeight,
  });
}

function checkScroll() {
  const el = main_container.value;
  emit("hasScroll", el ? el.scrollHeight > el.clientHeight : false);
}

function windowResize() {
  const el = container.value;
  if (!el) return;
  container_height.value = el.clientHeight;
  emit("resize", {
    container_width: el.clientWidth,
    container_height: el.clientHeight,
  });
}

function listenerResize(active) {
  if (active && visible.value) {
    if (container.value) {
      resizeObserver.observe(container.value);
      window.addEventListener("resize", windowResize);
      windowResize();
    } else {
      setTimeout(() => {
        listenerResize(active);
        checkScroll();
      }, 10);
    }
  } else {
    resizeObserver?.disconnect();
    window.removeEventListener("resize", windowResize);
  }
}
</script>

<!-- Sem `scoped`: a janela vai para um portal no <body> e o Vue não carimba o
     atributo de escopo lá. O isolamento vem do prefixo `lj-window`. -->
<style>
.lj-window__scrim {
  position: fixed;
  inset: 0;
  z-index: var(--lj-z-dialog);
  background: var(--lj-black-alpha-40);
}

.lj-window {
  position: fixed;
  top: 50%;
  left: 50%;
  z-index: calc(var(--lj-z-dialog) + 1);
  display: flex;
  flex-direction: column;
  min-height: 0;
  transform: translate(-50%, -50%);
  /* A margem de 24px que a janela sempre teve em volta, virada em teto de
     tamanho: a largura e a altura em % vêm por style inline. */
  max-width: calc(100% - var(--lj-space-8) * 2);
  max-height: calc(100% - var(--lj-space-8) * 2);
  outline: none;
}

.lj-window-card {
  display: flex;
  flex: 1 1 100%;
  flex-direction: column;
  max-width: 100%;
  max-height: 100%;
  background: var(--lj-surface-bg);
  color: var(--lj-text);
  font-family: var(--lj-font-shell);
  border-radius: var(--lj-radius-md);
  box-shadow: var(--lj-shadow-3);
  overflow: hidden;
}

.lj-window-toolbar {
  display: flex;
  align-items: center;
  gap: var(--lj-space-3);
  padding: var(--lj-space-3) var(--lj-space-4);
  background: var(--lj-surface-bg-soft);
  border-bottom: 1px solid var(--lj-surface-divider);
  min-height: 85px;
}

.lj-window-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: var(--lj-navy);
}

.lj-window-image {
  flex-shrink: 0;
  border-radius: var(--lj-radius-sm);
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--lj-surface-bg);
}

.lj-window-image img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.lj-window-titles {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.lj-window-title {
  margin: 0;
  font-size: var(--lj-text-xl);
  font-weight: var(--lj-weight-regular);
  color: var(--lj-text);
  letter-spacing: -0.01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.2;
}

.lj-window-subtitle {
  margin: 2px 0 0;
  font-size: var(--lj-text-base);
  color: var(--lj-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.lj-window-actions {
  display: flex;
  align-self: flex-start;
  align-items: center;
  gap: var(--lj-space-1);
  flex-shrink: 0;
}

.lj-window-divider {
  width: 1px;
  height: 24px;
  background: var(--lj-surface-border);
  margin: 0 var(--lj-space-2);
}

.lj-window-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  background: transparent;
  border: none;
  border-radius: var(--lj-radius-sm);
  color: var(--lj-text-muted);
  cursor: pointer;
  transition:
    background var(--lj-transition-fast),
    color var(--lj-transition-fast);
  font-family: inherit;
}

.lj-window-btn:hover {
  background: var(--lj-hover-bg);
  color: var(--lj-text);
}

.lj-window-btn--close {
  background: var(--lj-danger);
  color: var(--lj-white);
}
.lj-window-btn--close:hover {
  background: var(--lj-danger-dark);
  color: var(--lj-white);
}

.lj-window-header {
  flex: none;
  padding: var(--lj-space-4) var(--lj-space-6);
  font-size: var(--lj-text-2xl);
  line-height: 1.27;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

/* O corpo não rola: quem rola é a coluna do meio, para as colunas laterais
   ficarem paradas junto com o cabeçalho. */
.lj-window-body {
  display: flex;
  align-items: stretch;
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
}

.lj-window-main {
  flex-grow: 1;
  overflow: auto;
  padding: var(--lj-space-7);
}

.lj-window-main--compact {
  padding: 0;
}

.lj-window-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex: none;
  min-height: 52px;
  gap: var(--lj-space-4);
  padding: var(--lj-space-4);
}

.lj-window-footer--compact {
  padding: 0;
}

.lj-window[data-state="open"] {
  animation: lj-window-in var(--lj-ui-float-enter);
}

.lj-window__scrim[data-state="open"] {
  animation: lj-window-fade var(--lj-ui-float-enter);
}

@keyframes lj-window-fade {
  from {
    opacity: 0;
  }
}

@keyframes lj-window-in {
  from {
    opacity: 0;
    transform: translate(-50%, calc(-50% + var(--lj-ui-float-shift))) scale(0.97);
  }
}

@media (prefers-reduced-motion: reduce) {
  .lj-window[data-state],
  .lj-window__scrim[data-state] {
    animation: none;
  }
}
</style>
