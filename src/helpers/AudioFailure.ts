/**
 * AudioFailure.ts — Que aviso mostrar quando o áudio não toca.
 *
 * @category helper-puro — Sem APIs Vue.
 */

export interface AudioFailure {
  /** Chave i18n global da explicação. */
  text: string;
  retryable: boolean;
}

export interface AudioFailureContext {
  /** O elemento lê a URL direto; o arquivo não estava inteiro em memória. */
  streaming: boolean;
  online: boolean;
}

export function audioFailure(error: unknown, context: AudioFailureContext): AudioFailure {
  const name = (error as { name?: string } | null)?.name;
  if (name === "NotSupportedError") {
    // O navegador dá este mesmo erro quando a fonte nem chega a carregar. Em
    // streaming isso é rede, ou arquivo que não está no aparelho, e não formato:
    // culpar o aparelho faz o operador desistir de um celular que toca.
    if (!context.streaming) return { text: "modules.media.alerts.unsupported", retryable: false };
    return {
      text: context.online
        ? "modules.media.alerts.not_loaded"
        : "modules.media.alerts.offline_not_downloaded",
      retryable: true,
    };
  }
  if (name === "DecodeError") return { text: "modules.media.alerts.decode", retryable: true };
  if (name === "NotAllowedError") return { text: "modules.media.alerts.blocked", retryable: false };
  return { text: "modules.media.alerts.not_loaded", retryable: true };
}
