/**
 * Telemetry.ts — observabilidade de uso e diagnóstico via PostHog.
 *
 * Coleta eventos de uso e diagnóstico para permitir investigar falhas sem
 * reproduzir a sessão. A opção de telemetria continua sendo o interruptor
 * único para todo o envio.
 *
 * @category deve-virar-composable — lê e grava preferências via UserData.
 */
import type { PostHog } from "posthog-js";
import type { CapturedNetworkRequest } from "@posthog/types";
import Platform from "@/helpers/Platform";
import $userdata from "@/helpers/UserData";
import { KEYS } from "@/constants/UserDataKeys";

const KEY = import.meta.env.VITE_POSTHOG_KEY ?? "";
const HOST = import.meta.env.VITE_POSTHOG_HOST || "https://us.i.posthog.com";

let _started = false;
let _ph: PostHog | null = null;
let _installed = false;
const _pendingExceptions: Array<{ error: unknown; properties?: Record<string, unknown> }> = [];
const _breadcrumbs: Array<{ at: string; event: string; properties?: Record<string, unknown> }> = [];
const MAX_BREADCRUMBS = 150;
const MAX_PROPERTY_DEPTH = 6;
const MAX_ARRAY_ITEMS = 100;
const MAX_STRING_LENGTH = 20_000;
const SENSITIVE_KEY = /(password|passwd|secret|token|authorization|cookie|api[-_]?key)/i;

type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";
type PostHogWithLogs = PostHog & {
  logger?: Partial<Record<LogLevel, (_message: string, _attributes?: Record<string, unknown>) => void>>;
  captureLog?: (_record: {
    body: string;
    level: LogLevel;
    attributes?: Record<string, unknown>;
  }) => void;
};

function serializableValue(value: unknown, depth = 0): unknown {
  if (value === undefined) return undefined;
  if (value == null || ["string", "number", "boolean"].includes(typeof value)) {
    return typeof value === "string" ? value.slice(0, MAX_STRING_LENGTH) : value;
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
    route: typeof window !== "undefined" ? `${window.location.pathname}${window.location.hash}` : "",
    window_role: windowRole(),
    online: typeof navigator !== "undefined" ? navigator.onLine : undefined,
    elapsed_ms: typeof performance !== "undefined" ? Math.round(performance.now()) : undefined,
  };
}

function errorProperties(error: unknown): Record<string, unknown> {
  if (error instanceof Error) return { name: error.name, message: error.message, stack: error.stack };
  return { message: String(error) };
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
  _ph?.capture(event, enriched);
}

export function captureException(error: unknown, properties: Record<string, unknown> = {}): void {
  if (!isEnabled()) return;
  const enriched = {
    ...baseContext(),
    ...errorProperties(error),
    ...serializableProperties(properties),
    breadcrumbs: _breadcrumbs.slice(-50),
  };
  if (_ph) _ph.captureException(error, enriched);
  else if (_pendingExceptions.length < 20) _pendingExceptions.push({ error, properties: enriched });
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
  const attributes = { ...baseContext(), ...serializableProperties(properties) };
  const ph = _ph as PostHogWithLogs | null;
  const logger = ph?.logger?.[level];
  if (logger) {
    logger(message.slice(0, MAX_STRING_LENGTH), attributes);
    return;
  }
  if (ph?.captureLog) {
    ph.captureLog({ body: message.slice(0, MAX_STRING_LENGTH), level, attributes });
    return;
  }
  ph?.capture("telemetry_log", { level, message: message.slice(0, MAX_STRING_LENGTH), ...attributes });
}

/** Instala os handlers uma única vez em cada renderer. */
export function installGlobalHandlers(): void {
  if (_installed || typeof window === "undefined") return;
  _installed = true;
  window.addEventListener("error", (event) => captureException(event.error || new Error(event.message), { source: "window.error", filename: event.filename, line: event.lineno, column: event.colno }));
  window.addEventListener("unhandledrejection", (event) => captureException(event.reason, { source: "unhandledrejection" }));
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

async function appVersion(): Promise<string> {
  const fromEnv = import.meta.env.VITE_APP_VERSION;
  if (fromEnv) return String(fromEnv);
  try {
    const status = (await Platform.updater?.status?.()) as { version?: string } | undefined;
    return String(status?.version ?? "");
  } catch {
    return "";
  }
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
    _ph?.opt_out_capturing();
    return;
  }
  if (_ph) _ph.opt_in_capturing({ captureEventName: false });
  else void init();
}

/** Zera o identificador anônimo — o usuário volta a contar como instalação nova. */
export function resetId(): void {
  $userdata.set(KEYS.OPTIONS.TELEMETRY_ID, "");
  _ph?.reset();
}

export async function init(): Promise<void> {
  if (_started) return;
  if (!KEY || !isEnabled() || Platform.isDev) return;
  const { default: posthog } = await import("posthog-js");
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
    capture_pageview: true,
    capture_pageleave: true,
    disable_session_recording: false,
    session_recording: {
      // Inputs continuam mascarados; textos e ações do produto são úteis
      // para entender o caminho que levou ao erro.
      maskAllInputs: true,
      // hidden/file fogem ao maskAllInputs padrão e podem carregar token ou
      // caminho local; ocultá-los não reduz a reprodução das ações do usuário.
      blockSelector: 'input[type="hidden"], input[type="file"]',
      // URLs são sempre registradas pelo network recording. O controle remoto
      // ainda aceita instalações antigas com token na query string, portanto
      // redigimos credenciais antes de o valor sair do dispositivo.
      maskCapturedNetworkRequestFn: (request: CapturedNetworkRequest) => {
        if (request?.name) {
          request.name = request.name.replace(
            /([?&](?:token|auth|authorization|api[-_]?key)=)[^&]+/gi,
            "$1[REDACTED]",
          );
        }
        return request;
      },
    },
    logs: {
      serviceName: "louvorja-violin",
      environment: import.meta.env.MODE || "unknown",
      serviceVersion: import.meta.env.VITE_APP_VERSION || "unknown",
    },
    enable_recording_console_log: true,
    capture_performance: { web_vitals: true, network_timing: true },
    capture_heatmaps: true,
    capture_dead_clicks: true,
    rageclick: true,
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

  posthog.capture("app_opened", {
    platform: Platform.isDesktop ? "desktop" : "web",
    os: osName(),
    app_version: await appVersion(),
    locale: $userdata.get<string>(KEYS.OPTIONS.LANGUAGE, "pt"),
    pwa: typeof window !== "undefined" && window.matchMedia?.("(display-mode: standalone)").matches,
    window_role: windowRole(),
  });
  posthog.startExceptionAutocapture({
    capture_unhandled_errors: true,
    capture_unhandled_rejections: true,
    capture_console_errors: true,
  });
  for (const pending of _pendingExceptions.splice(0)) posthog.captureException(pending.error, pending.properties);
}

installGlobalHandlers();

export default { init, isEnabled, setEnabled, resetId, track, breadcrumb, captureException, log, installVueErrorHandler };
