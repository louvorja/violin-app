import { onUnmounted, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useBroadcastListener } from "@/composables/useBroadcastListener";
import $broadcast from "@/helpers/Broadcast";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import { localeTag } from "@/helpers/DateTime";
import { ModuleEnum } from "@/enums/ModuleEnum";
import { clockTimeText, readClockOptions } from "@/modules/clock/projectionText";
import { counterIdleText } from "@/modules/counter/projectionText";
import { stopwatchIdleText } from "@/modules/stopwatch/projectionText";
import { timerIdleText } from "@/modules/timer/projectionText";
import { worshipIdleText } from "@/modules/timer_worship/projectionText";

const IDLE_TEXT: Partial<Record<string, (_now: Date) => string>> = {
  [ModuleEnum.COUNTER]: counterIdleText,
  [ModuleEnum.STOPWATCH]: stopwatchIdleText,
  [ModuleEnum.TIMER]: timerIdleText,
  [ModuleEnum.TIMER_WORSHIP]: worshipIdleText,
};

/**
 * Texto do espelho de módulo. Vem do módulo quando ele está ou esteve aberto na
 * sessão; antes disso, é o que ele mostra ao abrir. A hora é calculada aqui, com as
 * opções do Relógio: não depende da tela dele aberta nem congela quando ela fecha.
 *
 * A cor de aviso/alerta chega no mesmo pacote que a projeção do módulo usa: o
 * espelho de um temporizador que não muda de cor esconde do palco a única
 * informação que importa perto do fim.
 */
export function useModuleMirror(sources: () => Array<string | null | undefined>) {
  const { locale } = useI18n();
  const values = reactive<Record<string, string>>({});
  const colors = reactive<Record<string, string>>({});
  const now = ref(new Date());
  let tick: ReturnType<typeof setTimeout> | null = null;

  useBroadcastListener(BROADCAST_TYPE.MODULE_PROJECTION_VALUE, (payload) => {
    const p = payload as {
      module?: string;
      text?: string;
      reference?: string;
      color?: string;
    } | null;
    if (!p?.module) return;
    values[p.module] = p.text || p.reference || "";
    // Pacote sem cor apaga a anterior: o aviso não pode sobrar depois de zerar.
    colors[p.module] = typeof p.color === "string" ? p.color : "";
  });

  // Na virada do segundo, para a projeção e o retorno trocarem juntos.
  function schedule(): void {
    tick = setTimeout(
      () => {
        now.value = new Date();
        schedule();
      },
      1000 - (Date.now() % 1000)
    );
  }

  function stop(): void {
    if (tick !== null) clearTimeout(tick);
    tick = null;
  }

  // Quem abriu o módulo antes desta tela tem o valor guardado na janela principal.
  watch(
    () => [...new Set(sources().filter((source): source is string => !!source))],
    (current, previous: string[] = []) => {
      for (const source of current)
        if (!previous.includes(source))
          $broadcast.send(BROADCAST_TYPE.REQUEST_MODULE_STATE, { module: source });
    },
    { immediate: true }
  );

  watch(
    () => sources().some(Boolean),
    (needed) => {
      if (!needed) stop();
      else if (tick === null) {
        now.value = new Date();
        schedule();
      }
    },
    { immediate: true }
  );
  onUnmounted(stop);

  function mirrorText(source: string | null | undefined): string {
    if (!source) return "—";
    if (source === ModuleEnum.CLOCK)
      return clockTimeText(now.value, localeTag(locale.value), readClockOptions());
    return values[source] || IDLE_TEXT[source]?.(now.value) || "—";
  }

  /** Cor de aviso/alerta em vigor no módulo; vazio = vale a cor da sobreposição. */
  function mirrorColor(source: string | null | undefined): string {
    return (source && colors[source]) || "";
  }

  return { mirrorText, mirrorColor };
}
