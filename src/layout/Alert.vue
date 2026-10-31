<template>
  <Teleport to="body">
    <Transition name="alert">
      <div v-if="show" class="alert-overlay">
        <div
          ref="box"
          class="alert"
          :class="`alert--${variant}`"
          role="alertdialog"
          aria-modal="true"
          tabindex="-1"
        >
          <header v-if="alert.title" class="alert-header">
            <LjIcon :icon="iconForVariant" size="20" class="alert-header-icon" />
            <h3 class="alert-title">
              <span v-if="alert.translate" v-html="$t(alert.title)" />
              <span v-else v-html="alert.title" />
            </h3>
          </header>

          <div v-if="alert.text" class="alert-body">
            <p class="alert-text">
              <span v-if="alert.translate" v-html="$t(alert.text)" />
              <span v-else v-html="alert.text" />
            </p>
            <details v-if="alert.error" class="alert-details">
              <summary>{{ $t("alert.technical_details") }}</summary>
              <small class="alert-error" v-html="alert.error" />
            </details>
          </div>

          <div v-if="alert.prompt" class="alert-body alert-body--input">
            <input
              v-model="promptValue"
              type="text"
              class="alert-input"
              :placeholder="alert.input_placeholder || ''"
              @keydown.enter="clickBtn('ok')"
            />
          </div>

          <footer class="alert-actions">
            <button
              v-for="(btn, index) in alert.buttons"
              :key="index"
              type="button"
              class="alert-btn"
              :class="[
                `alert-btn--${btn.color || 'default'}`,
                { 'alert-btn--picked': picked === index },
              ]"
              :data-alert-btn="index"
              @click="clickBtn(btn.value)"
            >
              {{ $t(btn.text) }}
            </button>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { LjIcon } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import $appdata from "@/helpers/AppData";

const alert = computed(() => $appdata.get("alert"));

const show = computed(() => alert.value?.show === true);

const box = ref(null);

// O foco tem de entrar na caixa assim que ela abre: no prompt, o campo é o
// primeiro elemento e sem isso o usuário não consegue digitar sem clicar antes.
// Sem campo, o foco fica na própria caixa e NÃO no primeiro botão: um alerta de
// confirmação abriria com a ação já armada, e um Enter reflexo a dispararia.
watch(show, (visible) => {
  if (!visible) return;
  nextTick(() => {
    const caixa = box.value;
    (caixa?.querySelector("input, textarea") ?? caixa)?.focus();
  });
});

const promptValue = computed({
  get: () => alert.value?.input_value ?? alert.value?.input_default ?? "",
  set: (v) => $appdata.set("alert.input_value", v),
});

const variant = computed(() => alert.value?.color || "info");

const iconForVariant = computed(() => {
  const map = {
    error: ICONS.UI.ALERT_CIRCLE,
    success: ICONS.UI.CHECK_CIRCLE,
    warning: ICONS.UI.ALERT,
    info: ICONS.UI.INFO_SOLID,
  };
  return map[variant.value] || ICONS.UI.INFORMATION_OUTLINE;
});

/*
 * Teclado na pergunta, como no LouvorJA clássico: as setas (e o Tab) andam
 * entre os botões, o Enter confirma o botão marcado e o Esc fica com a
 * primeira opção ("Não"). Sem botão marcado, o Enter não faz nada. Só abre com
 * um marcado a pergunta que declara `default_button` — as de encerrar o que
 * está no telão, onde Esc e depois Enter fecham o hino. Excluir, limpar ou
 * sair nunca abrem armadas.
 *
 * O ouvinte fica na window (captura), e não na caixa: o player é um diálogo da
 * Reka que prende o foco dentro dele, então a pergunta — teleportada para fora —
 * nunca recebe as teclas. Os atalhos globais (Hotkeys) saem da frente enquanto
 * ela está aberta; aqui a tecla é consumida para não chegar ao player.
 */
const picked = ref(-1);

