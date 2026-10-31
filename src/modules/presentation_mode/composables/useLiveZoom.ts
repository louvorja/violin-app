import { computed, getCurrentInstance, ref, watch } from "vue";
import Broadcast from "@/helpers/Broadcast";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import {
  clampZoom,
  zoomStyle,
  ZOOM_MAX,
  ZOOM_MIN,
  type ProjectionZoom,
} from "@/helpers/ProjectionZoom";
import { useLiveContent } from "./useLiveContent";
import { usePdfDeck } from "./usePdfDeck";
import { useMonitorRole } from "./useMonitorRole";

/**
 * Zoom da imagem ou da página de PDF que está no ar. O operador amplia no
 * visor (botões, roda do mouse, arrastar, mapa) ou com + − 0; a tela
 * principal e o retorno seguem o mesmo recorte. Trocou de arquivo ou virou a
 * página: volta a 100%.
 */

const STEP = 1.25;

const _zoom = ref<ProjectionZoom | null>(null);
/** Tamanho em pixels da imagem no ar — para o "100%" (tamanho real na tela). */
const _natural = ref<{ url: string; w: number; h: number } | null>(null);
/** Tela principal desconhecida (sem monitor escolhido): o projetor mais comum. */
const DEFAULT_SCREEN = { width: 1920, height: 1080 };
/** Abaixo disso o "100%" quase não amplia: o atalho vira 2×. */
const ACTUAL_MIN = 1.05;
let _installed = false;

function install(): void {
  if (_installed) return;
  _installed = true;
  const live = useLiveContent();
  const deck = usePdfDeck();

  // Outra mídia ou outra página: o recorte antigo não vale mais.
  watch(
    () => {
      const file = live.current.value === "file" ? live.file.value : null;
      if (!file || (file.type !== "image" && file.type !== "pdf")) return null;
      return `${file.playback_id ?? file.url}|${file.type === "pdf" ? deck.page.value : 1}`;
    },
    () => {
      if (_zoom.value) set(null);
    }
  );

  // O tamanho real da imagem, lido uma vez por arquivo.
  watch(
    () =>
      live.current.value === "file" && live.file.value?.type === "image"
        ? live.file.value.url
        : null,
    (url) => {
      if (!url || _natural.value?.url === url) return;
      const img = new Image();
      img.onload = () => {
        if (img.naturalWidth && img.naturalHeight)
          _natural.value = { url, w: img.naturalWidth, h: img.naturalHeight };
      };
      img.src = url;
    },
    { immediate: true }
  );

  // Tela que abriu (ou recarregou) no meio do zoom pede o recorte atual.
  Broadcast.listen((msg) => {
    if (msg.type === BROADCAST_TYPE.REQUEST_FILE_PROJECTION_ZOOM) send();
  });
}

function send(): void {
  const z = _zoom.value;
  Broadcast.send(BROADCAST_TYPE.FILE_PROJECTION_ZOOM, z ? { ...z } : { key: "" });
}

function set(next: ProjectionZoom | null): void {
  _zoom.value = next && next.scale > ZOOM_MIN ? clampZoom(next) : null;
  send();
}

