/**
 * Telemetry.ts — métricas de uso agregadas via PostHog.
 *
 * Coleta apenas o suficiente para dimensionar o público: quantas instalações
 * ativas, em qual plataforma, SO, versão e idioma. Nenhum evento carrega
 * conteúdo projetado (música, versículo, coletânea) — ver `property_denylist`
 * e `autocapture: false` abaixo.
 *
 * @category deve-virar-composable — lê e grava preferências via UserData.
 */
import posthog from "posthog-js";
import Platform from "@/helpers/Platform";
import $userdata from "@/helpers/UserData";
import { KEYS } from "@/constants/UserDataKeys";

const KEY = import.meta.env.VITE_POSTHOG_KEY ?? "";
const HOST = import.meta.env.VITE_POSTHOG_HOST ?? "https://us.i.posthog.com";

let _started = false;

/**
 * Projeção, retorno, OBS, operador e popups rodam o mesmo `main.js`. Sem este
 * filtro, cada monitor aberto durante um culto viraria uma instalação a mais.
 */
function isMainWindow(): boolean {
  if (typeof window === "undefined") return false;
  const hash = window.location.hash.replace(/^#/, "");
  return hash === "" || hash === "/";
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
  return $userdata.get<boolean>(KEYS.OPTIONS.TELEMETRY, true) !== false;
}

export function setEnabled(enabled: boolean): void {
  $userdata.set(KEYS.OPTIONS.TELEMETRY, enabled);
  if (!enabled) {
    if (_started) posthog.opt_out_capturing();
    return;
  }
  if (_started) posthog.opt_in_capturing({ captureEventName: false });
  else void init();
}

/** Zera o identificador anônimo — o usuário volta a contar como instalação nova. */
export function resetId(): void {
  $userdata.set(KEYS.OPTIONS.TELEMETRY_ID, "");
  if (_started) posthog.reset();
}

export async function init(): Promise<void> {
  if (_started) return;
  if (!KEY || !isMainWindow() || !isEnabled() || Platform.isDev) return;
  _started = true;

  posthog.init(KEY, {
    api_host: HOST,
    // O distinct_id vem do UserData, então o PostHog não precisa de cookie
    // nem de chave própria no localStorage.
    persistence: "memory",
    bootstrap: { distinctID: anonId() },
    // Sem captura automática: cliques e pageviews arrastariam títulos de
    // música e referências bíblicas para dentro dos eventos.
    autocapture: false,
    capture_pageview: false,
    capture_pageleave: false,
    disable_session_recording: true,
    disable_surveys: true,
    advanced_disable_flags: true,
    // O UA cru é o campo mais identificável do lote e é redundante com
    // $os/$browser/$device_type, que o PostHog já deriva dele. O resto são
    // URLs — inúteis aqui, porque a telemetria só roda na janela principal.
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

  // O `opt_out_capturing` abaixo grava uma flag própria no localStorage que
  // sobrevive ao reload. Sem reconciliar aqui, quem desligasse e religasse a
  // opção ficaria sem telemetria para sempre, com o toggle marcado.
  posthog.opt_in_capturing({ captureEventName: false });

  posthog.capture("app_opened", {
    platform: Platform.isDesktop ? "desktop" : "web",
    os: osName(),
    app_version: await appVersion(),
    locale: $userdata.get<string>(KEYS.OPTIONS.LANGUAGE, "pt"),
    pwa: typeof window !== "undefined" && window.matchMedia?.("(display-mode: standalone)").matches,
  });
}

export default { init, isEnabled, setEnabled, resetId };
