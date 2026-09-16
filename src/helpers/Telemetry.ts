/**
 * Telemetry.ts — observabilidade de uso e diagnóstico via PostHog.
 *
 * Coleta eventos de uso e diagnóstico para permitir investigar falhas sem
 * reproduzir a sessão. A opção de telemetria continua sendo o interruptor
 * único para todo o envio.
 *
 * @category deve-virar-composable — lê e grava preferências via UserData.
 */
import type { CapturedNetworkRequest, LogAttributes, PostHog } from "posthog-js";
import Platform from "@/helpers/Platform";
import $userdata from "@/helpers/UserData";
import { KEYS } from "@/constants/UserDataKeys";
import packageJson from "@root/package.json";

const KEY = import.meta.env.VITE_POSTHOG_KEY ?? "";
const HOST = import.meta.env.VITE_POSTHOG_HOST || "https://us.i.posthog.com";

let _started = false;
let _ph: PostHog | null = null;
let _appVersion = typeof packageJson.version === "string" && packageJson.version ? packageJson.version : "unknown";
let _sdkVersion = "unknown";
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

function baseContext(): Record<string, unknown> {
  return {
    app_version: _appVersion,
    sdk_version: _sdkVersion,
    route: typeof window !== "undefined" ? sanitizeString(`${window.location.pathname}${window.location.hash}`) : "",
    window_role: windowRole(),
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
 * O recorder do Replay é carregado de forma assíncrona pelo SDK. Aguarda a
 * ativação para que o evento inicial não seja capturado antes da gravação.
 * O limite evita bloquear o boot quando CSP, bloqueador ou rede impedirem o
 * carregamento do recorder; nesse caso o evento ainda é enviado com
 * replay_ready=false para diagnóstico.
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
    captureException(new Error(String(data.message || "Electron main process error")), {
      source: data.source || "electron.main",
      stack: data.stack,
    });
  });
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

function windowRole(): "main" | "auxiliary" | "unknown" {
  if (typeof window === "undefined") return "unknown";
  const route = window.location.hash.replace(/^#/, "") || window.location.pathname || "/";
  return AUX_ROUTES.some((aux) => route === aux || route.startsWith(`${aux}/`))
    ? "auxiliary"
    : "main";
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

/** Hosts do backend que podem receber IDs de sessão do PostHog.
 *
 * O SDK exige hostnames (não URLs completas) e só deve anexar os headers às
 * APIs do próprio produto. Assim, arquivos de terceiros, YouTube e links
 * digitados pelo usuário não recebem contexto de rastreamento.
 */
function tracingHosts(): string[] {
  const configured = [
    import.meta.env.VITE_URL_API,
    import.meta.env.VITE_URL_API_FALLBACK,
    import.meta.env.VITE_URL_DATABASE,
    import.meta.env.VITE_URL_FILES,
  ];
  const hosts = new Set<string>();
  for (const value of configured) {
    if (!value) continue;
    try {
      const hostname = new URL(String(value)).hostname;
      if (hostname) hosts.add(hostname);
    } catch {
      // URL inválida não deve impedir o bootstrap do aplicativo.
    }
  }
  return [...hosts];
}

async function appVersion(): Promise<string> {
  const fromEnv = normalizeVersion(import.meta.env.VITE_APP_VERSION);
  if (fromEnv) return fromEnv;
  try {
    const status = (await Platform.updater?.status?.()) as { version?: string } | undefined;
    const installedVersion = normalizeVersion(status?.version);
    if (installedVersion) return installedVersion;
  } catch {
    // Web/PWA não tem updater; segue para a versão canônica empacotada abaixo.
  }
  return normalizeVersion(packageJson.version) || "unknown";
}

/** UUID aleatório por instalação. Não deriva de nada da máquina. */
function anonId(): string {
  let id = $userdata.get<string>(KEYS.OPTIONS.TELEMETRY_ID, "");
  if (!id) {
    id = crypto.randomUUID();
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
    _ph.startSessionRecording();
  }
  else void init();
}

/** Zera o identificador anônimo — o usuário volta a contar como instalação nova. */
export function resetId(): void {
  const id = crypto.randomUUID();
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

export async function init(): Promise<void> {
  if (_started) return;
  if (!KEY || !isEnabled() || Platform.isDev) return;
  const { default: posthog } = await import("posthog-js");
  const version = (await appVersion()) || "unknown";
  _appVersion = version;
  const sdkVersion =
    typeof (posthog as PostHog & { LIB_VERSION?: unknown }).LIB_VERSION === "string"
      ? String((posthog as PostHog & { LIB_VERSION?: unknown }).LIB_VERSION)
      : "unknown";
  _sdkVersion = sdkVersion;
  _started = true;
  _ph = posthog;

  posthog.init(KEY, {
    api_host: HOST,
    // Trava o comportamento padrão do SDK nesta data. Sem isto, atualizar a
    // biblioteca pode ligar sozinha uma captura que este arquivo desligou.
    defaults: "2026-05-30",
    // O distinct_id vem do UserData, então o PostHog não precisa de cookie
    // nem de chave própria no localStorage.
    persistence: "memory",
    bootstrap: { distinctID: anonId() },
    autocapture: true,
    capture_pageview: "history_change",
    capture_pageleave: true,
    capture_exceptions: true,
    error_tracking: {
      captureExtensionExceptions: false,
      exception_steps: { enabled: true, max_bytes: 32_768 },
    },
    disable_session_recording: false,
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
    // Liga traces de Worker/API ao mesmo replay e sessão do renderer, sem
    // vazar IDs do PostHog para hosts arbitrários de mídia.
    tracing_headers: tracingHosts(),
    enable_recording_console_log: true,
    capture_performance: { web_vitals: true, network_timing: true },
    capture_heatmaps: true,
    capture_dead_clicks: true,
    rageclick: true,
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
  posthog.register({ app_version: version, sdk_version: sdkVersion });
  posthog.startExceptionAutocapture({
    capture_unhandled_errors: true,
    capture_unhandled_rejections: true,
    capture_console_errors: true,
  });
  _nativeAutocaptureActive = true;

  const replayReady = await waitForSessionRecording(posthog);
  for (const pending of _pendingEvents.splice(0)) posthog.capture(pending.event, pending.properties);
  posthog.capture("app_opened", {
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
  });
  for (const pending of _pendingExceptions.splice(0)) posthog.captureException(pending.error, pending.properties);
}

installGlobalHandlers();

export default { init, isEnabled, setEnabled, resetId, track, breadcrumb, captureException, log, installVueErrorHandler };
