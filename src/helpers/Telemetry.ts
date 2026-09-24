/**
 * Telemetry.ts — observabilidade de uso e diagnóstico via PostHog.
 *
 * Coleta eventos de uso e diagnóstico para permitir investigar falhas sem
 * reproduzir a sessão. A opção de telemetria continua sendo o interruptor
 * único para todo o envio.
 *
 * @category deve-virar-composable — lê e grava preferências via UserData.
 */
import type {
  CaptureResult,
  CapturedNetworkRequest,
  LogAttributes,
  PostHog,
  RequestResponse,
} from "posthog-js";
import Broadcast from "@/helpers/Broadcast";
import { BROADCAST_TYPE, type TelemetrySessionPayload } from "@/helpers/BroadcastTypes";
import Platform from "@/helpers/Platform";
import $userdata from "@/helpers/UserData";
import { setNetworkTimingReporter } from "@/helpers/Http";
import { setDatabaseTimingReporter } from "@/helpers/Database";
import { KEYS } from "@/constants/UserDataKeys";
import packageJson from "@root/package.json";

const KEY = import.meta.env.VITE_POSTHOG_KEY ?? "";
const HOST = import.meta.env.VITE_POSTHOG_HOST || "https://us.i.posthog.com";
const BUILD_SDK_VERSION = normalizeVersion(import.meta.env.VITE_POSTHOG_SDK_VERSION);

let _started = false;
let _ph: PostHog | null = null;
let _appVersion =
  typeof packageJson.version === "string" && packageJson.version ? packageJson.version : "unknown";
let _appVersionSource = "package_json_fallback";
let _sdkVersion = BUILD_SDK_VERSION || "unknown";
let _installed = false;
let _nativeAutocaptureActive = false;
let _responsivenessCleanup: (() => void) | null = null;
let _runtimeContext: { playback_id?: string; presentation_revision?: number } = {};
let _mainSessionId = "";
let _errorReplayStartedAt = 0;
let _errorReplayTimer: ReturnType<typeof setTimeout> | null = null;
let _sessionBusConnected = false;
const _pendingExceptions: Array<{ error: unknown; properties?: Record<string, unknown> }> = [];
const _pendingEvents: Array<{ event: string; properties: Record<string, unknown> }> = [];
const _pendingMetrics: Array<{ name: string; value: number; attributes: MetricAttributes }> = [];
const _pendingRuntimeLogs: Array<{
  level: "warn" | "error" | "fatal";
  attributes: Record<string, unknown>;
}> = [];
const _pendingSpans = new Map<string, PerformanceSpan>();
const _breadcrumbs: Array<{ at: string; event: string; properties?: Record<string, unknown> }> = [];
const _explicitErrors = new WeakMap<object, number>();
const DUPLICATE_CAPTURE_WINDOW_MS = 5_000;
const MAX_BREADCRUMBS = 150;
const MAX_PROPERTY_DEPTH = 6;
const MAX_ARRAY_ITEMS = 100;
const MAX_STRING_LENGTH = 20_000;
// O Replay só grava depois de um erro real: a janela se renova a cada novo erro
// e, com erros em sequência, uma gravação nunca passa do teto.
const REPLAY_AFTER_ERROR_MS = 5 * 60_000;
const REPLAY_MAX_MS = 15 * 60_000;
const UI_JANK_BUDGET = { warn: 250, critical: 1_000 } as const;
const RUNTIME_HEARTBEAT_MS = 15_000;
const RUNTIME_AGGREGATE_LOG_MS = 60_000;
const RUNTIME_CRITICAL_COOLDOWN_MS = 60_000;
const PERFORMANCE_DIAGNOSTIC_COOLDOWN_MS = 60_000;
const _performanceDiagnosticWindows = new Map<
  string,
  { lastCapturedAt: number; suppressedCount: number }
>();
const PERFORMANCE_BUDGETS: Array<{
  match: RegExp;
  warn: number;
  critical: number;
  ownEvent?: boolean;
}> = [
  { match: /route\.transition|route_transition/, warn: 1_000, critical: 5_000 },
  { match: /module\.(open|mount|first_paint)/, warn: 500, critical: 2_000 },
  { match: /data_table\.(load|filter)/, warn: 500, critical: 3_000 },
  { match: /database\.(read|bundle)/, warn: 1_000, critical: 10_000 },
  { match: /projection\.(open|broadcast)/, warn: 500, critical: 3_000 },
  { match: /music\.(audio|metadata|page|playlists)/, warn: 1_000, critical: 8_000 },
  { match: /http\.client/, warn: 1_000, critical: 5_000 },
  // ui_long_task e ui_thread_stall já são o evento detalhado dessas medições.
  { match: /ui\.(long_task|stall)/, ...UI_JANK_BUDGET, ownEvent: true },
];
// Aviso do navegador sem efeito visível, que o Error Tracking classifica como severidade alta.
const BENIGN_EXCEPTION =
  /^ResizeObserver loop (?:completed with undelivered notifications|limit exceeded)\.?$/i;
const SENSITIVE_KEY = /(password|passwd|secret|token|authorization|cookie|api[-_]?key)/i;
const SENSITIVE_QUERY =
  /([?&](?:access[-_]?token|refresh[-_]?token|token|auth(?:orization)?|api[-_]?key|client[-_]?secret|secret|password|jwt)=)[^&\s]+/gi;

type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";
type PostHogWithLogs = PostHog & {
  logger?: Partial<
    Record<LogLevel, (_message: string, _attributes?: Record<string, unknown>) => void>
  >;
  captureLog?: (_record: {
    body: string;
    level: LogLevel;
    attributes?: Record<string, unknown>;
  }) => void;
};

type MetricAttributes = Record<string, string | number | boolean>;
type PostHogWithMetrics = PostHog & {
  metrics?: {
    histogram: (
      name: string,
      value: number,
      options?: { unit?: string; attributes?: MetricAttributes }
    ) => void;
  };
};

type DiagnosticLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

type ConsoleTelemetryBridge = {
  originalError: (...args: unknown[]) => void;
  originalWarn: (...args: unknown[]) => void;
  captureException: (args: unknown[]) => void;
  captureWarning: (args: unknown[]) => void;
};

export interface PerformanceSpan {
  name: string;
  startedAt: number;
  properties?: Record<string, unknown>;
}

function sanitizeString(value: string): string {
  return value.slice(0, MAX_STRING_LENGTH).replace(SENSITIVE_QUERY, "$1[REDACTED]");
}

function normalizeVersion(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/^v(?=\d)/, "") : "";
}

/**
 * Marcos de uma troca de slide: o primeiro, o último e o que chega sem conteúdo.
 * Emissor e receptores usam a mesma regra, então o cruzamento enviado × recebido
 * segue valendo; a latência de cada troca continua inteira no histograma.
 */
export function isProjectionMilestone(index: unknown, total: unknown, hasSlide: boolean): boolean {
  if (!hasSlide) return true;
  const position = Number(index);
  const count = Number(total);
  if (!Number.isFinite(position) || !Number.isFinite(count)) return true;
  return position <= 0 || position >= count - 1;
}

export function isBenignException(properties: Record<string, unknown> | undefined): boolean {
  const list = properties?.$exception_list;
  if (!Array.isArray(list) || list.length === 0) return false;
  return list.every((item) => {
    const value = (item as { value?: unknown } | null)?.value;
    return typeof value === "string" && BENIGN_EXCEPTION.test(value.trim());
  });
}

function serializableValue(value: unknown, depth = 0): unknown {
  if (value === undefined) return undefined;
  if (value == null || ["string", "number", "boolean"].includes(typeof value)) {
    return typeof value === "string" ? sanitizeString(value) : value;
  }
  if (value instanceof Date) return value.toISOString();
  if (depth >= MAX_PROPERTY_DEPTH) return "[max-depth]";
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_ITEMS).map((item) => serializableValue(item, depth + 1));
  }
  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    try {
      for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
        if (SENSITIVE_KEY.test(key)) continue;
        const serialized = serializableValue(nestedValue, depth + 1);
        if (serialized !== undefined) result[key] = serialized;
      }
    } catch {
      return "[unserializable]";
    }
    return result;
  }
  return "[unsupported]";
}

