import { getRendererProfile } from "@/bootstrap/rendererProfile";

const profile = getRendererProfile(window.location);
// Antes do primeiro quadro: o iOS 26 tira a cor da barra de status do <body>.
if (profile === "shell") document.body.classList.add("lj-shell-body");
const bootstrap = (async () => {
  // Na nova abertura aplica código que já está pronto antes de ler/escrever dados.
  // Se a instalação ainda está baixando, abre o app e oferece o aviso persistente.
  if (import.meta.env.PROD && import.meta.env.VITE_TARGET !== "desktop" && !window.louvorjaApi) {
    if (await window.__ljPwaRecovery?.ready) return;
    const initialController = navigator.serviceWorker?.controller;
    void import("@/helpers/PwaUpdates")
      .then(({ startPwaUpdates }) => startPwaUpdates(initialController))
      .catch((error) => {
        console.warn("[main] Não foi possível preparar a atualização:", error);
      });
  }
  return profile === "shell"
    ? import("@/bootstrap/main-shell")
    : import("@/bootstrap/main-auxiliary");
})();

void bootstrap.catch((error) => {
  window.dispatchEvent(new CustomEvent("lj:bootstrap-failed", { detail: error }));
  console.error(`[main] Falha ao carregar bootstrap "${profile}":`, error);
});
