import type { YTAPI } from "@/types/Media";

const API_SRC = "https://www.youtube.com/iframe_api";

/**
 * Sem internet o script nunca chega e `onYouTubeIframeAPIReady` nunca dispara.
 * Quem espera é uma tela de projeção com a igreja olhando, então ela precisa
 * poder desistir e mostrar outra coisa em vez de ficar em branco para sempre.
 */
const LOAD_TIMEOUT_MS = 8000;

let _pending: Promise<YTAPI> | null = null;

function getYT(): YTAPI | null {
  return (window as unknown as { YT?: YTAPI }).YT ?? null;
}

/**
 * Carrega a IFrame API do YouTube uma vez por janela. Rejeita em falha de rede
 * ou timeout, e nesse caso esquece a promise para que a próxima tentativa —
 * depois que a rede voltar — comece do zero.
 */
export function loadYtApi(): Promise<YTAPI> {
  const ready = getYT();
  if (ready?.Player) return Promise.resolve(ready);
  if (_pending) return _pending;

  _pending = new Promise<YTAPI>((resolve, reject) => {
    let settled = false;
    let tag: HTMLScriptElement | null = null;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      // Uma tag que expirou não é uma tentativa ativa. Mantê-la faria a próxima
      // chamada pular a requisição e expirar de novo, mesmo com a rede recuperada.
      // Se a API já chegou, getYT() continua reaproveitando-a na próxima chamada.
      tag?.remove();
      _pending = null;
      reject(new Error("Timeout ao carregar a API do YouTube"));
    }, LOAD_TIMEOUT_MS);

    const prev = (window as unknown as { onYouTubeIframeAPIReady?: () => void })
      .onYouTubeIframeAPIReady;
    (window as unknown as { onYouTubeIframeAPIReady: () => void }).onYouTubeIframeAPIReady =
      () => {
        if (prev) prev();
        const yt = getYT();
        if (!yt || settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve(yt);
      };

    if (document.querySelector('script[src*="iframe_api"]')) return;

    tag = document.createElement("script");
    tag.src = API_SRC;
    tag.addEventListener("error", () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      tag?.remove();
      _pending = null;
      reject(new Error("Falha ao carregar a API do YouTube"));
    });
    document.head.appendChild(tag);
  });

  return _pending;
}