function serializableProperties(properties: Record<string, unknown> = {}): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(properties)) {
    // Conteúdo de músicas é permitido pela opção solicitada; credenciais e
    // tokens continuam fora da telemetria por segurança operacional.
    if (SENSITIVE_KEY.test(key)) continue;
    const serialized = serializableValue(value);
    if (serialized !== undefined) result[key] = serialized;
  }
  return result;
}

/**
 * O renderer não tem stdout próprio no Windows. Além do DevTools, replica
 * diagnósticos curtos no processo principal, que os imprime no CMD/PowerShell
 * que iniciou o executável. Falhar nesse caminho nunca pode afetar o app.
 */
function diagnostic(
  level: DiagnosticLevel,
  message: string,
  details: Record<string, unknown> = {}
): void {
  const safeMessage = sanitizeString(message);
  const safeDetails = serializableProperties(details);
  try {
    const logger =
      (console as unknown as Record<DiagnosticLevel, (...args: unknown[]) => void>)[level] ||
      console.info;
    logger(`[Telemetry] ${safeMessage}`, safeDetails);
  } catch {
    // O console pode ser substituído por um host de teste ou por uma extensão.
  }
  try {
    const logger = (_ph as PostHogWithLogs | null)?.logger?.[level];
    logger?.(safeMessage, safeDetails);
  } catch {
    // Logs estruturados são best-effort e não podem impedir o bootstrap.
  }
  try {
    if (typeof window !== "undefined") {
      window.louvorjaApi?.telemetry?.log?.({ level, message: safeMessage, details: safeDetails });
    }
  } catch {
    // Telemetria de diagnóstico é best-effort.
  }
}

/**
 * Diagnósticos de transporte não passam pelo logger do próprio PostHog:
 * registrar a resposta de `/e/` pelo logger criaria outra requisição e
 * poderia esconder um loop de falha. O terminal continua recebendo a linha
 * pelo mesmo canal IPC, mas este helper é deliberadamente local.
 */
function transportDiagnostic(
  level: DiagnosticLevel,
  message: string,
  details: Record<string, unknown> = {}
): void {
  const safeMessage = sanitizeString(message);
  const safeDetails = serializableProperties(details);
  try {
    const logger =
      (console as unknown as Record<DiagnosticLevel, (...args: unknown[]) => void>)[level] ||
      console.info;
    logger(`[Telemetry] ${safeMessage}`, safeDetails);
  } catch {
    // O diagnóstico nunca pode interferir no envio nem no fluxo da aplicação.
  }
  try {
    if (typeof window !== "undefined") {
      window.louvorjaApi?.telemetry?.log?.({ level, message: safeMessage, details: safeDetails });
    }
  } catch {
    // O processo principal pode não estar disponível em testes ou no PWA.
  }
}

function idSuffix(value: unknown): string | undefined {
  if (typeof value !== "string" || !value) return undefined;
  return value.length > 8 ? `…${value.slice(-8)}` : value;
}

function runtimeContext(): Record<string, unknown> {
  const api = typeof window !== "undefined" ? window.louvorjaApi : undefined;
  return {
    target: Platform.isDesktop ? "electron" : "web",
    os: osName(),
    electron_version: api?.runtime?.electron || Platform.electronVersion || undefined,
    chromium_version: api?.runtime?.chrome || undefined,
    node_version: api?.runtime?.node || undefined,
    is_dev: Platform.isDev,
  };
}

function sdkIdentity(posthog: PostHog): Record<string, unknown> {
  try {
    const getDistinctId =
      typeof posthog.get_distinct_id === "function" ? posthog.get_distinct_id() : undefined;
    const getSessionId =
      typeof posthog.get_session_id === "function" ? posthog.get_session_id() : undefined;
    const deviceId =
      typeof posthog.get_property === "function" ? posthog.get_property("$device_id") : undefined;
    return {
      capturing: typeof posthog.is_capturing === "function" ? posthog.is_capturing() : undefined,
      loaded:
        "__loaded" in posthog
          ? Boolean((posthog as PostHog & { __loaded?: unknown }).__loaded)
          : undefined,
      distinct_id_suffix: idSuffix(getDistinctId),
      session_id_suffix: idSuffix(getSessionId),
      device_id_suffix: idSuffix(deviceId),
    };
  } catch (error) {
    return {
      identity_error: error instanceof Error ? sanitizeString(error.message) : String(error),
    };
  }
}

function captureResultDetails(result: CaptureResult | undefined): Record<string, unknown> {
  // posthog-js pode retornar undefined mesmo depois de aceitar o evento na
  // fila interna. Portanto, isso não deve ser exibido como "criado: false";
  // o sinal confiável no boot é `capture_called` junto de `capturing`.
  if (!result) return { capture_returned: false };
  return {
    capture_returned: true,
    uuid: result.uuid,
    event: result.event,
    timestamp: result.timestamp instanceof Date ? result.timestamp.toISOString() : undefined,
  };
}

function baseContext(): Record<string, unknown> {
  return {
    app_version: _appVersion,
    app_version_source: _appVersionSource,
    sdk_version: _sdkVersion,
    ...runtimeContext(),
    route:
      typeof window !== "undefined"
        ? sanitizeString(`${window.location.pathname}${window.location.hash}`)
        : "",
    window_role: windowRole(),
    window_feature: windowFeature(),
    online: typeof navigator !== "undefined" ? navigator.onLine : undefined,
    elapsed_ms: typeof performance !== "undefined" ? Math.round(performance.now()) : undefined,
  };
}

function errorProperties(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: sanitizeString(error.message),
      stack: error.stack ? sanitizeString(error.stack) : undefined,
    };
  }
  return { message: sanitizeString(String(error)) };
}

// Sem timestamp: a gravação nasce junto com o erro, então um `?t=` medido desde o
// início da sessão apontaria para além do fim do vídeo. Janelas auxiliares não
// gravam, e o link delas seria uma página vazia.
function replayLinkProperties(): Record<string, unknown> {
  if (windowRole() !== "main") return {};
  try {
    const url = _ph?.get_session_replay_url?.();
    return typeof url === "string" && url ? { replay_url: url } : {};
  } catch {
    return {};
  }
}

function stopErrorReplay(): void {
  if (_errorReplayTimer) clearTimeout(_errorReplayTimer);
  _errorReplayTimer = null;
  _errorReplayStartedAt = 0;
  try {
    _ph?.stopSessionRecording();
  } catch {
    // Parar o replay nunca pode afetar o app.
  }
}

