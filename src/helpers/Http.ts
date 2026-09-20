/** @category helper-puro — Sem APIs Vue; seguro em qualquer contexto do renderer. */

/**
 * Quanto esperar antes de desistir. Sem isso, um wifi de igreja que aceita a
 * conexão e não entrega nada — portal cativo é o caso clássico — não deixa o
 * app "offline": ele fica pendurado no timeout padrão do Chrome, que é de
 * minutos, e as telas que dependem daquela chamada congelam junto.
 */
export const NET_TIMEOUT = {
  /** Enfeite: título de vídeo, miniatura. Some sem prejuízo. */
  QUICK: 5000,
  /** Catálogo, configuração, API. */
  DEFAULT: 10000,
  /** Arquivo grande: só a espera pela resposta é limitada, nunca a transferência. */
  MEDIA: 30000,
  /**
   * Teto para uma transferência inteira, onde não dá para separar resposta de
   * corpo (XHR). Generoso de propósito: numa 3G de igreja um áudio leva bem
   * mais de 30s, e cortar isso seria pior que o problema que o prazo evita.
   */
  STALLED: 120000,
} as const;

export type NetworkErrorKind = "network" | "http" | "other";

export interface FetchOptions extends RequestInit {
  /** Milissegundos até desistir. Padrão: `NET_TIMEOUT.DEFAULT`. */
  timeout?: number;
  /** Identifica quem falhou, para o diagnóstico de conectividade. */
  source?: string;
  /**
   * Serviço de terceiro (YouTube, VLibras). O sucesso dele prova que a internet
   * está viva, mas a falha não prova o contrário: pode ser o serviço fora do ar
   * ou bloqueado na rede da igreja, com o resto funcionando. Só o sucesso conta.
   */
  thirdParty?: boolean;
}

type NetworkReporter = (ok: boolean, source: string) => void;
export interface NetworkTiming {
  source: string;
  duration_ms: number;
  status?: number;
  ok?: boolean;
  outcome: "response" | "network_error" | "cancelled";
  remote: boolean;
  third_party: boolean;
}

type NetworkTimingReporter = (timing: NetworkTiming) => void;

let _reporter: NetworkReporter | null = null;
let _timingReporter: NetworkTimingReporter | null = null;

/**
 * Liga o helper ao estado de conectividade. Fica invertido de propósito: este
 * arquivo não pode importar um composable, senão deixa de ser utilizável fora
 * de um componente.
 */
export function setNetworkReporter(fn: NetworkReporter | null): void {
  _reporter = fn;
}

/** Observabilidade opcional de duração/status sem acoplar este helper ao PostHog. */
export function setNetworkTimingReporter(fn: NetworkTimingReporter | null): void {
  _timingReporter = fn;
}

function report(ok: boolean, source: string): void {
  try {
    _reporter?.(ok, source);
  } catch {
    /* diagnóstico nunca derruba a chamada que o originou */
  }
}

/**
 * Boa parte do que o app busca por `fetch` é arquivo local servido pelo
 * protocolo `louvorja://`. Uma falha ali é arquivo que não existe, não internet
 * que caiu — reportar isso derrubaria o app para offline com a rede intacta.
 */
export function ehRemota(input: RequestInfo | URL): boolean {
  const url = input instanceof Request ? input.url : String(input);
  return /^https?:/i.test(url);
}

/**
 * O que separa "a rede falhou" de "o servidor respondeu algo ruim". Só o
 * primeiro vira estado de conectividade; o segundo continua sendo erro visível,
 * porque um 404 é arquivo que não existe, não falta de internet.
 */
export function classifyNetworkError(e: unknown): NetworkErrorKind {
  if (e instanceof DOMException && (e.name === "AbortError" || e.name === "TimeoutError")) {
    return "network";
  }
  if (e instanceof TypeError) return "network";
  const msg = e instanceof Error ? e.message : String(e ?? "");
  if (/^HTTP \d{3}/.test(msg)) return "http";
  if (/failed to fetch|network|timeout|abort/i.test(msg)) return "network";
  return "other";
}

/**
 * Falha que o operador não tem como consertar e que passa sozinha: rede fora, ou
 * servidor com problema momentâneo (5xx, 408, 429). Não merece diálogo modal; o
 * indicador de conexão e um aviso discreto contam a história. 404, acesso negado
 * e resposta inválida continuam sendo erro de verdade.
 */
export function isTransientFailure(e: unknown): boolean {
  if (classifyNetworkError(e) === "network") return true;
  const msg = e instanceof Error ? e.message : String(e ?? "");
  return /^HTTP (?:408|429|5\d\d)\b/.test(msg);
}

/**
 * `fetch` com prazo até a RESPOSTA — não até o fim da transferência.
 *
 * A diferença é o que separa "desistir de uma rede morta" de "cortar o download
 * de quem está numa 3G": `AbortSignal.timeout` mataria a leitura do corpo no
 * meio, e um áudio de alguns megabytes passa fácil de trinta segundos numa
 * conexão de igreja. Como `await fetch` resolve quando os cabeçalhos chegam, o
 * prazo é cancelado ali e o corpo flui pelo tempo que precisar.
 *
 * Qualquer resposta HTTP — inclusive 500 — conta como rede viva: o servidor foi
 * alcançado, o problema é outro.
 */
export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: FetchOptions = {}
): Promise<Response> {
  const {
    timeout = NET_TIMEOUT.DEFAULT,
    source = "fetch",
    thirdParty = false,
    signal,
    ...rest
  } = init;

  const controller = new AbortController();
  const prazo = setTimeout(() => controller.abort(new DOMException("Timeout", "TimeoutError")), timeout);

  const signals = [controller.signal];
  if (signal) signals.push(signal);

  const remota = ehRemota(input);
  const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();

  const reportTiming = (timing: Omit<NetworkTiming, "duration_ms">): void => {
    try {
      _timingReporter?.({
        ...timing,
        duration_ms: Math.max(0, Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt)),
      });
    } catch {
      /* métricas nunca podem alterar a chamada de rede */
    }
  };

  try {
    const response = await fetch(input, { ...rest, signal: AbortSignal.any(signals) });
    clearTimeout(prazo);
    if (remota) report(true, source);
    reportTiming({ source, status: response.status, ok: response.ok, outcome: "response", remote: remota, third_party: thirdParty });
    return response;
  } catch (e) {
    clearTimeout(prazo);
    // Cancelamento nosso (trocar de música, fechar a tela) não é falha de rede.
    if (signal?.aborted) {
      reportTiming({ source, outcome: "cancelled", remote: remota, third_party: thirdParty });
      throw e;
    }
    if (remota && !thirdParty && classifyNetworkError(e) === "network") report(false, source);
    reportTiming({ source, outcome: "network_error", remote: remota, third_party: thirdParty });
    throw e;
  }
}
