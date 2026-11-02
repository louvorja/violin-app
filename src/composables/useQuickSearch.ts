import { nextTick, onBeforeUnmount, onMounted, watch, type Ref } from "vue";
import $appdata from "@/helpers/AppData";
import { KEYS } from "@/constants/UserDataKeys";

/**
 * Campo de busca pronto para digitar, como no LouvorJA clássico:
 *
 * - entrou na tela (abriu o módulo ou clicou na aba dele), o cursor já está
 *   na busca — quem entra no Hinário entra para escolher o hino;
 * - voltou para a tela (a música acabou, o player fechou, a janela do
 *   LouvorJA voltou a ter foco), o que estava digitado fica selecionado: o
 *   próximo número substitui o anterior, sem apagar nem clicar no X.
 *
 * Não rouba o foco de quem está digitando em outro campo, nem de um diálogo
 * aberto (a busca rápida, um alerta).
 */

interface SearchInput {
  focus: () => void;
  select?: () => void;
  el?: () => HTMLInputElement | null;
}

const ACTIVE_MODULE = "active_module";

/** Outro campo de texto em foco, ou um diálogo aberto por cima: a busca espera. */
function busyElsewhere(own: HTMLInputElement | null): boolean {
  if (typeof document === "undefined") return true;
  if (document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"]')) return true;
  const el = document.activeElement as HTMLElement | null;
  if (!el || el === document.body || el === own) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") {
    const type = (el as HTMLInputElement).type;
    return !["button", "checkbox", "radio", "range", "submit", "reset"].includes(type);
  }
  return !!el.closest?.('[role="combobox"], [role="listbox"], [role="menu"]');
}

export function useQuickSearch(options: {
  /** O módulo dono do campo (o mesmo de `active_module`). */
  moduleId: () => string | null | undefined;
  input: Ref<SearchInput | null>;
  /** Só age quando isto for verdadeiro (ex.: a busca está à vista). */
  enabled?: () => boolean;
}) {
  const isActive = () => {
    const id = options.moduleId();
    return !!id && $appdata.get(ACTIVE_MODULE) === id && options.enabled?.() !== false;
  };

  /** Quanto esperar um diálogo que está fechando (o player, o "Deseja fechar?"). */
  const RETRY_MS = 150;
  const MAX_TRIES = 12;
  let attemptId = 0;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const later = (fn: () => void, ms: number) => {
    const t = setTimeout(() => {
      timers.delete(t);
      fn();
    }, ms);
    timers.add(t);
  };

  /**
   * Foca e seleciona o texto da busca (quando a tela é desta busca). Se um
   * diálogo ainda está saindo da tela, espera por ele; e se, logo depois, o
   * diálogo devolver o foco para a página (a Reka faz isso ao fechar), seleciona
   * de novo — senão o número digitado em seguida se perderia.
   */
  function focusSearch(): void {
    if (!isActive()) return;
    const id = ++attemptId;
    const attempt = (tries: number) => {
      if (id !== attemptId) return;
      const field = options.input.value;
      if (!field || !isActive()) return;
      const own = field.el?.() ?? null;
      const hidden = !!own && (own.disabled || !own.offsetParent);
      if (hidden || busyElsewhere(own)) {
        if (tries < MAX_TRIES) later(() => attempt(tries + 1), RETRY_MS);
        return;
      }
      if (field.select) field.select();
      else field.focus();
      // Conferência: o diálogo que fechou pode ter puxado o foco de volta.
      later(() => {
        if (id !== attemptId || !isActive()) return;
        const active = document.activeElement;
        if ((!active || active === document.body) && !busyElsewhere(own)) {
          if (field.select) field.select();
          else field.focus();
        }
      }, 250);
    };
    // O v-show da aba só abre depois do tick: espera o quadro seguinte.
    void nextTick(() => requestAnimationFrame(() => attempt(0)));
  }

  /** Depois de mandar tocar: o campo sai do foco para os atalhos do player valerem. */
  function afterPlay(): void {
    options.input.value?.el?.()?.blur();
  }

  // Clicou na aba (ou abriu o módulo): pronto para digitar.
  watch(
    () => $appdata.get(ACTIVE_MODULE),
    () => focusSearch()
  );

  // A música acabou ou o player fechou: o número anterior fica selecionado.
  watch(
    () => Boolean($appdata.get(KEYS.MODULES.MEDIA.SHOW)),
    (showing, was) => {
      if (was && !showing) focusSearch();
    }
  );

  // Voltou da janela de projeção ou de outro programa para o LouvorJA.
  const onWindowFocus = () => {
    if ($appdata.get(KEYS.MODULES.MEDIA.SHOW)) return;
    focusSearch();
  };

  // O operador clicou em algum lugar (uma linha da tabela, outro campo): o que
  // ainda estava pendente — esperar um diálogo fechar, a conferência de foco —
  // não vale mais. Sem isto, a conferência devolvia o foco à busca logo depois
  // do clique numa linha. O teclado não cancela: o Enter que responde ao
  // "Deseja fechar?" é justamente o que a espera aguarda.
  const onPointerDown = () => {
    attemptId++;
    for (const t of timers) clearTimeout(t);
    timers.clear();
  };

  // Clicou de novo no botão da tela que já estava aberta: também vai para a busca.
  const onModuleOpen = (event: Event) => {
    if ((event as CustomEvent<{ id?: string }>).detail?.id === options.moduleId()) focusSearch();
  };

  onMounted(() => {
    window.addEventListener("focus", onWindowFocus);
    window.addEventListener("lj:module-open", onModuleOpen);
    window.addEventListener("pointerdown", onPointerDown, true);
    focusSearch();
  });
  onBeforeUnmount(() => {
    window.removeEventListener("focus", onWindowFocus);
    window.removeEventListener("lj:module-open", onModuleOpen);
    window.removeEventListener("pointerdown", onPointerDown, true);
    attemptId++;
    for (const t of timers) clearTimeout(t);
    timers.clear();
  });

  return { focusSearch, afterPlay };
}
