/**
 * Troca de módulo embedded sem buraco na tela.
 *
 * Cada módulo é um chunk carregado sob demanda. Quando o operador abre um que
 * ainda não foi baixado, `active_module` muda na hora, mas o código do módulo
 * só chega alguns quadros depois — e nesse intervalo a aba anterior já saiu e a
 * nova ainda não existe. Sobra o fundo de `.shell-content`, que é a cor do
 * tema: um clarão azul (ou verde, ou laranja) atrás da tela a cada módulo
 * aberto pela primeira vez. Sem erro no console; só o piscar.
 *
 * A saída é a mesma de um navegador trocando de aba: a tela anterior continua
 * no lugar até a próxima estar pronta para desenhar. `Modules.vue` decide quem
 * fica na tela e publica aqui; `ModuleContainer` e `Shell.vue` leem.
 *
 * São refs de módulo, e não provide/inject, porque `Shell.vue` é pai de
 * `Modules.vue` — o estado nasce no filho e é lido para cima e para os lados.
 * Com `Modules.vue` desmontado tudo fica no valor neutro e ninguém muda de
 * comportamento.
 *
 * @category composable
 */
import { ref } from "vue";
import { pickNavDirection, type NavDirection } from "@/composables/useNavDirection";

export { pickNavDirection };

/** Módulo embedded que está de fato desenhado (pode não ser o `active_module`). */
export const shownModuleId = ref<string | null>(null);

/**
 * Módulo anterior mantido visível enquanto o próximo carrega. O `v-show` do
 * `ModuleContainer` olha para cá — sem isso ele se esconderia sozinho assim que
 * `active_module` mudasse, e o buraco voltaria.
 */
export const heldModuleId = ref<string | null>(null);

/**
 * Há um módulo ativo cujo código ainda não chegou e não há tela anterior para
 * segurar (é o primeiro módulo aberto a partir da tela inicial). `Shell.vue`
 * mantém a tela inicial no lugar enquanto isto for verdadeiro.
 */
export const awaitingModule = ref(false);

/**
 * Quanto tempo o módulo que saiu continua desenhado por baixo enquanto o
 * próximo entra por cima (`Modules.vue`).
 *
 * Sem isso a troca tem um quadro em branco no meio: a tela antiga some, a nova
 * ainda está transparente, e o que aparece é a cor da superfície. Entre dois
 * módulos claros ninguém nota; saindo do Relógio (preto) para o Cronômetro
 * (escuro) é um clarão branco a cada troca.
 *
 * Precisa cobrir a entrada inteira do próximo (`--lj-motion-normal`, 0,28s) —
 * `Motion.spec.ts` confere os dois.
 */
export const PAGE_LEAVE_MS = 300;

/**
 * De que lado a página nova entra: -1 pela esquerda, 1 pela direita, 0 sem
 * lado. `Modules.vue` publica como `--lj-nav-x` no módulo que entra e a
 * animação de troca de página (`.lj-page-in`, ui.css) lê. A direção segue a
 * ordem das abas abertas: ir para uma aba mais à direita traz a página da
 * direita — é o que diz ao operador para onde ele foi.
 */
export const navDirection = ref<NavDirection>(0);

/**
 * Quanto tempo a tela anterior espera pela próxima. No desktop o chunk vem do
 * disco e chega em milissegundos, muito antes disto. O prazo existe para o
 * web em rede lenta: passado ele, mostrar a aba nova vazia é mais honesto do
 * que deixar o conteúdo antigo sob o título da nova.
 */
export const HOLD_TIMEOUT_MS = 300;

/**
 * Qual módulo fica na tela.
 *
 * - Sem módulo ativo, nenhum (tela inicial).
 * - Módulo ativo pronto para desenhar: ele.
 * - Módulo ativo ainda carregando: o anterior, se continuar aberto; senão o
 *   próprio ativo, que mostra o lugar vazio até chegar — o comportamento de
 *   sempre.
 */
export function pickShownModule(
  active: string | null,
  previous: string | null,
  isReady: (id: string) => boolean,
  isOpen: (id: string) => boolean
): string | null {
  if (!active) return null;
  if (isReady(active)) return active;
  if (previous && previous !== active && isOpen(previous)) return previous;
  return active;
}

/** Devolve tudo ao valor neutro — `Modules.vue` chama ao desmontar. */
export function resetModuleSwap(): void {
  shownModuleId.value = null;
  heldModuleId.value = null;
  awaitingModule.value = false;
  navDirection.value = 0;
}
