/**
 * Arrastar um arquivo .slja para dentro do app e projetá-lo.
 *
 * Vale para a janela principal, no navegador e no Electron. Zonas de soltar dos
 * módulos (biblioteca de mídia, liturgia, fundos) tratam o próprio evento e
 * ganham a precedência; o que sobra aqui é o que cairia sobre o app sem dono —
 * e, sem este handler, o navegador abriria o arquivo no lugar do app e a janela
 * principal sairia do ar no meio do culto.
 */
import { openSlja } from "@/helpers/SljaPlayer";
import $snackbar from "@/helpers/Snackbar";
import { i18nAtual } from "@/i18n";

const SLJA_RE = /\.slja$/i;
const BANNER_ID = "lj-file-drop-hint";

function t(key: string, fallback: string): string {
  const translate = i18nAtual()?.global?.t;
  return translate ? (translate(key) as string) : fallback;
}

function hasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

function showBanner(): void {
  if (document.getElementById(BANNER_ID)) return;
  const banner = document.createElement("div");
  banner.id = BANNER_ID;
  banner.textContent = t("messages.drop_slja_hint", "Solte o arquivo .slja para projetar");
  banner.setAttribute("role", "status");
  banner.style.cssText = [
    "position:fixed",
    "left:50%",
    "bottom:24px",
    "transform:translateX(-50%)",
    "padding:10px 18px",
    "border-radius:var(--lj-ui-radius, 6px)",
    "background:var(--lj-ui-accent, #1d2b45)",
    "color:#fff",
    "font-size:14px",
    "box-shadow:0 4px 16px rgba(0,0,0,.35)",
    "pointer-events:none",
    "z-index:2147483000",
  ].join(";");
  document.body.appendChild(banner);
}

function hideBanner(): void {
  document.getElementById(BANNER_ID)?.remove();
}

let installed = false;

export function installFileDrop(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;

  // Arrastos que começam dentro da página (listas, slides) não trazem "Files".
  window.addEventListener("dragenter", (event) => {
    if (hasFiles(event)) showBanner();
  });
  window.addEventListener("dragover", (event) => {
    // Sem isto o navegador não dispara `drop` e abre o arquivo.
    if (hasFiles(event)) event.preventDefault();
  });
  window.addEventListener("dragleave", (event) => {
    if (event.relatedTarget === null) hideBanner();
  });
  window.addEventListener("dragend", hideBanner);
  window.addEventListener("drop", (event) => {
    hideBanner();
    if (!hasFiles(event)) return;
    // Uma zona de soltar do módulo já cuidou deste arquivo (ela chama
    // `preventDefault` antes de o evento chegar aqui, na fase de bolha).
    if (event.defaultPrevented) return;
    event.preventDefault();

    const files = Array.from(event.dataTransfer?.files ?? []);
    const slja = files.filter((file) => SLJA_RE.test(file.name));
    if (!slja.length) {
      if (files.length) {
        $snackbar.warning(t("messages.drop_slja_invalid", "Só arquivos .slja podem ser abertos aqui."));
      }
      return;
    }
    // Cada música assume a projeção no lugar da anterior; só a última vale.
    void openSlja(slja[slja.length - 1], { origin: "drop" });
  });
}
