import { computed, ref } from "vue";
import Platform from "@/helpers/Platform";
import $snackbar from "@/helpers/Snackbar";
import { ICONS } from "@/config/Icons";
import packageJson from "@root/package.json";
import {
  desktopDownloadUrl,
  desktopReleaseUrl,
  detectDesktopDownloadPlatform,
} from "@/helpers/DesktopDownload";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/**
 * Por onde esta pessoa deve instalar: o app desktop em Windows/macOS/Linux, o
 * PWA nos demais sistemas, nenhum se já estiver no app. Todo convite do
 * produto decide por aqui, para não divergir entre telas.
 */
export type InstallChannel = "desktop" | "pwa" | "none";

/** Como o navegador atual instala o PWA — define o passo a passo mostrado. */
export type InstallKind = "native" | "ios" | "android" | "chromium" | "unsupported";

/** O que o app só faz (bem) instalado — alimenta a explicação do diálogo. */
export type InstallReason = "offline_downloads" | "storage" | "files" | "general";

const SUGGESTED_KEY = "lj:install-suggested";

const installEvent = ref<BeforeInstallPromptEvent | null>(null);
const installed = ref(isStandalone());
const dialogOpen = ref(false);
const dialogReason = ref<InstallReason>("general");
let listening = false;

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    ["standalone", "fullscreen", "minimal-ui"].some(
      (mode) => window.matchMedia?.(`(display-mode: ${mode})`).matches
    ) || (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function hasDesktopApp(): boolean {
  return typeof navigator !== "undefined" && detectDesktopDownloadPlatform(navigator) !== "other";
}

export function detectInstallKind(
  ua = typeof navigator === "undefined" ? "" : navigator.userAgent,
  maxTouchPoints = typeof navigator === "undefined" ? 0 : navigator.maxTouchPoints
): Exclude<InstallKind, "native"> {
  const isIos = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && maxTouchPoints > 1);
  if (isIos) return "ios";
  if (/Android/i.test(ua)) return /Firefox/i.test(ua) ? "unsupported" : "android";
  if (/Firefox/i.test(ua)) return "unsupported";
  if (/Chrome|Chromium|Edg\//i.test(ua)) return "chromium";
  return "unsupported";
}

/** Escuta o convite nativo do navegador; chamar uma vez no boot da versão web. */
export function initAppInstall(): void {
  if (listening || Platform.isDesktop || hasDesktopApp() || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    installEvent.value = e as BeforeInstallPromptEvent;
  });
  window.addEventListener("appinstalled", () => {
    installed.value = true;
    installEvent.value = null;
    dialogOpen.value = false;
  });
}

function alreadySuggested(): boolean {
  try {
    return localStorage.getItem(SUGGESTED_KEY) === "1";
  } catch {
    return false;
  }
}

export function useAppInstall() {
  const kind = computed<InstallKind>(() => (installEvent.value ? "native" : detectInstallKind()));
  const channel = computed<InstallChannel>(() => {
    if (Platform.isDesktop || installed.value) return "none";
    return hasDesktopApp() ? "desktop" : "pwa";
  });
  const canOffer = computed(() => channel.value !== "none");

  const desktopPlatform = hasDesktopApp() ? detectDesktopDownloadPlatform(navigator) : "other";
  const desktopDownload = {
    platform: desktopPlatform,
    url: desktopDownloadUrl(desktopPlatform, packageJson.version),
    releaseUrl: desktopReleaseUrl(packageJson.version),
    version: packageJson.version,
    direct: desktopPlatform === "windows" || desktopPlatform === "macos",
  };

  function openGuide(reason: InstallReason = "general"): void {
    dialogReason.value = reason;
    dialogOpen.value = true;
  }

  /** Ponto de entrada de todo botão "instalar": o caminho certo para o sistema. */
  async function install(reason: InstallReason = "general"): Promise<void> {
    const ev = channel.value === "pwa" ? installEvent.value : null;
    if (!ev) return openGuide(reason);
    await ev.prompt();
    const { outcome } = await ev.userChoice;
    installEvent.value = null;
    if (outcome === "accepted") dialogOpen.value = false;
  }

  /**
   * Aviso discreto, uma vez só por navegador, no momento em que o recurso
   * que depende da instalação é usado — nunca no boot.
   */
  function suggest(reason: InstallReason, message: string): void {
    if (!canOffer.value || alreadySuggested()) return;
    try {
      localStorage.setItem(SUGGESTED_KEY, "1");
    } catch {
      // sem localStorage o aviso pode repetir; é só um convite
    }
    $snackbar.info(message, {
      key: "app-install",
      icon: ICONS.UI.INSTALL,
      timeout: 10000,
      action: () => void install(reason),
    });
  }

  return {
    channel,
    desktopDownload,
    kind,
    canOffer,
    installed,
    dialogOpen,
    dialogReason,
    openGuide,
    install,
    suggest,
  };
}
