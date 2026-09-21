import { getRendererProfile } from "@/bootstrap/rendererProfile";

const profile = getRendererProfile(window.location);
const bootstrap =
  profile === "shell" ? import("@/bootstrap/main-shell") : import("@/bootstrap/main-auxiliary");

void bootstrap.catch((error) => {
  console.error(`[main] Falha ao carregar bootstrap "${profile}":`, error);
});