function startErrorReplay(): void {
  if (!_ph || windowRole() !== "main" || !isEnabled()) return;
  const now = Date.now();
  if (_errorReplayStartedAt && now - _errorReplayStartedAt >= REPLAY_MAX_MS) stopErrorReplay();
  if (!_errorReplayStartedAt) {
    _errorReplayStartedAt = now;
    try {
      // `true` ignora amostragem e gatilhos do projeto: a decisão de gravar é deste código.
      _ph.startSessionRecording(true);
    } catch (error) {
      _errorReplayStartedAt = 0;
      diagnostic("warn", "falha ao iniciar o replay do erro", {
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    diagnostic("info", "replay iniciado por erro");
  }
  if (_errorReplayTimer) clearTimeout(_errorReplayTimer);
  const untilCap = REPLAY_MAX_MS - (now - _errorReplayStartedAt);
  _errorReplayTimer = setTimeout(stopErrorReplay, Math.min(REPLAY_AFTER_ERROR_MS, untilCap));
}

function announceMainSession(sessionId: string | undefined): void {
  if (!sessionId) return;
  const payload: TelemetrySessionPayload = { session_id: sessionId };
  Broadcast.send(BROADCAST_TYPE.TELEMETRY_SESSION, payload);
}

// Cada janela tem a própria sessão (`persistence: "memory"`) e só a principal
// grava. A auxiliar aprende a sessão da principal para que os erros dela
// apontem para uma gravação que existe.
function connectSessionBus(posthog: PostHog): void {
  if (_sessionBusConnected) return;
  _sessionBusConnected = true;
  try {
    if (windowRole() === "main") {
      Broadcast.listen(
        (message) => {
          if (message.type === BROADCAST_TYPE.TELEMETRY_SESSION_REQUEST) {
            announceMainSession(posthog.get_session_id?.());
          } else if (message.type === BROADCAST_TYPE.TELEMETRY_ERROR_SEEN) {
            startErrorReplay();
          }
        },
        { replay: false }
      );
      posthog.onSessionId?.((sessionId) => announceMainSession(sessionId));
      return;
    }
    Broadcast.listen(
      (message) => {
        if (message.type !== BROADCAST_TYPE.TELEMETRY_SESSION) return;
        const sessionId = (message.payload as Partial<TelemetrySessionPayload> | undefined)
          ?.session_id;
        if (typeof sessionId === "string" && sessionId) _mainSessionId = sessionId;
      },
      { replay: false }
    );
    Broadcast.send(BROADCAST_TYPE.TELEMETRY_SESSION_REQUEST, {});
  } catch (error) {
    diagnostic("debug", "canal de sessão do replay indisponível", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function onRealException(isMainWindow: boolean, capture: CaptureResult): void {
  if (isMainWindow) {
    setTimeout(startErrorReplay, 0);
    return;
  }
  if (!_mainSessionId) return;
  // O Error Tracking liga erro e replay pelo `$session_id`; o da principal é o que tem gravação.
  capture.properties = { ...capture.properties, $session_id: _mainSessionId };
  Broadcast.send(BROADCAST_TYPE.TELEMETRY_ERROR_SEEN, {});
}

function requestUrl(input: Parameters<NonNullable<typeof globalThis.fetch>>[0]): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  if (typeof Request !== "undefined" && input instanceof Request) return input.url;
  return "";
}

function requestPath(url: string): string {
  try {
    return new URL(url).pathname || "/";
  } catch {
    return "unknown";
  }
}

function isPostHogIngestionRequest(url: string): boolean {
  const path = requestPath(url);
  return path.endsWith("/e/") || path.endsWith("/e");
}

/**
 * O SDK captura `fetch` quando o módulo é carregado. Envolver apenas durante
 * o import dinâmico faz o próprio transporte do PostHog reportar respostas
 * 2xx e falhas de rede, sem trocar o fetch da aplicação nem depender de APIs
 * internas instáveis do SDK.
 */
async function importPostHogWithTransportDiagnostics(): Promise<typeof import("posthog-js")> {
  const originalFetch = globalThis.fetch;
  if (typeof originalFetch !== "function") return import("posthog-js");

  type Fetch = NonNullable<typeof globalThis.fetch>;
  const wrappedFetch = ((input: Parameters<Fetch>[0], init?: Parameters<Fetch>[1]) => {
    const url = requestUrl(input);
    if (!isPostHogIngestionRequest(url)) return originalFetch.call(globalThis, input, init);
    const startedAt = Date.now();
    const method = typeof init?.method === "string" ? init.method : "GET";
    try {
      return originalFetch.call(globalThis, input, init).then(
        (response) => {
          const status = response.status;
          transportDiagnostic(
            status >= 200 && status < 300 ? "info" : "warn",
            status >= 200 && status < 300
              ? "PostHog aceitou o lote de eventos"
              : "PostHog rejeitou o lote de eventos",
            {
              endpoint: requestPath(url),
              method,
              status,
              accepted: status >= 200 && status < 300,
              duration_ms: Date.now() - startedAt,
            }
          );
          return response;
        },
        (error) => {
          transportDiagnostic("warn", "falha de rede ao enviar lote ao PostHog", {
            endpoint: requestPath(url),
            method,
            status: 0,
            accepted: false,
            duration_ms: Date.now() - startedAt,
            error: error instanceof Error ? error.message : String(error),
          });
          throw error;
        }
      );
    } catch (error) {
      transportDiagnostic("warn", "falha síncrona ao enviar lote ao PostHog", {
        endpoint: requestPath(url),
        method,
        status: 0,
        accepted: false,
        duration_ms: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }) as Fetch;

  globalThis.fetch = wrappedFetch;
  try {
    return await import("posthog-js");
  } finally {
    // Não altere o fetch do produto depois que o SDK capturou a referência.
    if (globalThis.fetch === wrappedFetch) globalThis.fetch = originalFetch;
  }
}

/**
 * Cria um Error novo antes de entregar a exceção ao SDK.
 *
 * Sanitizar apenas as propriedades adicionais não basta: o PostHog também
 * lê message/stack do primeiro argumento de captureException. Nunca passe o
 * objeto de erro original, que pode carregar dados vindos da rede ou do
 * processo principal.
 */
function safeError(error: unknown): Error {
  let message = "Erro não identificado";
  try {
    message = error instanceof Error ? error.message : String(error);
  } catch {
    message = "Erro não serializável";
  }

  const safe = new Error(sanitizeString(message));
  if (error instanceof Error) {
    safe.name = sanitizeString(error.name || "Error");
    if (error.stack) safe.stack = sanitizeString(error.stack);
  }
  return safe;
}

export function breadcrumb(event: string, properties: Record<string, unknown> = {}): void {
  if (!isEnabled()) return;
  _breadcrumbs.push({
    at: new Date().toISOString(),
    event,
    properties: serializableProperties(properties),
  });
  if (_breadcrumbs.length > MAX_BREADCRUMBS)
    _breadcrumbs.splice(0, _breadcrumbs.length - MAX_BREADCRUMBS);
  _ph?.addExceptionStep(event, serializableProperties(properties));
}

export function track(event: string, properties: Record<string, unknown> = {}): void {
  if (!isEnabled()) return;
  const enriched = { ...baseContext(), ...serializableProperties(properties) };
  breadcrumb(event, properties);
  if (_ph) _ph.capture(event, enriched);
  // `init()` é assíncrono (import dinâmico do SDK + resolução da versão); a
  // navegação inicial do router dispara antes dele terminar. Sem fila, esse
  // primeiro `route_changed` — e qualquer evento disparado nesse intervalo —
  // desaparecia em silêncio.
  else if (_pendingEvents.length < 50) _pendingEvents.push({ event, properties: enriched });
}

export function captureException(error: unknown, properties: Record<string, unknown> = {}): void {
  if (!isEnabled()) return;
  if (error && typeof error === "object") {
    // O mesmo Error costuma passar por catch local, errorHandler do Vue e console.error.
    const now = Date.now();
    const capturedAt = _explicitErrors.get(error);
    if (capturedAt !== undefined && now - capturedAt < DUPLICATE_CAPTURE_WINDOW_MS) return;
    _explicitErrors.set(error, now);
  }
  const sanitized = safeError(error);
  const enriched = {
    ...baseContext(),
    ...errorProperties(sanitized),
    ...replayLinkProperties(),
    ...serializableProperties(properties),
    breadcrumbs: _breadcrumbs.slice(-50),
  };
  if (_ph) _ph.captureException(sanitized, enriched);
  else if (_pendingExceptions.length < 20)
    _pendingExceptions.push({ error: sanitized, properties: enriched });
}

/** Começa uma medição de duração sem bloquear o fluxo funcional. */
export function startPerformance(
  name: string,
  properties: Record<string, unknown> = {}
): PerformanceSpan {
  return {
    name,
    startedAt: typeof performance !== "undefined" ? performance.now() : Date.now(),
    properties,
  };
}

export function markStart(
  name: string,
  key: string,
  properties: Record<string, unknown> = {}
): void {
  _pendingSpans.set(`${name}:${key}`, startPerformance(name, properties));
}

export function markEnd(
  name: string,
  key: string,
  properties: Record<string, unknown> = {}
): number | null {
  const span = _pendingSpans.get(`${name}:${key}`);
  if (!span) return null;
  _pendingSpans.delete(`${name}:${key}`);
  return finishPerformance(span, properties);
}

/** Registra uma medição agregável no PostHog e devolve a duração em milissegundos. */
export function finishPerformance(
  span: PerformanceSpan,
  properties: Record<string, unknown> = {}
): number {
  const now = typeof performance !== "undefined" ? performance.now() : Date.now();
  const durationMs = Math.max(0, Math.round(now - span.startedAt));
  track("performance_measurement", {
    measurement: span.name,
    duration_ms: durationMs,
    ...(span.properties || {}),
    ...properties,
  });
  histogram(`louvorja.performance.${span.name}.duration`, durationMs, {
    window_role: windowRole(),
    ...(span.properties || {}),
  });
  return durationMs;
}

/** Registra um histograma agregado, sem colocar ids/URLs de alta cardinalidade nas séries. */
export function histogram(name: string, value: number, attributes: MetricAttributes = {}): void {
  if (!isEnabled() || !Number.isFinite(value)) return;
  const safeName = name.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 120);
  const safeAttributes = Object.fromEntries(
    Object.entries(attributes).filter(([, item]) =>
      ["string", "number", "boolean"].includes(typeof item)
    )
  ) as MetricAttributes;
  const budget = PERFORMANCE_BUDGETS.find((candidate) => candidate.match.test(safeName));
  if (budget && value >= budget.warn) {
    const severity = value >= budget.critical ? "critical" : "slow";
    const diagnosticKey = `${safeName}:${severity}`;
    const now = Date.now();
    let diagnosticWindow = _performanceDiagnosticWindows.get(diagnosticKey);
    if (!diagnosticWindow && _performanceDiagnosticWindows.size >= 100) {
      const oldestKey = _performanceDiagnosticWindows.keys().next().value;
      if (oldestKey) _performanceDiagnosticWindows.delete(oldestKey);
    }
    if (
      !diagnosticWindow ||
      now - diagnosticWindow.lastCapturedAt >= PERFORMANCE_DIAGNOSTIC_COOLDOWN_MS
    ) {
      const suppressedCount = diagnosticWindow?.suppressedCount ?? 0;
      diagnosticWindow = { lastCapturedAt: now, suppressedCount: 0 };
      _performanceDiagnosticWindows.set(diagnosticKey, diagnosticWindow);
      const suppressed = suppressedCount > 0 ? { suppressed_count: suppressedCount } : {};
      if (!budget.ownEvent) {
        track("performance_slow", {
          metric_name: safeName,
          duration_ms: Math.round(value),
          severity,
          warn_budget_ms: budget.warn,
          critical_budget_ms: budget.critical,
          ...suppressed,
          ...safeAttributes,
        });
      }
      log(severity === "critical" ? "error" : "warn", "performance budget exceeded", {
        metric_name: safeName,
        duration_ms: Math.round(value),
        severity,
        warn_budget_ms: budget.warn,
        critical_budget_ms: budget.critical,
        ...suppressed,
        ...safeAttributes,
      });
    } else {
      diagnosticWindow.suppressedCount += 1;
    }
  }
  const metrics = (_ph as PostHogWithMetrics | null)?.metrics;
  if (metrics?.histogram) {
    try {
      metrics.histogram(safeName, value, { unit: "ms", attributes: safeAttributes });
      return;
    } catch {
      // Métricas são best-effort; o evento detalhado continua sendo enviado.
    }
  }
  if (_pendingMetrics.length < 100)
    _pendingMetrics.push({ name: safeName, value, attributes: safeAttributes });
}

type JankAggregate = {
  count: number;
  warn_count: number;
  critical_count: number;
  total_ms: number;
  max_ms: number;
};

function emptyJankAggregate(): JankAggregate {
  return { count: 0, warn_count: 0, critical_count: 0, total_ms: 0, max_ms: 0 };
}

function addJank(aggregate: JankAggregate, durationMs: number): void {
  aggregate.count += 1;
  aggregate.total_ms += durationMs;
  aggregate.max_ms = Math.max(aggregate.max_ms, durationMs);
  if (durationMs >= UI_JANK_BUDGET.warn) aggregate.warn_count += 1;
  if (durationMs >= UI_JANK_BUDGET.critical) aggregate.critical_count += 1;
}

function runtimeIncidentId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    // WebView antigo: o fallback ainda e unico o bastante para correlacao local.
  }
  return `renderer-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function setRuntimeContext(context: {
  playback_id?: string | null;
  presentation_revision?: number | null;
}): void {
  const next: typeof _runtimeContext = { ..._runtimeContext };
  if (context.playback_id === null) delete next.playback_id;
  else if (typeof context.playback_id === "string" && context.playback_id.trim()) {
    next.playback_id = sanitizeString(context.playback_id.trim()).slice(0, 120);
  }
  if (context.presentation_revision === null) delete next.presentation_revision;
  else if (
    Number.isInteger(context.presentation_revision) &&
    Number(context.presentation_revision) >= 0
  ) {
    next.presentation_revision = Number(context.presentation_revision);
  }
  _runtimeContext = next;
}

const RUNTIME_INCIDENT_KEYS = new Set([
  "diagnostic_schema_version",
  "incident_id",
  "incident_type",
  "incident_status",
  "severity",
  "observed_at",
  "app_instance_id",
  "main_pid",
  "main_uptime_ms",
  "window_role",
  "feature",
  "web_contents_id",
  "renderer_last_seen_ms_ago",
  "renderer_route",
  "renderer_visibility",
  "renderer_active_operations",
  "renderer_long_task_count",
  "renderer_long_task_warn_count",
  "renderer_long_task_critical_count",
  "renderer_long_task_total_ms",
  "renderer_long_task_max_ms",
  "playback_id",
  "presentation_revision",
  "main_memory_rss_mb",
  "main_heap_used_mb",
  "download_active",
  "online_video_manager_initialized",
  "online_video_active_count",
  "online_video_resolving_count",
  "online_video_session_count",
  "online_video_foreground_running",
  "online_video_background_running",
  "online_video_foreground_queued",
  "online_video_background_queued",
  "online_video_streaming",
  "online_video_jobs",
  "update_status",
  "http_server_running",
  "projection_features",
  "window_count",
  "windows",
  "process_metrics",
  "gpu_feature_status",
  "recent_runtime_events",
  "duration_ms",
  "reason",
  "exit_code",
  "child_process_type",
  "service_name",
  "process_name",
  "main_loop_mean_ms",
  "main_loop_p95_ms",
  "main_loop_p99_ms",
  "main_loop_max_ms",
  "main_cpu_percent",
  "sample_window_ms",
  "critical_budget_ms",
  "entry_type",
  "entry_name",
  "start_time_ms",
]);

export function reportRuntimeIncident(payload: unknown): void {
  if (!isEnabled()) return;
  if (!payload || typeof payload !== "object") return;
  const raw = payload as Record<string, unknown>;
  const attributes = Object.fromEntries(
    Object.entries(raw).filter(([key]) => RUNTIME_INCIDENT_KEYS.has(key))
  );
  if (typeof attributes.incident_type !== "string" || !attributes.incident_type) return;
  const rawSeverity = attributes.severity;
  const level: "warn" | "error" | "fatal" =
    rawSeverity === "fatal" ? "fatal" : rawSeverity === "error" ? "error" : "warn";
  const enriched = {
    source: "electron.runtime_health",
    ...attributes,
  };
  if (!_ph) {
    if (_pendingRuntimeLogs.length < 20) _pendingRuntimeLogs.push({ level, attributes: enriched });
    return;
  }
  log(level, "runtime incident", enriched);
}

/**
 * Mede travamentos sem transformar a propria telemetria em carga. Heartbeats
 * de 15 s ficam somente no main process; PostHog recebe um agregado por minuto
 * quando houve jank e um unico incidente imediato para tarefas >= 1 s.
 */
function startResponsivenessMonitor(): void {
  if (_responsivenessCleanup || typeof window === "undefined" || import.meta.env.MODE === "test") {
    return;
  }

  const cleanups: Array<() => void> = [];
  let heartbeatAggregate = emptyJankAggregate();
  let remoteAggregate = emptyJankAggregate();
  let lastCriticalIncidentAt = 0;
  let longTaskObserved = false;

  const activeOperations = () =>
    [..._pendingSpans.keys()]
      .map((name) => name.replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, 80))
      .filter(Boolean)
      .slice(0, 8);

  const sendHeartbeat = () => {
    try {
      window.louvorjaApi?.telemetry?.heartbeat?.({
        sampled_at_ms: Date.now(),
        window_role: windowRole(),
        feature: windowFeature(),
        route: routePath(),
        visibility: document.visibilityState,
        active_operations: activeOperations(),
        ..._runtimeContext,
        long_tasks: heartbeatAggregate,
      });
    } catch {
      // O canal local e best-effort e nao participa do fluxo da UI.
    }
    heartbeatAggregate = emptyJankAggregate();
  };

  const flushRemoteAggregate = () => {
    const aggregate = remoteAggregate;
    remoteAggregate = emptyJankAggregate();
    if (aggregate.warn_count === 0) return;
    log(aggregate.critical_count > 0 ? "error" : "warn", "renderer responsiveness aggregate", {
      diagnostic_schema_version: 1,
      incident_type: "renderer_long_task_aggregate",
      severity: aggregate.critical_count > 0 ? "critical" : "slow",
      window_role: windowRole(),
      feature: windowFeature(),
      route: routePath(),
      long_task_count: aggregate.count,
      long_task_warn_count: aggregate.warn_count,
      long_task_critical_count: aggregate.critical_count,
      long_task_total_ms: aggregate.total_ms,
      long_task_max_ms: aggregate.max_ms,
      active_operations: activeOperations(),
      ..._runtimeContext,
    });
  };

  const recordJank = (
    durationMs: number,
    source: "renderer_long_task" | "renderer_timer_stall",
    entry?: PerformanceEntry
  ) => {
    if (!Number.isFinite(durationMs) || durationMs < 100) return;
    addJank(heartbeatAggregate, durationMs);
    addJank(remoteAggregate, durationMs);
    const now = Date.now();
    if (
      durationMs < UI_JANK_BUDGET.critical ||
      now - lastCriticalIncidentAt < RUNTIME_CRITICAL_COOLDOWN_MS
    )
      return;
    lastCriticalIncidentAt = now;
    reportRuntimeIncident({
      diagnostic_schema_version: 1,
      incident_id: runtimeIncidentId(),
      incident_type: source,
      incident_status: "detected",
      severity: "error",
      observed_at: new Date(now).toISOString(),
      window_role: windowRole(),
      feature: windowFeature(),
      duration_ms: durationMs,
      critical_budget_ms: UI_JANK_BUDGET.critical,
      entry_type: entry?.entryType,
      entry_name: entry?.name,
      start_time_ms: entry ? Math.round(entry.startTime) : undefined,
      renderer_active_operations: activeOperations(),
      ..._runtimeContext,
    });
  };

  if (typeof PerformanceObserver === "function") {
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const durationMs = Math.round(entry.duration);
          recordJank(durationMs, "renderer_long_task", entry);
        }
      });
      observer.observe({ type: "longtask", buffered: true });
      longTaskObserved = true;
      cleanups.push(() => observer.disconnect());
    } catch (error) {
      // Safari/WebView mais antigo pode expor PerformanceObserver sem suportar
      // o tipo longtask. O detector de atraso abaixo continua funcionando.
      diagnostic("debug", "PerformanceObserver longtask indisponível", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Onde o longtask existe (Chromium/Electron), ele mede o travamento real. O
  // atraso de timer também dispara com timer estrangulado e com salto de
  // relógio: chegou a reportar 40 s de "travamento" numa janela que emitia
  // eventos no meio do intervalo, sem nenhuma long task acima de 3,6 s. Aqui
  // ele só serve de reserva para quem não expõe a API.
  if (windowRole() === "main" && !longTaskObserved) {
    const intervalMs = 1_000;
    let previousTick = typeof performance !== "undefined" ? performance.now() : Date.now();
    let visibilityChanged = false;
    const markVisibilityChange = () => {
      visibilityChanged = true;
    };
    document.addEventListener("visibilitychange", markVisibilityChange);
    cleanups.push(() => document.removeEventListener("visibilitychange", markVisibilityChange));
    const timer = window.setInterval(() => {
      const now = typeof performance !== "undefined" ? performance.now() : Date.now();
      const driftMs = Math.max(0, Math.round(now - previousTick - intervalMs));
      previousTick = now;
      const crossedVisibilityChange = visibilityChanged;
      visibilityChanged = false;
      // O primeiro tick depois de a janela voltar do segundo plano carrega todo
      // o atraso acumulado e a aba já está visível: não é travamento.
      if (document.visibilityState === "hidden" || crossedVisibilityChange) return;
      recordJank(driftMs, "renderer_timer_stall");
    }, intervalMs);
    cleanups.push(() => window.clearInterval(timer));
  }

  sendHeartbeat();
  const heartbeatTimer = window.setInterval(sendHeartbeat, RUNTIME_HEARTBEAT_MS);
  const aggregateTimer = window.setInterval(flushRemoteAggregate, RUNTIME_AGGREGATE_LOG_MS);
  cleanups.push(() => window.clearInterval(heartbeatTimer));
  cleanups.push(() => window.clearInterval(aggregateTimer));

  _responsivenessCleanup = () => {
    sendHeartbeat();
    flushRemoteAggregate();
    for (const cleanup of cleanups.splice(0)) cleanup();
    _responsivenessCleanup = null;
  };
}

/**
 * Envia um log estruturado para o produto Logs do PostHog.
 *
 * Logs são úteis para transições de mídia de alta cardinalidade (por exemplo,
 * `waiting` → `playing`) sem transformar cada detalhe em uma exceção. O
 * fallback para `capture` mantém compatibilidade com versões antigas do SDK.
 */
export function log(
  level: LogLevel,
  message: string,
  properties: Record<string, unknown> = {}
): void {
  if (!isEnabled()) return;
  const safeMessage = sanitizeString(message);
  const attributes = { ...baseContext(), ...serializableProperties(properties) };
  const ph = _ph as PostHogWithLogs | null;
  const logger = ph?.logger?.[level];
  if (logger) {
    logger(safeMessage, attributes);
    return;
  }
  if (ph?.captureLog) {
    ph.captureLog({ body: safeMessage, level, attributes });
    return;
  }
  ph?.capture("telemetry_log", { level, message: safeMessage, ...attributes });
}

/**
 * Instala os handlers uma única vez em cada renderer.
 *
 * Os listeners de `window.error`/`unhandledrejection` só cobrem o intervalo
 * antes de `init()` terminar: depois que `startExceptionAutocapture` liga o
 * autocapture nativo do SDK (que também escuta esses mesmos eventos globais,
 * via `window.onerror`/`window.onunhandledrejection`), manter os dois ativos
 * duplicaria toda exceção não tratada. `_nativeAutocaptureActive` faz a troca.
 */
export function installGlobalHandlers(): void {
  if (_installed || typeof window === "undefined") return;
  _installed = true;
  const consoleState = console as typeof console & {
    __louvorjaTelemetryConsoleBridge?: ConsoleTelemetryBridge;
  };
  const reportConsoleMessage = (args: unknown[]): { message: string; errorObject?: Error } => {
    const parts = args.map((value) => {
      try {
        return value instanceof Error
          ? value.message
          : typeof value === "string"
            ? value
            : String(value);
      } catch {
        return "[unserializable]";
      }
    });
    return {
      message: sanitizeString(parts.join(" ")),
      errorObject: args.find((value): value is Error => value instanceof Error),
    };
  };
  const captureConsoleException = (args: unknown[]) => {
    const { message, errorObject } = reportConsoleMessage(args);
    if (!message || message.startsWith("[Telemetry]") || message.startsWith("[PostHog")) return;
    if (errorObject && _explicitErrors.has(errorObject)) return;
    captureException(errorObject || new Error(message), {
      source: "console.error",
      console_message: message,
    });
  };
  const captureConsoleWarning = (args: unknown[]) => {
    const { message, errorObject } = reportConsoleMessage(args);
    if (!message || message.startsWith("[Telemetry]") || message.startsWith("[PostHog")) return;
    log("warn", message, {
      source: "console.warn",
      error_name: errorObject?.name,
      error_stack: errorObject?.stack,
    });
  };
  const existingBridge = consoleState.__louvorjaTelemetryConsoleBridge;
  if (existingBridge) {
    // Mantém o wrapper original, mas aponta para o módulo atual. Isso evita
    // capturas presas a um singleton antigo durante HMR e nos testes.
    existingBridge.captureException = captureConsoleException;
    existingBridge.captureWarning = captureConsoleWarning;
  } else {
    const bridge: ConsoleTelemetryBridge = {
      originalError: console.error.bind(console),
      originalWarn: console.warn.bind(console),
      captureException: captureConsoleException,
      captureWarning: captureConsoleWarning,
    };
    consoleState.error = (...args: unknown[]) => {
      bridge.originalError(...args);
      bridge.captureException(args);
    };
    consoleState.warn = (...args: unknown[]) => {
      bridge.originalWarn(...args);
      bridge.captureWarning(args);
    };
    consoleState.__louvorjaTelemetryConsoleBridge = bridge;
  }
  window.addEventListener("error", (event) => {
    if (_nativeAutocaptureActive) return;
    captureException(event.error || new Error(event.message), {
      source: "window.error",
      filename: event.filename,
      line: event.lineno,
      column: event.colno,
    });
  });
  window.addEventListener("unhandledrejection", (event) => {
    if (_nativeAutocaptureActive) return;
    captureException(event.reason, { source: "unhandledrejection" });
  });
  window.louvorjaApi?.telemetry?.onMainError?.((payload) => {
    const data =
      payload && typeof payload === "object"
        ? (payload as Record<string, unknown>)
        : { message: String(payload) };
    const mainError = new Error(String(data.message || "Electron main process error"));
    if (typeof data.name === "string" && data.name) mainError.name = sanitizeString(data.name);
    if (typeof data.stack === "string" && data.stack) mainError.stack = sanitizeString(data.stack);
    captureException(mainError, {
      source: data.source || "electron.main",
      main_process: true,
      main_error_id: typeof data.id === "string" ? data.id : undefined,
    });
    if (typeof data.id === "string") void window.louvorjaApi?.telemetry?.ackMainError?.(data.id);
  });
  window.louvorjaApi?.telemetry?.onRuntimeIncident?.((payload) => {
    reportRuntimeIncident(payload);
  });
  window.addEventListener("online", () => diagnostic("info", "renderer voltou a ficar online"));
  window.addEventListener("offline", () => diagnostic("warn", "renderer ficou offline"));
}

export function installVueErrorHandler(app: {
  config: { errorHandler?: (_err: unknown, _instance: unknown, _info: string) => void };
}): void {
  const previous = app.config.errorHandler;
  app.config.errorHandler = (err, instance, info) => {
    captureException(err, { source: "vue", info });
    previous?.(err, instance, info);
  };
}

const AUX_ROUTES = [
  "/projection",
  "/projecao",
  "/obs",
  "/operator",
  "/clock",
  "/relogio",
  "/popup",
  "/remote",
];

function routePath(): string {
  if (typeof window === "undefined") return "/";
  return window.location.hash.replace(/^#/, "").split("?")[0] || window.location.pathname || "/";
}

function windowRole(): "main" | "auxiliary" | "unknown" {
  if (typeof window === "undefined") return "unknown";
  const route = routePath();
  return AUX_ROUTES.some((aux) => route === aux || route.startsWith(`${aux}/`))
    ? "auxiliary"
    : "main";
}

function windowFeature(): string {
  const route = routePath();
  if (route === "/") return "main";
  return route.replace(/^\//, "").split("/")[0] || "main";
}

function osName(): string {
  if (Platform.isDesktop) return Platform.platform ?? "unknown";
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  if (/Windows/i.test(ua)) return "win32";
  if (/Android/i.test(ua)) return "android";
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  if (/Mac OS X/i.test(ua)) return "darwin";
  if (/Linux/i.test(ua)) return "linux";
  return "unknown";
}

async function appVersion(): Promise<string> {
  const fromEnv = normalizeVersion(import.meta.env.VITE_APP_VERSION);
  if (fromEnv) {
    _appVersionSource = "vite_env";
    return fromEnv;
  }
  try {
    const status = (await Platform.updater?.status?.()) as { version?: string } | undefined;
    const installedVersion = normalizeVersion(status?.version);
    if (installedVersion) {
      _appVersionSource = "electron_updater";
      return installedVersion;
    }
  } catch {
    // Web/PWA não tem updater; segue para a versão canônica empacotada abaixo.
  }
  _appVersionSource = "package_json_fallback";
  return normalizeVersion(packageJson.version) || "unknown";
}

/** ID aleatório por instalação. Não deriva de nada da máquina. */
function randomId(): string {
  try {
    const uuid = globalThis.crypto?.randomUUID?.();
    if (uuid) return uuid;
  } catch {
    // Alguns ambientes Windows endurecidos removem randomUUID do Chromium.
  }
  return `lj-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random()
    .toString(36)
    .slice(2)}`;
}

function anonId(): string {
  let id = $userdata.get<string>(KEYS.OPTIONS.TELEMETRY_ID, "");
  if (!id) {
    id = randomId();
    $userdata.set(KEYS.OPTIONS.TELEMETRY_ID, id);
  }
  return id;
}

export function isEnabled(): boolean {
  // Helpers de baixo nível (por exemplo, o player) também rodam em testes e
  // durante o bootstrap, antes de o Pinia existir. Telemetria nunca pode
  // impedir o fluxo funcional nesses contextos.
  try {
    return $userdata.get<boolean>(KEYS.OPTIONS.TELEMETRY, true) !== false;
  } catch {
    return false;
  }
}

export function setEnabled(enabled: boolean): void {
  $userdata.set(KEYS.OPTIONS.TELEMETRY, enabled);
  if (!enabled) {
    _breadcrumbs.length = 0;
    _pendingExceptions.length = 0;
    _pendingEvents.length = 0;
    _pendingMetrics.length = 0;
    _pendingRuntimeLogs.length = 0;
    _pendingSpans.clear();
    _responsivenessCleanup?.();
    stopErrorReplay();
    _ph?.opt_out_capturing();
    return;
  }
  if (_ph) {
    _ph.opt_in_capturing({ captureEventName: false });
    _ph.register({ app_version: _appVersion, sdk_version: _sdkVersion });
    startResponsivenessMonitor();
  } else void init();
}

/** Zera o identificador anônimo — o usuário volta a contar como instalação nova. */
export function resetId(): void {
  const id = randomId();
  $userdata.set(KEYS.OPTIONS.TELEMETRY_ID, id);
  if (!_ph) return;
  // `reset()` também limpa o consentimento e devolve o SDK ao padrão da
  // config (aqui, capturando) — sem reforçar o opt-out logo em seguida,
  // quem tivesse desligado a telemetria a teria religada por engano. O
  // bootstrap evita a janela em que o distinct_id do SDK diverge do que
  // fica salvo em UserData até o próximo boot.
  _ph.reset({ bootstrap: { distinctID: id, isIdentifiedID: false } });
  if (isEnabled()) _ph.opt_in_capturing({ captureEventName: false });
  else _ph.opt_out_capturing();
  _ph.register({ app_version: _appVersion, sdk_version: _sdkVersion });
}

/**
 * Falha de inicialização não pode ficar muda: sem isto, um SDK quebrado (por
 * exemplo, quota/IndexedDB do Chromium bloqueada por antivírus) some sem
 * nenhum evento nem log — exatamente o cenário que a telemetria existe para
 * diagnosticar. `_started`/`_ph` voltam ao estado inicial para permitir nova
 * tentativa numa chamada futura (ex.: `setEnabled(true)` manual).
 */
export async function init(): Promise<void> {
  if (_started) return;
  if (!KEY) {
    diagnostic("warn", "desativada: VITE_POSTHOG_KEY não foi embutida nesta versão");
    return;
  }
  if (!isEnabled()) {
    diagnostic("info", "desativada nas preferências do usuário");
    return;
  }
  if (Platform.isDev) {
    diagnostic("info", "desativada em modo de desenvolvimento");
    return;
  }
  diagnostic("info", "inicializando PostHog", {
    host: HOST,
    build_version: packageJson.version,
    ...runtimeContext(),
    online: typeof navigator !== "undefined" ? navigator.onLine : undefined,
  });
  try {
    await _init();
  } catch (error) {
    _started = false;
    _ph = null;
    _nativeAutocaptureActive = false;
    diagnostic("error", "falha ao inicializar o SDK", {
      error: error instanceof Error ? error.message : String(error),
    });
    console.error("[Telemetry] falha ao inicializar:", error);
  }
}

async function _init(): Promise<void> {
  const { default: posthog } = await importPostHogWithTransportDiagnostics();
  const version = (await appVersion()) || "unknown";
  _appVersion = version;
  const sdkVersion =
    typeof (posthog as PostHog & { LIB_VERSION?: unknown }).LIB_VERSION === "string"
      ? normalizeVersion(String((posthog as PostHog & { LIB_VERSION?: unknown }).LIB_VERSION))
      : BUILD_SDK_VERSION || "unknown";
  _sdkVersion = sdkVersion;
  _started = true;
  _ph = posthog;
  const isMainWindow = windowRole() === "main";

  posthog.init(KEY, {
    api_host: HOST,
    // Electron also exposes `sendBeacon`, and the SDK can prefer it after a
    // pagehide. Keep normal event delivery on fetch so the transport wrapper
    // below can report the real HTTP result (and so failed requests retry).
    api_transport: "fetch",
    loaded: () => {
      // Este callback confirma que o SDK carregou no renderer. Falhas de
      // envio continuam passando por on_request_error abaixo, que é o sinal
      // útil quando firewall/proxy da rede da igreja bloqueia o endpoint.
      diagnostic("info", "SDK PostHog carregado", {
        sdk_version: _sdkVersion,
        ...sdkIdentity(posthog),
      });
    },
    on_request_error: (response: RequestResponse) => {
      const status = Number.isFinite(response?.statusCode) ? response.statusCode : 0;
      const error = response?.error instanceof Error ? response.error.message : response?.error;
      diagnostic("warn", "envio rejeitado", {
        status,
        error: error ? sanitizeString(String(error)) : undefined,
        response_text: response?.text ? sanitizeString(String(response.text)) : undefined,
        response_keys: response && typeof response === "object" ? Object.keys(response) : undefined,
      });
    },
    // Trava o comportamento padrão do SDK nesta data. Sem isto, atualizar a
    // biblioteca pode ligar sozinha uma captura que este arquivo desligou.
    defaults: "2026-05-30",
    // O distinct_id vem do UserData, então o PostHog não precisa de cookie
    // nem de chave própria no localStorage.
    persistence: "memory",
    bootstrap: { distinctID: anonId() },
    // A aplicação envia eventos de navegação/interação explicitamente. A
    // captura automática duplica esses eventos e instala listeners contínuos
    // em cada ação do renderer.
    autocapture: false,
    capture_pageview: false,
    capture_pageleave: false,
    capture_exceptions: true,
    error_tracking: {
      captureExtensionExceptions: false,
      exception_steps: { enabled: true, max_bytes: 32_768 },
    },
    // O Replay só existe para depurar erros: começa em `startErrorReplay`, na
    // janela do operador. Janelas auxiliares enviam eventos e erros, mas não
    // viram sessões pretas do projetor no PostHog.
    disable_session_recording: true,
    disable_external_dependency_loading: false,
    disable_surveys: true,
    disable_surveys_automatic_display: true,
    disable_product_tours: true,
    disable_conversations: true,
    disable_web_experiments: true,
    opt_in_site_apps: false,
    session_recording: {
      // Inputs continuam mascarados; textos e ações do produto são úteis
      // para entender o caminho que levou ao erro.
      maskAllInputs: true,
      // O conteúdo público de slides precisa aparecer no Replay. Conteúdo
      // sensível fora de inputs deve receber `.ph-mask` ou
      // `[data-posthog-mask]` explicitamente no componente que o renderiza.
      maskTextSelector: ".ph-mask, [data-posthog-mask]",
      // hidden/file fogem ao maskAllInputs padrão e podem carregar token ou
      // caminho local; ocultá-los não reduz a reprodução das ações do usuário.
      blockSelector: 'input[type="hidden"], input[type="file"]',
      // Replay continua sendo iniciado após erro real, mas não lê fontes nem
      // canvas: esses caminhos podem copiar/renderizar mídia pesada durante
      // apresentações e previews.
      collectFonts: false,
      captureCanvas: { recordCanvas: false },
      // Não registrar headers nem bodies: podem conter tokens, cookies ou
      // conteúdo completo de requisições, mesmo quando a URL foi redigida.
      recordHeaders: false,
      recordBody: false,
      // URLs são sempre registradas pelo network recording. O controle remoto
      // ainda aceita instalações antigas com token na query string, portanto
      // redigimos credenciais antes de o valor sair do dispositivo.
      maskCapturedNetworkRequestFn: (request: CapturedNetworkRequest) => {
        if (request?.name) {
          request.name = sanitizeString(request.name);
        }
        return request;
      },
    },
    logs: {
      serviceName: "louvorja-violin",
      environment: import.meta.env.MODE || "unknown",
      serviceVersion: version,
      // Console output pode conter dados de terceiros ou conteúdo sensível.
      // Logs estruturados passam pelo helper sanitizado; o console continua
      // disponível no Replay apenas quando o usuário autorizou.
      captureConsoleLogs: false,
      beforeSend: (record) => ({
        ...record,
        body: sanitizeString(record.body),
        attributes: record.attributes
          ? (serializableProperties(record.attributes) as LogAttributes)
          : undefined,
      }),
    },
    metrics: {
      serviceName: "louvorja-violin",
      environment: import.meta.env.MODE || "unknown",
      serviceVersion: version,
      // Duração de HTTP já é reportada pelo helper Http; instrumentar cada
      // request também pelo SDK duplicaria o trabalho e as séries.
    },
    // Não enviar os headers opcionais de tracing para a API do produto. O
    // Worker público não os lista no Access-Control-Allow-Headers; no Electron
    // isso transformava cada GET do banco em preflight rejeitado por CORS.
    // A telemetria continua correlacionada pelos próprios eventos do SDK.
    tracing_headers: [],
    enable_recording_console_log: false,
    // As medições explícitas de Http e os spans do produto são a fonte de
    // performance. Evita observers de rede/Web Vitals e recursos de produto
    // analytics que não são necessários para diagnóstico de falhas.
    capture_performance: false,
    capture_heatmaps: false,
    capture_dead_clicks: false,
    rageclick: false,
    before_send: (capture) => {
      if (!capture) return null;
      if (capture.event === "$exception") {
        if (isBenignException(capture.properties)) return null;
        onRealException(isMainWindow, capture);
      }
      // `token` is injected by PostHog and is required by `/e/`. It matches
      // the generic secret-key sanitizer, but removing it makes the SDK drop
      // every event before opening the network request. Preserve only this
      // exact SDK field; user-provided nested token fields remain redacted.
      const ingestionToken =
        typeof capture.properties?.token === "string" ? capture.properties.token : undefined;
      capture.properties = serializableProperties(capture.properties);
      if (ingestionToken) capture.properties.token = ingestionToken;
      if (capture.$set) capture.$set = serializableProperties(capture.$set);
      if (capture.$set_once) capture.$set_once = serializableProperties(capture.$set_once);
      return capture;
    },
    // Evita apenas metadados duplicados ou credenciais que possam aparecer em
    // URLs; propriedades de música e ações do usuário são intencionais.
    property_denylist: [
      "$raw_user_agent",
      "$current_url",
      "$pathname",
      "$host",
      "$referrer",
      "$referring_domain",
      "$session_entry_url",
      "$session_entry_host",
      "$session_entry_pathname",
      "$session_entry_referrer",
      "$session_entry_referring_domain",
    ],
  });

  // O `opt_out_capturing` anterior grava uma flag própria no localStorage que
  // sobrevive ao reload. Sem reconciliar aqui, quem desligasse e religasse a
  // opção ficaria sem telemetria para sempre, com o toggle marcado.
  posthog.opt_in_capturing({ captureEventName: false });
  posthog.register({
    app_version: version,
    sdk_version: sdkVersion,
    window_role: windowRole(),
    window_feature: windowFeature(),
    window_route: routePath(),
    telemetry_schema_version: 2,
  });
  connectSessionBus(posthog);
  // `capture()` returning undefined only means that the SDK did not return a
  // payload to the caller. This hook is the stronger signal that the event
  // passed consent/bot filters and reached the SDK's request pipeline.
  if (typeof posthog.on === "function") {
    let capturedDiagnostics = 0;
    posthog.on("eventCaptured", (data: { event?: unknown; uuid?: unknown }) => {
      const event = typeof data?.event === "string" ? data.event : "unknown";
      if (event !== "app_opened" && capturedDiagnostics >= 5) return;
      capturedDiagnostics += 1;
      diagnostic("debug", "evento aceito pelo pipeline do PostHog", {
        event,
        uuid_suffix: idSuffix(data?.uuid),
        captured_count: capturedDiagnostics,
        api_transport: "fetch",
      });
    });
  }
  diagnostic("info", "SDK PostHog inicializado", {
    ...runtimeContext(),
    app_version: version,
    app_version_source: _appVersionSource,
    sdk_version: sdkVersion,
    host: HOST,
    ...sdkIdentity(posthog),
  });
  if (typeof posthog.startExceptionAutocapture === "function") {
    posthog.startExceptionAutocapture({
      capture_unhandled_errors: true,
      capture_unhandled_rejections: true,
      // `installGlobalHandlers` owns console.error so caught errors also carry
      // a stable source and are deduplicated against explicit captures.
      capture_console_errors: false,
    });
    _nativeAutocaptureActive = true;
  } else {
    diagnostic("warn", "SDK sem autocapture nativo de exceções");
  }

  const pendingEvents = _pendingEvents.splice(0);
  for (const pending of pendingEvents) posthog.capture(pending.event, pending.properties);
  if (pendingEvents.length > 0) {
    diagnostic("debug", "eventos pendentes enviados após init", { count: pendingEvents.length });
  }
  const metrics = (posthog as PostHogWithMetrics).metrics;
  if (metrics?.histogram && _pendingMetrics.length > 0) {
    const pendingMetrics = _pendingMetrics.splice(0);
    for (const pending of pendingMetrics) {
      metrics.histogram(pending.name, pending.value, {
        unit: "ms",
        attributes: pending.attributes,
      });
    }
    diagnostic("debug", "métricas pendentes enviadas após init", { count: pendingMetrics.length });
  }
  const pendingRuntimeLogs = _pendingRuntimeLogs.splice(0);
  for (const pending of pendingRuntimeLogs) {
    log(pending.level, "runtime incident", pending.attributes);
  }
  if (pendingRuntimeLogs.length > 0) {
    diagnostic("debug", "incidentes de runtime pendentes enviados após init", {
      count: pendingRuntimeLogs.length,
    });
  }
  const appOpened = posthog.capture(
    "app_opened",
    {
      platform: Platform.isDesktop ? "desktop" : "web",
      os: osName(),
      app_version: version,
      // Explícito em vez de depender só do `register()` acima: o evento
      // inicial é o mais consultado para saber qual SDK está em campo, e não
      // deve ficar refém de como o SDK aplica super properties.
      sdk_version: sdkVersion,
      locale: $userdata.get<string>(KEYS.OPTIONS.LANGUAGE, "pt"),
      pwa:
        typeof window !== "undefined" && window.matchMedia?.("(display-mode: standalone)").matches,
      window_role: windowRole(),
    },
    { send_instantly: true, transport: "fetch" }
  );
  diagnostic("info", "evento app_opened solicitado ao SDK", {
    ...captureResultDetails(appOpened),
    capture_called: true,
    window_role: windowRole(),
    send_instantly: true,
    ...sdkIdentity(posthog),
  });

  const pendingExceptions = _pendingExceptions.splice(0);
  for (const pending of pendingExceptions)
    posthog.captureException(pending.error, pending.properties);
  if (pendingExceptions.length > 0) {
    diagnostic("debug", "exceções pendentes enviadas após init", {
      count: pendingExceptions.length,
    });
  }

  void flushPendingMainErrors();
  scheduleDomDiagnostic(posthog);
  startResponsivenessMonitor();
}

async function flushPendingMainErrors(): Promise<void> {
  const api = typeof window !== "undefined" ? window.louvorjaApi?.telemetry : undefined;
  if (!api?.getPendingMainErrors) return;
  try {
    const pending = await api.getPendingMainErrors();
    if (!Array.isArray(pending)) return;
    for (const item of pending) {
      if (!item || typeof item !== "object") continue;
      const data = item as Record<string, unknown>;
      const error = new Error(
        typeof data.message === "string" ? data.message : "Electron main process error"
      );
      if (typeof data.name === "string" && data.name) error.name = sanitizeString(data.name);
      if (typeof data.stack === "string" && data.stack) error.stack = sanitizeString(data.stack);
      captureException(error, {
        source: typeof data.source === "string" ? data.source : "electron.main.persisted",
        main_process: true,
        main_error_id: typeof data.id === "string" ? data.id : undefined,
        persisted_after_restart: true,
      });
      if (typeof data.id === "string") await api.ackMainError?.(data.id);
    }
    if (pending.length > 0) {
      diagnostic("info", "erros persistidos do processo principal encaminhados ao SDK", {
        count: pending.length,
        capture_requested: pending.length,
      });
    }
  } catch (error) {
    diagnostic("warn", "falha ao recuperar erros persistidos do processo principal", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function scheduleDomDiagnostic(posthog: PostHog): void {
  if (typeof document === "undefined") return;
  const report = () => {
    const slide = document.querySelector<HTMLElement>("[data-testid='slide-content']");
    const root = document.querySelector("#app");
    const rect = slide?.getBoundingClientRect();
    const style = slide ? getComputedStyle(slide) : null;
    posthog.capture(
      "dom_ready",
      {
        ...baseContext(),
        dom_ready: true,
        has_app_root: !!root,
        has_projection_stage: !!document.querySelector(".projection-stage"),
        has_slide: !!slide,
        has_slide_text: !!slide?.textContent?.trim(),
        slide_text_length: slide?.textContent?.trim().length || 0,
        slide_opacity: style?.opacity ? Number(style.opacity) : undefined,
        slide_visibility: style?.visibility || undefined,
        slide_width: rect ? Math.round(rect.width) : 0,
        slide_height: rect ? Math.round(rect.height) : 0,
      },
      { send_instantly: true, transport: "fetch" }
    );
  };
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => requestAnimationFrame(report));
  } else {
    setTimeout(report, 100);
  }
}

installGlobalHandlers();
setNetworkTimingReporter((timing) => {
  if (!timing.remote) return;
  track("network_request", { ...timing });
  histogram("louvorja.http.client.duration", timing.duration_ms, {
    source: timing.source,
    outcome: timing.outcome,
    window_role: windowRole(),
  });
});
setDatabaseTimingReporter((timing) => {
  const dataset = timing.file.replace(/_\d+$/g, "_:id").slice(0, 100);
  const diagnosticSource =
    timing.source === "error" ||
    timing.source === "stale-memory" ||
    timing.source === "stale-indexeddb";

  // O histograma agrega todas as leituras e é a fonte para percentis e volume.
  // Eventos individuais ficam restritos a degradações reais: registrar cada
  // leitura de rede transformava telemetria de diagnóstico em 72% da cota.
  if (diagnosticSource) track("database_read", { ...timing, dataset });
  histogram("louvorja.database.read.duration", timing.duration_ms, {
    source: timing.source,
    dataset,
  });
});

export default {
  init,
  isEnabled,
  setEnabled,
  resetId,
  track,
  breadcrumb,
  captureException,
  log,
  startPerformance,
  finishPerformance,
  markStart,
  markEnd,
  setRuntimeContext,
  reportRuntimeIncident,
  histogram,
  installVueErrorHandler,
};
