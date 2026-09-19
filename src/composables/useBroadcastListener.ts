import { getCurrentInstance, onActivated, onDeactivated, onMounted, onUnmounted } from "vue";
import $broadcast from "@/helpers/Broadcast";
import type { BroadcastMessage } from "@/helpers/BroadcastTypes";

/**
 * Registra um listener do BroadcastChannel("louvorja") e o pausa quando o
 * componente entra em uma aba KeepAlive inativa. Remove automaticamente no
 * `onUnmounted` — elimina trabalho de fundo, memory leaks e side-effects
 * fantasma sem perder o estado local da tela.
 *
 * Pode ser chamado múltiplas vezes no mesmo `setup()` para tipos diferentes.
 *
 * @param type  Tipo(s) a ouvir, ou "*" para todos.
 * @param handler  Callback chamado com (payload, msg).
 */
export function useBroadcastListener(
  type: string | string[],
  handler: (payload: unknown, msg: BroadcastMessage) => void
): void {
  let unlisten: (() => void) | null = null;
  let hasStarted = false;

  const start = () => {
    if (unlisten) return;
    unlisten = $broadcast.listen(
      (msg) => {
        if (type === "*" || msg.type === type || (Array.isArray(type) && type.includes(msg.type))) {
          handler(msg.payload, msg);
        }
      },
      // A reativação não precisa replayar o estado inteiro do bus: os módulos
      // leem UserData/AppData atuais ao voltarem para a aba, e o replay de
      // dezenas de estados de outras janelas só acrescenta trabalho ao frame
      // da troca. O primeiro mount preserva o comportamento anterior.
      { replay: !hasStarted }
    );
    hasStarted = true;
  };

  const stop = () => {
    unlisten?.();
    unlisten = null;
  };

  // Alguns composables compartilhados também usam este helper fora de uma
  // instância Vue (por exemplo, estado singleton e testes). Nessa situação
  // não há lifecycle para observar: preserve o comportamento anterior e
  // mantenha o listener vivo até o processo encerrar.
  if (!getCurrentInstance()) {
    start();
    return;
  }

  onMounted(start);
  onActivated(start);
  onDeactivated(stop);

  onUnmounted(stop);
}
