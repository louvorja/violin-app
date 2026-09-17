/**
 * Telemetry.ts — observabilidade de uso e diagnóstico via PostHog.
 *
 * Coleta eventos de uso e diagnóstico para permitir investigar falhas sem
 * reproduzir a sessão. A opção de telemetria continua sendo o interruptor
 * único para todo o envio.
 *
 * @category deve-virar-composable — lê e grava preferências via UserData.
 */
import type { CaptureResult, CapturedNetworkRequest, LogAttributes, PostHog, RequestResponse } from "posthog-js";
import Platform from "@/helpers/Platform";
import $userdata from "@/helpers/UserData";
import { fetchWithTimeout, setNetworkTimingReporter } from "@/helpers/Http";
import { KEYS } from "@/constants/UserDataKeys";
import packageJson from "@root/package.json";

const KEY = import.meta.env.VITE_POSTHOG_KEY ?? "";
const HOST = import.meta.env.VITE_POSTHOG_HOST || "https://us.i.posthog.com";
const BUILD_SDK_VERSION = normalizeVersion(import.meta.env.VITE_POSTHOG_SDK_VERSION);

let _started = false;
let _ph: PostHog | null = null;
let _appVersion = typeof packageJson.version === "string" && packageJson.version ? packageJson.version : "unknown";
let _appVersionSource = "package_json_fallback";
let _sdkVersion = BUILD_SDK_VERSION || "unknown";
let _installed = false;
let _nativeAutocaptureActive = false;
const _pendingExceptions: Array<{ error: unknown; properties?: Record<string, unknown> }> = [];
const _pendingEvents: Array<{ event: string; properties: Record<string, unknown> }> = [];
const _breadcrumbs: Array<{ at: string; event: string; properties?: Record<string, unknown> }> = [];
const MAX_BREADCRUMBS = 150;
const MAX_PROPERTY_DEPTH = 6;
const MAX_ARRAY_ITEMS = 100;
const MAX_STRING_LENGTH = 20_000;
const REPLAY_READY_TIMEOUT_MS = 5_000;
const REPLAY_READY_POLL_MS = 100;
const POSTHOG_PROBE_TIMEOUT_MS = 3_500;
const SENSITIVE_KEY = /(password|passwd|secret|token|authorization|cookie|api[-_]?key)/i;
const SENSITIVE_QUERY = /([?&](?:access[-_]?token|refresh[-_]?token|token|auth(?:orization)?|api[-_]?key|client[-_]?secret|secret|password|jwt)=)[^&\s]+/gi;

type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";
type PostHogWithLogs = PostHog & {
  logger?: Partial<Record<LogLevel, (_message: string, _attributes?: Record<string, unknown>) => void>>;
  captureLog?: (_record: {
    body: string;
    level: LogLevel;
    attributes?: Record<string, unknown>;
  }) => void;
};

type PostHogWithReplay = PostHog & {
  sessionRecordingStarted?: () => boolean;
};

type DiagnosticLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

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
function diagnostic(level: DiagnosticLevel, message: string, details: Record<string, unknown> = {}): void {
  const safeMessage = sanitizeString(message);
  const safeDetails = serializableProperties(details);
  try {
    const logger = (console as unknown as Record<DiagnosticLevel, (...args: unknown[]) => void>)[level]
      || console.info;
    logger(`[Telemetry] ${safeMessage}`, safeDetails);
  } catch {
    // O console pode ser substituído por um host de teste ou por uma extensão.
  }
  try {
    if (typeof window !== "undefined") {
      window.louvorjaApi?.telemetry?.log?.({ level, message: safeMessage, details: safeDetails });
    }
  } catch {
    // Telemetria de diagnóstico é best-effort.
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
    const getDistinctId = typeof posthog.get_distinct_id === "function" ? posthog.get_distinct_id() : undefined;
    const getSessionId = typeof posthog.get_session_id === "function" ? posthog.get_session_id() : undefined;
    const deviceId = typeof posthog.get_property === "function" ? posthog.get_property("$device_id") : undefined;
    return {
      capturing: typeof posthog.is_capturing === "function" ? posthog.is_capturing() : undefined,
      loaded: "__loaded" in posthog ? Boolean((posthog as PostHog & { __loaded?: unknown }).__loaded) : undefined,
      distinct_id_suffix: idSuffix(getDistinctId),
      session_id_suffix: idSuffix(getSessionId),
      device_id_suffix: idSuffix(deviceId),
    };
  } catch (error) {
    return { identity_error: error instanceof Error ? sanitizeString(error.message) : String(error) };
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
    route: typeof window !== "undefined" ? sanitizeString(`${window.location.pathname}${window.location.hash}`) : "",
    window_role: windowRole(),
    window_feature: windowFeature(),
    online: typeof navigator !== "undefined" ? navigator.onLine : undefined,
    elapsed_ms: typeof performance !== "undefined" ? Math.round(performance.now()) : undefined,
  };
}

function errorProperties(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return { name: error.name, message: sanitizeString(error.message), stack: error.stack ? sanitizeString(error.stack) : undefined };
  }
  return { message: sanitizeString(String(error)) };
}

