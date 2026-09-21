import { ref } from "vue";

/**
 * Estado "ocupado" para trabalho curto que precisa dar retorno visual. Ler e gravar um arquivo
 * pequeno leva dezenas de milissegundos: sem um mínimo o indicador piscaria por um quadro e
 * pareceria que nada aconteceu. Ele aparece na hora e, se o trabalho acabou cedo, fica até
 * completar o mínimo.
 *
 * `run` só devolve o resultado depois disso, então o que vem depois dele (o aviso de sucesso, por
 * exemplo) entra com o indicador já fora da tela, e não junto com ele.
 */
export function useBusy(minimumMs = 450) {
  const busy = ref(false);
  let running = 0;

  async function run<T>(work: () => Promise<T>): Promise<T> {
    running++;
    busy.value = true;
    const startedAt = Date.now();
    try {
      return await work();
    } finally {
      const missing = minimumMs - (Date.now() - startedAt);
      if (missing > 0) await new Promise<void>((resolve) => setTimeout(resolve, missing));
      running--;
      if (running === 0) busy.value = false;
    }
  }

  return { busy, run };
}
