import { getRendererProfile } from "@/bootstrap/rendererProfile";

// Registro e listeners antes dos imports/IndexedDB do boot. O desktop não usa SW.
if (import.meta.env.PROD && import.meta.env.VITE_TARGET !== "desktop" && !window.louvorjaApi) {
  const initialController = navigator.serviceWorker?.controller;
  void import("@/helpers/PwaUpdates").then(({ startPwaUpdates }) =>
    startPwaUpdates(initialController)
  );
}

const profile = getRendererProfile(window.location);
// Antes do primeiro quadro: o iOS 26 tira a cor da barra de status do <body>.
if (profile === "shell") document.body.classList.add("lj-shell-body");
const bootstrap =
  profile === "shell" ? import("@/bootstrap/main-shell") : import("@/bootstrap/main-auxiliary");

void bootstrap.catch((error) => {
  console.error(`[main] Falha ao carregar bootstrap "${profile}":`, error);
});