export function useLiveZoom() {
  install();
  const live = useLiveContent();
  const deck = usePdfDeck();

  /** A mídia que aceita zoom agora: imagem ou PDF no ar. */
  const target = computed(() => {
    const file = live.current.value === "file" ? live.file.value : null;
    if (!file || (file.type !== "image" && file.type !== "pdf")) return null;
    return {
      key: file.playback_id ?? file.url,
      page: file.type === "pdf" ? deck.page.value : 1,
      type: file.type as "image" | "pdf",
      url: file.url,
    };
  });

  /** O recorte de agora (o guardado só vale para a mídia e a página de agora). */
  const current = computed<ProjectionZoom | null>(() => {
    const t = target.value;
    const z = _zoom.value;
    return t && z && z.key === t.key && z.page === t.page ? z : null;
  });

  const scale = computed(() => current.value?.scale ?? 1);

  /**
   * Escala do "tamanho real": a foto ajustada à tela principal fica reduzida
   * (ou ampliada); 1/ajuste devolve um pixel da foto a um pixel da tela.
   */
  // Fora de um componente (testes, scripts) não há monitores: vale a tela padrão.
  const screen = getCurrentInstance() ? useMonitorRole("projection").size : ref(null);
  const actualScale = computed<number | null>(() => {
    const t = target.value;
    const n = _natural.value;
    if (t?.type !== "image" || !n || n.url !== t.url) return null;
    const sw = screen.value?.width ?? DEFAULT_SCREEN.width;
    const sh = screen.value?.height ?? DEFAULT_SCREEN.height;
    return 1 / Math.min(sw / n.w, sh / n.h);
  });

  /** O zoom em % do tamanho real quando ele é conhecido (como nos visualizadores); senão, do ajustado. */
  const percent = computed(() => {
    const real = actualScale.value;
    return Math.round((real ? scale.value / real : scale.value) * 100);
  });

  /** O atalho de detalhe: "100%" quando a foto é maior que a tela; senão (ou no PDF), "2×". */
  const detail = computed(() => {
    const real = actualScale.value;
    return real && real > ACTUAL_MIN
      ? { label: "100%", scale: Math.min(ZOOM_MAX, real) }
      : { label: "2×", scale: 2 };
  });

  function base(): ProjectionZoom | null {
    const t = target.value;
    if (!t) return null;
    return current.value ?? { key: t.key, page: t.page, scale: 1, cx: 0.5, cy: 0.5 };
  }

  /** Amplia (fator > 1) ou reduz mantendo parado o ponto `at` (frações do elemento). */
  function zoomBy(factor: number, at?: { x: number; y: number }): void {
    const z = base();
    if (!z) return;
    const nextScale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z.scale * factor));
    if (nextScale === z.scale) return;
    let { cx, cy } = z;
    if (at) {
      // O ponto sob o cursor fica sob o cursor: o centro anda na proporção do zoom.
      const px = z.cx + (at.x - 0.5) / z.scale;
      const py = z.cy + (at.y - 0.5) / z.scale;
      cx = px - (at.x - 0.5) / nextScale;
      cy = py - (at.y - 0.5) / nextScale;
    }
    set({ ...z, scale: nextScale, cx, cy });
  }

  /** Vai direto a uma escala, mantendo parado o ponto `at`. */
  function zoomTo(nextScale: number, at?: { x: number; y: number }): void {
    const z = base();
    if (z && z.scale !== nextScale) zoomBy(nextScale / z.scale, at);
  }

  /** Arrasta o recorte: `dx`/`dy` em frações do visor (arrastar para a direita mostra o que está à esquerda). */
  function panBy(dx: number, dy: number): void {
    const z = current.value;
    if (!z) return;
    set({ ...z, cx: z.cx - dx / z.scale, cy: z.cy - dy / z.scale });
  }

  /** Mapa do recorte: o centro vai para o ponto clicado (frações da imagem inteira). */
  function centerAt(x: number, y: number): void {
    const z = current.value;
    if (!z) return;
    set({ ...z, cx: x, cy: y });
  }

  return {
    target,
    current,
    scale,
    zoomIn: (at?: { x: number; y: number }) => zoomBy(STEP, at),
    zoomOut: (at?: { x: number; y: number }) => zoomBy(1 / STEP, at),
    zoomBy,
    zoomTo,
    fit: () => set(null),
    percent,
    detail,
    /** O atalho de detalhe ("100%" ou "2×"), no ponto `at`. */
    zoomDetail: (at?: { x: number; y: number }) => zoomTo(detail.value.scale, at),
    /** Clique duplo: ajustado → detalhe no ponto; com zoom → ajustado. */
    toggle(at?: { x: number; y: number }): void {
      if (scale.value > 1) set(null);
      else zoomTo(detail.value.scale, at);
    },
    panBy,
    centerAt,
    /** O estilo da mídia nos espelhos do módulo (visor, miniaturas). */
    style: computed(() => zoomStyle(current.value, target.value?.key, target.value?.page ?? 1)),
  };
}

/** Só para testes. */
export function _resetLiveZoom(): void {
  _zoom.value = null;
}
