import { watch, type Directive, type DirectiveBinding } from "vue";
import { useConnectivity } from "@/composables/useConnectivity";
import { i18nAtual } from "@/i18n";

/**
 * `v-requires-network` — marca um controle que não funciona sem internet.
 *
 * Sem rede ele fica desabilitado, com o motivo no `title`, e um clique
 * insistente (teclado, leitor de tela, `.click()` de outro código) recebe o
 * aviso curto em vez de falhar em silêncio ou abrir um diálogo.
 *
 * Existe como diretiva porque o alvo são dezenas de botões espalhados por
 * módulos independentes; uma prop nova em cada um seria a mesma regra copiada
 * dezenas de vezes, e a que ficasse para trás só apareceria na igreja.
 *
 * Aceita um valor para o caso em que a ação continua possível offline:
 * `v-requires-network="!jaEstaNoDisco"`.
 */

interface Estado {
  stop: () => void;
  onClick: (e: Event) => void;
}

const estados = new WeakMap<HTMLElement, Estado>();

function aplicar(el: HTMLElement, offline: boolean, exige: boolean): void {
  const bloquear = offline && exige;
  const t = i18nAtual()?.global?.t;
  const motivo = t ? t("shell.offline_action") : "Esta ação precisa de internet.";

  if (bloquear) {
    el.setAttribute("aria-disabled", "true");
    el.classList.add("lj-requires-network--off");
    if (!el.dataset.ljTitleAntigo) el.dataset.ljTitleAntigo = el.getAttribute("title") || "";
    el.setAttribute("title", motivo);
    if ("disabled" in el) (el as HTMLButtonElement).disabled = true;
    return;
  }

  el.removeAttribute("aria-disabled");
  el.classList.remove("lj-requires-network--off");
  if (el.dataset.ljTitleAntigo !== undefined) {
    if (el.dataset.ljTitleAntigo) el.setAttribute("title", el.dataset.ljTitleAntigo);
    else el.removeAttribute("title");
    delete el.dataset.ljTitleAntigo;
  }
  // Só devolve o que este guard tirou: um botão desabilitado por outra razão
  // (download em andamento, formulário incompleto) continua desabilitado.
  if ("disabled" in el && el.getAttribute("disabled") === null) {
    (el as HTMLButtonElement).disabled = false;
  }
}

export const requiresNetwork: Directive<HTMLElement, boolean | undefined> = {
  mounted(el, binding: DirectiveBinding<boolean | undefined>) {
    const { isOnline, guardNetwork } = useConnectivity();
    const exige = () => binding.value !== false;

    const onClick = (e: Event) => {
      if (isOnline.value || !exige()) return;
      e.preventDefault();
      e.stopPropagation();
      guardNetwork();
    };
    // Captura: precisa chegar antes do handler do próprio componente.
    el.addEventListener("click", onClick, true);

    const stop = watch(isOnline, (online) => aplicar(el, !online, exige()), { immediate: true });
    estados.set(el, { stop, onClick });
  },

  updated(el, binding) {
    const { isOnline } = useConnectivity();
    aplicar(el, !isOnline.value, binding.value !== false);
  },

  unmounted(el) {
    const estado = estados.get(el);
    if (!estado) return;
    estado.stop();
    el.removeEventListener("click", estado.onClick, true);
    estados.delete(el);
  },
};

export default requiresNetwork;
