/**
 * Sobreposições GLOBAIS do shell (paleta de comandos, busca rápida).
 *
 * Elas podem ser abertas por cima de uma janela de módulo — o player, por
 * exemplo. Duas camadas com foco preso disputam: a janela de trás puxa o foco
 * de volta, e o que o operador digita cai nela. Enquanto houver uma
 * sobreposição global aberta, as janelas de módulo não prendem nem assumem o
 * foco (ver `Window.vue`).
 *
 * Um contador, e não um booleano: as duas sobreposições podem coexistir.
 *
 * @category composable
 */
import { onBeforeUnmount, ref, watch, type Ref } from "vue";

export const sobreposicoesGlobais = ref(0);

/**
 * Registra uma sobreposição enquanto `aberta` for verdadeiro e libera ao
 * fechar ou desmontar. Idempotente por ciclo: um mesmo componente conta uma vez.
 */
export function useSobreposicaoGlobal(aberta: Ref<boolean>): void {
  let liberar: (() => void) | null = null;

  const sincronizar = (valor: boolean): void => {
    if (valor && !liberar) {
      sobreposicoesGlobais.value += 1;
      let ativa = true;
      liberar = () => {
        if (!ativa) return;
        ativa = false;
        sobreposicoesGlobais.value = Math.max(0, sobreposicoesGlobais.value - 1);
      };
      return;
    }
    if (!valor && liberar) {
      liberar();
      liberar = null;
    }
  };

  watch(aberta, sincronizar, { immediate: true });
  onBeforeUnmount(() => {
    liberar?.();
    liberar = null;
  });
}