function isSessionRecordingStarted(posthog: PostHogWithReplay): boolean {
  try {
    return typeof posthog.sessionRecordingStarted === "function" && posthog.sessionRecordingStarted();
  } catch {
    return false;
  }
}

/**
 * O recorder do Replay é carregado de forma assíncrona pelo SDK. Esta espera
 * só é usada como diagnóstico posterior: o evento inicial não pode depender
 * dela, pois CSP, bloqueador ou rede lenta não devem atrasar o boot.
 */
async function waitForSessionRecording(posthog: PostHog): Promise<boolean> {
  const replay = posthog as PostHogWithReplay;
  if (typeof replay.sessionRecordingStarted !== "function") return false;
  const deadline = Date.now() + REPLAY_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (isSessionRecordingStarted(replay)) return true;
    await new Promise((resolve) => setTimeout(resolve, REPLAY_READY_POLL_MS));
  }
  return isSessionRecordingStarted(replay);
}

/**
 * Verifica somente a alcançabilidade do endpoint de ingestão. Não envia dados
 * nem substitui o SDK; serve para separar no log "evento aceito localmente"
 * de "rede/CSP/firewall não deixa chegar ao PostHog".
 */
async function probePostHog(): Promise<void> {
  if (typeof fetch !== "function") return;
  const startedAt = Date.now();
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timeout = controller ? setTimeout(() => controller.abort(), POSTHOG_PROBE_TIMEOUT_MS) : null;
  try {
    const response = await fetchWithTimeout(`${HOST.replace(/\/$/, "")}/e/`, {
      method: "GET",
      cache: "no-store",
      timeout: POSTHOG_PROBE_TIMEOUT_MS,
      source: "posthog-probe",
      thirdParty: true,
      signal: controller?.signal,
    });
    // GET em /e/ pode responder 404/405 por método, mas isso já prova que o
    // host e o CORS foram alcançados; só a exceção indica bloqueio de rede.
    diagnostic("info", "probe do endpoint PostHog respondeu", {
      status: response.status,
      ok: response.ok,
      reachable: true,
      // /e/ aceita POST; um GET de diagnóstico costuma responder 400/404/405
      // e ainda assim confirma que DNS, TLS, proxy e CSP chegaram ao host.
      method_probe_accepted: response.ok,
      duration_ms: Date.now() - startedAt,
      online: typeof navigator !== "undefined" ? navigator.onLine : undefined,
      access_control_allow_origin: response.headers?.get("access-control-allow-origin") || undefined,
    });
  } catch (error) {
    diagnostic("warn", "endpoint PostHog inacessível", {
      error: error instanceof Error ? error.message : String(error),
      duration_ms: Date.now() - startedAt,
      online: typeof navigator !== "undefined" ? navigator.onLine : undefined,
    });
  } finally {
    if (timeout) clearTimeout(timeout);
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
  _breadcrumbs.push({ at: new Date().toISOString(), event, properties: serializableProperties(properties) });
  if (_breadcrumbs.length > MAX_BREADCRUMBS) _breadcrumbs.splice(0, _breadcrumbs.length - MAX_BREADCRUMBS);
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
  const sanitized = safeError(error);
  const enriched = {
    ...baseContext(),
    ...errorProperties(sanitized),
    ...serializableProperties(properties),
    breadcrumbs: _breadcrumbs.slice(-50),
  };
  if (_ph) _ph.captureException(sanitized, enriched);
  else if (_pendingExceptions.length < 20) _pendingExceptions.push({ error: sanitized, properties: enriched });
}

/** Começa uma medição de duração sem bloquear o fluxo funcional. */
export function startPerformance(name: string, properties: Record<string, unknown> = {}): PerformanceSpan {
  return { name, startedAt: typeof performance !== "undefined" ? performance.now() : Date.now(), properties };
}

/** Registra uma medição agregável no PostHog e devolve a duração em milissegundos. */
export function finishPerformance(span: PerformanceSpan, properties: Record<string, unknown> = {}): number {
  const now = typeof performance !== "undefined" ? performance.now() : Date.now();
  const durationMs = Math.max(0, Math.round(now - span.startedAt));
  track("performance_measurement", {
    measurement: span.name,
    duration_ms: durationMs,
    ...(span.properties || {}),
    ...properties,
  });
  return durationMs;
}

/**
 * Envia um log estruturado para o produto Logs do PostHog.
 *
 * Logs são úteis para transições de mídia de alta cardinalidade (por exemplo,
 * `waiting` → `playing`) sem transformar cada detalhe em uma exceção. O
 * fallback para `capture` mantém compatibilidade com versões antigas do SDK.
 */
export function log(level: LogLevel, message: string, properties: Record<string, unknown> = {}): void {
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
  window.addEventListener("error", (event) => {
    if (_nativeAutocaptureActive) return;
    captureException(event.error || new Error(event.message), { source: "window.error", filename: event.filename, line: event.lineno, column: event.colno });
  });
  window.addEventListener("unhandledrejection", (event) => {
    if (_nativeAutocaptureActive) return;
    captureException(event.reason, { source: "unhandledrejection" });
  });
  window.louvorjaApi?.on?.("telemetry:main-error", (payload) => {
    const data = payload && typeof payload === "object" ? payload as Record<string, unknown> : { message: String(payload) };
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
  window.addEventListener("online", () => diagnostic("info", "renderer voltou a ficar online"));
  window.addEventListener("offline", () => diagnostic("warn", "renderer ficou offline"));
}

export function installVueErrorHandler(app: { config: { errorHandler?: (_err: unknown, _instance: unknown, _info: string) => void } }): void {
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
    _ph?.stopSessionRecording();
    _ph?.opt_out_capturing();
    return;
  }
  if (_ph) {
    _ph.opt_in_capturing({ captureEventName: false });
    _ph.register({ app_version: _appVersion, sdk_version: _sdkVersion });
    if (windowRole() === "main") _ph.startSessionRecording();
  }
  else void init();
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
  const { default: posthog } = await import("posthog-js");
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
    autocapture: isMainWindow,
    capture_pageview: isMainWindow ? "history_change" : false,
    capture_pageleave: true,
    capture_exceptions: true,
    error_tracking: {
      captureExtensionExceptions: false,
      exception_steps: { enabled: true, max_bytes: 32_768 },
    },
    // Cada BrowserWindow tem seu próprio renderer. O Replay fica concentrado
    // na janela do operador; janelas auxiliares continuam enviando eventos e
    // erros, mas não viram sessões pretas do projetor no PostHog.
    disable_session_recording: !isMainWindow,
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
        attributes: record.attributes ? (serializableProperties(record.attributes) as LogAttributes) : undefined,
      }),
    },
    // Não enviar os headers opcionais de tracing para a API do produto. O
    // Worker público não os lista no Access-Control-Allow-Headers; no Electron
    // isso transformava cada GET do banco em preflight rejeitado por CORS.
    // A telemetria continua correlacionada pelos próprios eventos do SDK.
    tracing_headers: [],
    enable_recording_console_log: true,
    capture_performance: { web_vitals: isMainWindow, network_timing: true },
    capture_heatmaps: isMainWindow,
    capture_dead_clicks: isMainWindow,
    rageclick: isMainWindow,
    before_send: (capture) => {
      if (!capture) return null;
      capture.properties = serializableProperties(capture.properties);
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
      capture_console_errors: true,
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
  const replayReady = isSessionRecordingStarted(posthog);
  const appOpened = posthog.capture("app_opened", {
    platform: Platform.isDesktop ? "desktop" : "web",
    os: osName(),
    app_version: version,
    // Explícito em vez de depender só do `register()` acima: o evento
    // inicial é o mais consultado para saber qual SDK está em campo, e não
    // deve ficar refém de como o SDK aplica super properties.
    sdk_version: sdkVersion,
    replay_ready: replayReady,
    locale: $userdata.get<string>(KEYS.OPTIONS.LANGUAGE, "pt"),
    pwa: typeof window !== "undefined" && window.matchMedia?.("(display-mode: standalone)").matches,
    window_role: windowRole(),
  }, { send_instantly: true });
  diagnostic("info", "evento app_opened solicitado ao SDK", {
    ...captureResultDetails(appOpened),
    capture_called: true,
    replay_ready: replayReady,
    window_role: windowRole(),
    send_instantly: true,
    ...sdkIdentity(posthog),
  });
  void probePostHog();

  // O replay é carregado sob demanda. Ele não pode segurar o primeiro evento:
  // em um PC que fecha o app logo após abrir, os 5 s anteriores perdiam toda a
  // sessão. Se o recorder ficar pronto depois, isso também vira evidência no
  // terminal/PostHog sem atrasar o boot.
  void waitForSessionRecording(posthog)
    .then((ready) => {
      if (!ready || replayReady) return;
      posthog.capture("session_replay_ready", {
        ...baseContext(),
        platform: Platform.isDesktop ? "desktop" : "web",
        window_role: windowRole(),
        replay_ready: true,
      }, { send_instantly: true });
      diagnostic("info", "session replay pronto após o boot");
    })
    .catch((error) => diagnostic("warn", "falha ao aguardar session replay", {
      error: error instanceof Error ? error.message : String(error),
    }));
  const pendingExceptions = _pendingExceptions.splice(0);
  for (const pending of pendingExceptions) posthog.captureException(pending.error, pending.properties);
  if (pendingExceptions.length > 0) {
    diagnostic("debug", "exceções pendentes enviadas após init", { count: pendingExceptions.length });
  }

  void flushPendingMainErrors();
  scheduleDomDiagnostic(posthog);
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
      const error = new Error(typeof data.message === "string" ? data.message : "Electron main process error");
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
    if (pending.length > 0) diagnostic("info", "erros persistidos do processo principal enviados", { count: pending.length });
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
    posthog.capture("dom_ready", {
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
    }, { send_instantly: true });
  };
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => requestAnimationFrame(report));
  } else {
    setTimeout(report, 100);
  }
}

installGlobalHandlers();
setNetworkTimingReporter((timing) => {
  if (timing.source === "posthog-probe") return;
  track("network_request", { ...timing });
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
  installVueErrorHandler,
};
