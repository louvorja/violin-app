import { onMounted, ref } from "vue";
import {
  youtubeAccountLogin,
  youtubeAccountLogout,
  youtubeAccountStatus,
} from "@/helpers/OnlineVideo";

/**
 * Conta do YouTube do operador, para a tela de Opções: só a pedido, quando o
 * YouTube começa a pedir "confirme que você não é um robô". Os cookies ficam
 * no main; aqui só se sabe se há alguém conectado.
 */
export function useYoutubeAccount(enabled: () => boolean) {
  const loggedIn = ref(false);
  const busy = ref(false);

  async function run(action: () => Promise<{ loggedIn: boolean }>): Promise<void> {
    busy.value = true;
    try {
      loggedIn.value = (await action()).loggedIn;
    } finally {
      busy.value = false;
    }
  }

  onMounted(() => {
    if (enabled()) void run(youtubeAccountStatus);
  });

  return {
    loggedIn,
    busy,
    login: () => run(youtubeAccountLogin),
    logout: () => run(youtubeAccountLogout),
  };
}
