/**
 * Ligar e desligar uma tela de projeção — o botão "Projetar".
 *
 * Duas portas, porque a projeção de fundo mudou o que "projetar" significa:
 *
 * - **fora do fundo**: abre uma `BrowserWindow` em tela cheia (o comportamento
 *   de sempre);
 * - **dentro do fundo**: um utilitário (`/projection/module`) não abre janela —
 *   vira uma camada da janela de fundo, que é o que dá o fade. Quem liga essa
 *   camada é o **clique**, e não o valor que o módulo emite: contador, relógio e
 *   timer emitem `active:true` desde que o módulo abre, muito antes de alguém
 *   pedir para projetar.
 *
 * O botão é renderizado por dois componentes (`Screen.vue`, no player, e
 * `RibbonScreenButton.vue`, na ribbon dos módulos) — por isso a regra mora
 * aqui, e não duplicada em cada um.
 *
 * @category composable
 */
import { computed, ref } from "vue";
import Broadcast from "@/helpers/Broadcast";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import { useBroadcastListener } from "@/composables/useBroadcastListener";
import {
  isBackgroundOpen,
  setUtilitarioNaCamada,
  utilitarioNaCamada,
} from "@/helpers/ProjectionWindows";
import {
  close as closeProjection,
  isOpen as isProjectionOpen,
  open as openProjection,
} from "@/helpers/Projection";

export interface ScreenProjectionSource {
  feature: () => string;
  route: () => string;
  monitorId: () => number | string | null | undefined;
  fullscreen: () => boolean;
  alwaysOnTop: () => boolean;
}

/** Utilitários projetam por esta rota e são os únicos que viram camada. */
const ROTA_DE_MODULO = "/projection/module";

export function useScreenProjection(source: ScreenProjectionSource) {
  /** Janela aberta — vale fora do fundo. */
  const janelaAberta = ref(false);
  /** A projeção de fundo está no ar? Só utilitários perguntam. */
  const fundoAberto = ref(false);
  /** Qual utilitário está na camada do fundo agora. */
  const utilitariosNoFundo = ref<Record<string, boolean>>({});

  const eUtilitario = computed(() => (source.route() || "").startsWith(ROTA_DE_MODULO));
  const dentroDoFundo = computed(() => eUtilitario.value && fundoAberto.value);

  useBroadcastListener(BROADCAST_TYPE.MODULE_PROJECTION_OPEN, (payload: unknown) => {
    const id = (payload as { module?: string } | null)?.module;
    if (id) utilitariosNoFundo.value = { ...utilitariosNoFundo.value, [id]: true };
  });
  useBroadcastListener(BROADCAST_TYPE.MODULE_PROJECTION_CLOSE, (payload: unknown) => {
    const id = (payload as { module?: string } | null)?.module;
    if (!id) return;
    utilitariosNoFundo.value = { ...utilitariosNoFundo.value, [id]: false };
    if (utilitarioNaCamada() === id) setUtilitarioNaCamada(null);
  });

  /**
   * Está projetando agora?
   *
   * Com o fundo ligado a resposta é a camada, não a existência da janela. E é
   * DERIVADO, não guardado: senão o botão só mudaria de estado no próximo
   * polling, e um utilitário fechado por outra janela (o ESC) ficaria marcado
   * como ligado.
   */
  const aberto = computed(() =>
    dentroDoFundo.value ? utilitariosNoFundo.value[source.feature()] === true : janelaAberta.value
  );

  async function refresh(): Promise<void> {
    janelaAberta.value = await isProjectionOpen(source.feature());
    if (eUtilitario.value) fundoAberto.value = await isBackgroundOpen();
  }

  async function abrir(monitorId = source.monitorId()): Promise<void> {
    if (dentroDoFundo.value) {
      /*
       * A janela pode ter ficado aberta de antes: o fundo é ligado depois, e
       * nada fecha a janela do utilitário nesse caminho. Com as duas no ar o
       * mesmo módulo apareceria DUAS vezes no telão — a janela opaca por cima
       * da camada, exatamente o retângulo que a camada veio para evitar.
       */
      if (janelaAberta.value) await closeProjection(source.feature());
      Broadcast.send(BROADCAST_TYPE.MODULE_PROJECTION_OPEN, { module: source.feature() });
      utilitariosNoFundo.value = { ...utilitariosNoFundo.value, [source.feature()]: true };
      /* Quem estava no ar como camada é o que o handoff devolve se o fundo fechar. */
      setUtilitarioNaCamada(source.feature());
    } else {
      await openProjection({
        feature: source.feature(),
        route: source.route(),
        monitorId,
        fullscreen: source.fullscreen(),
        alwaysOnTop: source.alwaysOnTop(),
      });
    }
    await refresh();
  }

  async function fechar(): Promise<void> {
    if (dentroDoFundo.value) {
      /*
       * O aviso é o mesmo que o ESC da janela usa. Mandar o INTENT de desligar
       * não alcança a camada: quem consome aquele é a autoridade, que publica o
       * VALOR do módulo — e valor não é visibilidade. O utilitário ficaria
       * preso no telão.
       */
      Broadcast.send(BROADCAST_TYPE.MODULE_PROJECTION_CLOSE, { module: source.feature() });
      utilitariosNoFundo.value = { ...utilitariosNoFundo.value, [source.feature()]: false };
      if (utilitarioNaCamada() === source.feature()) setUtilitarioNaCamada(null);
    } else {
      await closeProjection(source.feature());
    }
    await refresh();
  }

  async function toggle(): Promise<void> {
    if (aberto.value) await fechar();
    else await abrir();
  }

  return {
    aberto,
    janelaAberta,
    dentroDoFundo,
    eUtilitario,
    utilitariosNoFundo,
    refresh,
    abrir,
    fechar,
    toggle,
  };
}