function onKeydown(event) {
  if (!show.value) return;
  const buttons = alert.value?.buttons ?? [];
  if (!buttons.length) return;
  const consume = () => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  if (alert.value?.prompt) {
    // No campo de texto, só Enter e Esc são da pergunta.
    if (event.key === "Enter") {
      consume();
      clickBtn("ok");
    } else if (event.key === "Escape") {
      consume();
      clickBtn(buttons[0]?.value);
    }
    return;
  }
  const n = buttons.length;
  const move =
    { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key] ??
    (event.key === "Tab" ? (event.shiftKey ? -1 : 1) : 0);
  if (move) {
    consume();
    const from = picked.value === -1 ? (move > 0 ? -1 : n) : picked.value;
    picked.value = (from + move + n) % n;
    box.value?.querySelector(`[data-alert-btn="${picked.value}"]`)?.focus?.();
    return;
  }
  if (event.key === "Enter" || event.key === " ") {
    consume();
    if (picked.value !== -1) clickBtn(buttons[picked.value]?.value);
    return;
  }
  if (event.key === "Escape") {
    consume();
    clickBtn(buttons[0]?.value);
  }
}

// O botão que o Enter aperta já aparece marcado, quando a pergunta tem um. Uma
// pergunta nova pode chegar com outra ainda aberta: a marcação recomeça por ela.
watch(
  () => [show.value, alert.value?.buttons, alert.value?.default_button, alert.value?.prompt],
  () => {
    const buttons = alert.value?.buttons ?? [];
    picked.value =
      show.value && !alert.value?.prompt
        ? buttons.findIndex((btn) => btn.value === alert.value?.default_button)
        : -1;
  },
  { immediate: true }
);

watch(
  show,
  (visible) => {
    if (typeof window === "undefined") return;
    if (visible) window.addEventListener("keydown", onKeydown, { capture: true });
    else window.removeEventListener("keydown", onKeydown, { capture: true });
  },
  { immediate: true }
);
onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown, { capture: true }));

function clickBtn(value) {
  if (alert.value?.prompt) {
    const entered = (promptValue.value || "").trim();
    $appdata.set("alert.value", value === "ok" ? entered : null);
  } else {
    $appdata.set("alert.value", value);
  }
  $appdata.set("alert.show", false);
}
</script>

<style scoped>
/* Acima de diálogo, painel e dica: o alerta quase sempre é aberto de dentro
   de um deles e é a única saída da ação em curso. */
.alert-overlay {
  position: fixed;
  inset: 0;
  z-index: calc(var(--lj-z-toast) + 1);
  /* Estar por cima não basta. Um diálogo modal da Reka — a janela de módulo, por
     exemplo — carimba `pointer-events: none` no <body> para tornar inerte tudo
     que está fora dele, e este alerta é teleportado justamente para o <body>.
     Sem retomar o ponteiro aqui, ele aparece na tela e não responde a clique
     nenhum: o operador fica preso, com a pergunta à vista e sem saída. */
  pointer-events: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--lj-space-8);
  background: var(--lj-black-alpha-40);
}

