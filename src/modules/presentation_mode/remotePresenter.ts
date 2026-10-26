import Platform from "@/helpers/Platform";
import { usePdfDeck } from "./composables/usePdfDeck";
import { useLiveContent } from "./composables/useLiveContent";
import { usePptxNative } from "./composables/usePptxNative";
import { useLiveZoom } from "./composables/useLiveZoom";
import {
  isPowerPoint,
  livePowerPointPath,
  missingFontNames,
  powerPointInfo,
} from "./composables/usePowerPoint";
import { presentInPresentationMode } from "./composables/openInPresentationMode";
import { screenOn, setScreen } from "./composables/useOutputs";
import $idb from "@/helpers/IndexedDB";
import { DB_TABLE } from "@/constants/DbTables";

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
  scale?: number;
  x?: number;
  y?: number;
  fit?: boolean;
  id?: string;
  on?: boolean;
}

/** Item da Biblioteca de Mídia (só o que a lista do celular precisa). */
interface LibraryRecord {
  id?: unknown;
  name?: unknown;
  path?: unknown;
  type?: unknown;
  addedAt?: unknown;
  pptx?: { source?: unknown } | null;
}

/** Caminho no disco que o modo apresentação abre: o .pptx de origem, ou o próprio arquivo. */
function pathOfRecord(r: LibraryRecord): string | null {
  const src = r.pptx && typeof r.pptx.source === "string" ? r.pptx.source : null;
  if (src) return src;
  const p = typeof r.path === "string" ? r.path : "";
  // Blob, data URL e endereço da web não são arquivos que o módulo abre.
  if (!p || /^(blob|data|https?):/i.test(p)) return null;
  return p;
}

function kindOfRecord(r: LibraryRecord, path: string): string {
  if (isPowerPoint(path)) return "pptx";
  return r.type === "image" || r.type === "video" || r.type === "pdf" ? r.type : "file";
}

async function libraryRecords(): Promise<LibraryRecord[]> {
  try {
    return await $idb.getAll<LibraryRecord>(DB_TABLE.MEDIA_LIBRARY);
  } catch {
    return [];
  }
}

/** O PowerPoint no ar: fontes que faltam e se dá para apresentar com animações. */
function pptxState(native: ReturnType<typeof usePptxNative>) {
  const path = livePowerPointPath.value;
  if (!path) return null;
  // Não pede a conferência daqui: a faixa do PowerPoint no módulo já pede, e
  // um arquivo que falhou seria convertido de novo a cada pergunta do celular.
  const info = powerPointInfo.get(path) ?? null;
  return {
    canNative: native.available.value === true,
    opening: native.opening.value === true,
    checked: !!info,
    missing: missingFontNames(info)
      .slice(0, 20)
      .map((n) => String(n).slice(0, 100)),
    staleFonts: info?.staleFonts === true,
  };
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
        pptx: pptxState(native),
        screen: screenOn.value.main === true,
      });
      return;
    }
    case "files": {
      // A Biblioteca de Mídia, do mais novo ao mais velho, só com o que abre no módulo.
      const items = (await libraryRecords())
        .map((r) => ({ r, path: pathOfRecord(r) }))
        .filter((x): x is { r: LibraryRecord; path: string } => !!x.path && typeof x.r.id === "string")
        .sort((a, b) => (Number(b.r.addedAt) || 0) - (Number(a.r.addedAt) || 0))
        .slice(0, 300)
        .map(({ r, path }) => ({
          id: String(r.id).slice(0, 256),
          name: String(r.name || path.split(/[\\/]/).pop() || "").slice(0, 200),
          kind: kindOfRecord(r, path),
        }));
      respond(data.requestId, { status: "ok", items });
      return;
    }
    case "open": {
      // Tocar no arquivo no celular = abrir no modo apresentação e "Apresentar".
      const id = typeof data.id === "string" ? data.id : "";
      const rec = id ? (await libraryRecords()).find((r) => r.id === id) : undefined;
      const path = rec ? pathOfRecord(rec) : null;
      if (!rec || !path) return respond(data.requestId, { status: "error", error: "not_found" });
      const name = String(rec.name || "").replace(/\.[^.]+$/, "") || undefined;
      presentInPresentationMode(path, name);
      respond(data.requestId, { status: "ok" });
      return;
    }
    case "screen": {
      // Liga ou desliga só a tela principal (o retorno de palco fica como está).
      await setScreen("main", data.on !== false);
      respond(data.requestId, { status: "ok" });
      return;
    }
    case "native": {
      // "Apresentar com animações" e "Encerrar", como na faixa do PowerPoint no PC.
      if (data.on === false) {
        await native.end();
        return respond(data.requestId, { status: "ok" });
      }
      const path = livePowerPointPath.value;
      if (!path) return respond(data.requestId, { status: "error", error: "no_pptx" });
      if (native.active.value) return respond(data.requestId, { status: "ok" });
      const page = deck.active.value ? deck.page.value : 1;
      const ok = await native.start(path, Math.max(0, page - 1));
      respond(data.requestId, ok ? { status: "ok" } : { status: "error", error: "native_failed" });
      return;
    }
    case "slide": {
      const page = Number(data.page);
      const width = Math.min(1600, Math.max(160, Number(data.width) || 320));
      const image = deck.active.value && Number.isInteger(page) ? await deck.renderPage(page, width) : null;
      respond(data.requestId, image ? { status: "ok", image } : { status: "error" });
      return;
    }
    case "zoom": {
      // "Ampliar onde aponto": o laser do celular amplia a imagem ou a página
      // de PDF no ar em volta do dedo, com o zoom que o módulo já tem. O
      // celular recebe o recorte aplicado para pôr o laser no lugar certo.
      const zoom = useLiveZoom();
      // Com o PowerPoint apresentando por cima, ampliar o PDF de baixo não
      // apareceria no telão — e deixaria o zoom ligado quando ele sair.
      if (data.fit === true || !zoom.target.value || native.active.value) {
        zoom.fit();
      } else {
        const clamp = (v: unknown) => {
          const n = Number(v);
          return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.5;
        };
        const scale = Math.min(4, Math.max(1, Number(data.scale) || 2));
        zoom.fit();
        zoom.zoomTo(scale, { x: clamp(data.x), y: clamp(data.y) });
      }
      const z = zoom.current.value;
      respond(data.requestId, {
        status: "ok",
        zoom: z && z.scale > 1 ? { scale: z.scale, cx: z.cx, cy: z.cy } : null,
      });
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
