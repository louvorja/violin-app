import "@/bootstrap/compat";
import { getRendererProfile } from "@/bootstrap/rendererProfile";

const profile = getRendererProfile(window.location);
const PRIVATE_REFERENCES_KEY = "lj:private-references-migrated";

// Antes do boot, mas sem poder impedi-lo: com o IndexedDB indisponível o app
// abriria nunca mais, e o protocolo ainda serve os endereços antigos. A leitura
// percorre as tabelas com binário, então só roda de novo se os mapas mudarem.
async function migratePrivateReferencesOnce() {
  try {
    const mappings = await window.louvorjaApi.storage.privatePathMappings();
    const signature = JSON.stringify(mappings);
    if (!mappings?.length || localStorage.getItem(PRIVATE_REFERENCES_KEY) === signature) return;
    const { migratePrivateStorageReferences } = await import("@/helpers/PrivateStorageMigration");
    await migratePrivateStorageReferences(mappings);
    localStorage.setItem(PRIVATE_REFERENCES_KEY, signature);
  } catch (error) {
    console.warn("[main] Referências a arquivos pessoais não migradas:", error);
  }
}
// Antes do primeiro quadro: o iOS 26 tira a cor da barra de status do <body>.
if (profile === "shell") document.body.classList.add("lj-shell-body");
const bootstrap = (async () => {
  if (profile === "shell" && window.louvorjaApi?.storage.privatePathMappings) {
    await migratePrivateReferencesOnce();
  }
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
