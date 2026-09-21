/**
 * Modo claro/escuro do sistema, como estado reativo.
 *
 * Singleton: um único ouvinte de `prefers-color-scheme` por janela, instalado
 * na primeira leitura e mantido até a janela fechar — é o mesmo ciclo de vida
 * do app, então não há o que desmontar. No Electron o Chromium acompanha o
 * `nativeTheme` (que o app deixa em "system"); na web, o modo do navegador.
 *
 * Sem `matchMedia` (testes em jsdom, ambientes sem DOM) o sistema é tratado
 * como claro, o que devolve o tema padrão em vez de quebrar.
 */

import { ref, type Ref } from "vue";

const DARK_QUERY = "(prefers-color-scheme: dark)";

const systemDark = ref(false);
let listening = false;

function listen(): void {
  if (listening) return;
  listening = true;

  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;

  const media = window.matchMedia(DARK_QUERY);
  systemDark.value = media.matches;
  media.addEventListener("change", (event) => {
    systemDark.value = event.matches;
  });
}

export function useSystemColorScheme(): Ref<boolean> {
  listen();
  return systemDark;
}