.alert {
  width: 100%;
  max-width: 480px;
  max-height: 100%;
  background: var(--lj-popup-bg);
  border-radius: var(--lj-radius-md);
  box-shadow: var(--lj-popup-shadow);
  font-family: var(--lj-font-shell);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.alert-header {
  display: flex;
  align-items: center;
  gap: var(--lj-space-3);
  padding: var(--lj-space-5) var(--lj-space-6) var(--lj-space-3);
  border-bottom: 1px solid var(--lj-surface-divider);
  flex-shrink: 0;
}

.alert-header-icon {
  flex-shrink: 0;
  color: var(--lj-navy);
}

.alert--error .alert-header-icon {
  color: var(--lj-danger);
}
.alert--success .alert-header-icon {
  color: var(--lj-success);
}
.alert--warning .alert-header-icon {
  color: var(--lj-warning);
}

.alert-title {
  margin: 0;
  font-size: var(--lj-text-lg);
  font-weight: var(--lj-weight-semibold);
  color: var(--lj-text);
}

.alert-body {
  padding: var(--lj-space-5) var(--lj-space-6);
  color: var(--lj-text);
  min-height: 0;
  overflow-y: auto;
}

.alert-text {
  margin: 0;
  font-size: var(--lj-text-base);
  line-height: 1.5;
  color: var(--lj-text);
}

.alert-error {
  display: block;
  margin-top: var(--lj-space-3);
  padding: var(--lj-space-3);
  background: var(--lj-danger-soft);
  border-left: 3px solid var(--lj-danger);
  border-radius: var(--lj-radius-sm);
  font-size: var(--lj-text-sm);
  color: var(--lj-alert-error-color);
  font-family: var(--lj-font-mono);
  white-space: pre-wrap;
  word-break: break-word;
}

.alert-details {
  margin-top: var(--lj-space-3);
}
.alert-details summary {
  cursor: pointer;
  font-size: var(--lj-text-sm);
  color: var(--lj-text-muted);
}
.alert-details .alert-error {
  margin-top: var(--lj-space-2);
}

.alert-body--input {
  padding-top: 0;
}
.alert-input {
  width: 100%;
  padding: var(--lj-space-2) var(--lj-space-3);
  border: 1px solid var(--lj-surface-border-strong);
  border-radius: var(--lj-radius-sm);
  background: var(--lj-surface-bg);
  color: var(--lj-text);
  font-family: inherit;
  font-size: var(--lj-text-base);
  outline: none;
}
.alert-input:focus {
  border-color: var(--lj-navy);
  box-shadow: var(--lj-shadow-focus-navy-sm);
}

.alert-actions {
  display: flex;
  flex-shrink: 0;
  justify-content: flex-end;
  gap: var(--lj-space-3);
  padding: var(--lj-space-3) var(--lj-space-6);
  border-top: 1px solid var(--lj-surface-divider);
  background: var(--lj-surface-bg-soft);
}

.alert-btn {
  display: inline-flex;
  align-items: center;
  padding: var(--lj-space-2) var(--lj-space-5);
  background: var(--lj-surface-bg);
  border: 1px solid var(--lj-surface-border-strong);
  border-radius: var(--lj-radius-sm);
  font-size: var(--lj-text-base);
  font-weight: var(--lj-weight-medium);
  color: var(--lj-text);
  cursor: pointer;
  transition:
    background var(--lj-transition-fast),
    border-color var(--lj-transition-fast);
  font-family: inherit;
  min-width: 80px;
  justify-content: center;
}

.alert-btn:hover {
  background: var(--lj-surface-bg-hover);
  border-color: var(--lj-navy);
}

.alert-btn--info,
.alert-btn--primary {
  background: var(--lj-navy);
  color: var(--lj-white);
  border-color: var(--lj-navy-dark);
}

.alert-btn--info:hover,
.alert-btn--primary:hover {
  background: var(--lj-navy-active);
  border-color: var(--lj-navy);
  color: var(--lj-white);
}

.alert-btn--error {
  color: var(--lj-danger-dark);
  border-color: var(--lj-danger);
}

.alert-btn--error:hover {
  background: var(--lj-danger);
  color: var(--lj-white);
  border-color: var(--lj-danger-dark);
}

.alert-btn--warning {
  background: var(--lj-warning);
  color: var(--lj-white);
  border-color: var(--lj-warning);
}

.alert-btn--warning:hover {
  background: var(--lj-warning-dark, var(--lj-warning));
  color: var(--lj-white);
  border-color: var(--lj-warning-dark, var(--lj-warning));
}

.alert-btn--success {
  background: var(--lj-success);
  color: var(--lj-white);
  border-color: var(--lj-success);
}

.alert-enter-active,
.alert-leave-active {
  transition: opacity var(--lj-transition-normal);
}

.alert-enter-from,
.alert-leave-to {
  opacity: 0;
}

/* Escolha pelo teclado (setas): o operador precisa ver qual botão o Enter aperta. */
.alert-btn:focus-visible,
.alert-btn--picked {
  outline: 3px solid var(--lj-ui-accent, #f59e0b);
  outline-offset: 2px;
}
</style>
