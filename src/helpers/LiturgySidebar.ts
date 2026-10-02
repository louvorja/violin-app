import Platform from "@/helpers/Platform";

// Em tela pequena, aparelho de toque ou PWA instalado a liturgia lateral rouba
// a largura das músicas; lá ela só aparece se o operador ligar.
export function liturgySidebarDefault(): boolean {
  if (Platform.isDesktop || typeof window === "undefined") return true;
  const width = window.innerWidth;
  const media = (q: string): boolean => window.matchMedia?.(q).matches === true;
  if (width <= 700) return false;
  if (media("(pointer: coarse)") && width <= 1000) return false;
  if (media("(display-mode: standalone)") || media("(display-mode: window-controls-overlay)"))
    return false;
  return true;
}

