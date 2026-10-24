import Platform from "@/helpers/Platform";
import { usePdfDeck } from "./composables/usePdfDeck";
import { useLiveContent } from "./composables/useLiveContent";
import { usePptxNative } from "./composables/usePptxNative";

/**
 * Aba Apresentação do controle remoto (`electron/main/httpServer/presenterRoutes.js`):
 * o que está no ar, a imagem de cada slide e a navegação.
 *
 * Anterior/Próximo e a tela preta são as mesmas teclas do passador, para valer
 * o que já vale no computador: com o modo apresentação à vista, a fila dele
 * (página do PDF, próximo arquivo da pasta, PowerPoint com animações); fora
 * dele, o player de músicas. Ir a um slide e início/fim usam o PDF no ar.
 */

interface PresenterRequest {
  requestId?: string;
  action?: string;
  nav?: string;
  page?: number;
  width?: number;
}

function respond(requestId: string | undefined, payload: Record<string, unknown>): void {
  if (!requestId) return;
  const api = Platform.httpServer as { respond?: (id: string, p: unknown) => boolean } | null;
  if (!api?.respond?.(requestId, payload)) console.warn("[http:presenter] resposta descartada", requestId);
}

/** Tecla para os atalhos do app, como o /api/keyboard faz. */
function key(name: string): void {
  window.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }));
}

/** Identifica o PDF no ar, para o celular trocar as imagens quando ele muda. */
function revOf(url: string | null): string {
  if (!url) return "";
  let h = 0;
  for (let i = 0; i < url.length; i++) h = (Math.imul(31, h) + url.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export async function handlePresenterHttp(data: PresenterRequest): Promise<void> {
  const deck = usePdfDeck();
  const live = useLiveContent();
  const native = usePptxNative();

  switch (data?.action) {
    case "state": {
      const active = deck.active.value;
      respond(data.requestId, {
        status: "ok",
        title: String(live.title.value || "").slice(0, 500),
        kind: live.current.value ?? null,
        page: active ? deck.page.value : 0,
        total: active ? deck.total.value : 0,
        aspect: active ? deck.aspect.value : 16 / 9,
        rev: active ? revOf(deck.url.value) : "",
        native: native.active.value,
        black: native.state.value.black === true,
      });
      return;
    }
    case "slide": {
      const page = Number(data.page);
      const width = Math.min(1600, Math.max(160, Number(data.width) || 320));
      const image = deck.active.value && Number.isInteger(page) ? await deck.renderPage(page, width) : null;
      respond(data.requestId, image ? { status: "ok", image } : { status: "error" });
      return;
    }
    case "nav": {
      switch (data.nav) {
        case "next":
          key("ArrowRight");
          return;
        case "prev":
          key("ArrowLeft");
          return;
        case "black":
          if (native.active.value) void native.toggleBlack();
          else key("b");
          return;
        case "first":
          if (deck.active.value) deck.goTo(1);
          else key("Home");
          return;
        case "last":
          if (deck.active.value) deck.goTo(deck.total.value);
          else key("End");
          return;
        case "goto":
          if (deck.active.value && Number.isInteger(data.page)) deck.goTo(Number(data.page));
          return;
      }
    }
  }
}
