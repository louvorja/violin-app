import { ref, watch, onMounted, onUnmounted } from "vue";

export function useContainerSize() {
  const container = ref<HTMLElement | null>(null);
  const width = ref(0);
  const height = ref(0);

  let ro: ResizeObserver | null = null;

  function measure() {
    const el = container.value;
    if (el) {
      width.value = el.offsetWidth;
      height.value = el.offsetHeight;
    }
    // Retry também quando o ref ainda não foi ligado ao DOM (ex: módulo
    // montado antes do layout do ModuleContainer) — evita font-size 0.
    if (width.value <= 0 || height.value <= 0) setTimeout(measure, 100);
  }

  function _attachObserver() {
    if (ro) { ro.disconnect(); ro = null; }
    const el = container.value;
    if (el && typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => measure());
      ro.observe(el);
    }
  }

  // Tamanho proporcional ao menor lado do container (% do menor lado, /2).
  // Se o container ainda não foi medido, usa fallback não-zero para nunca
  // renderizar texto invisível (font-size: 0).
  function fontSizePc(pc: number | string | undefined): number {
    const v = Math.min(width.value, height.value);
    if (v <= 0) return Number(pc) || 50;
    return ((Number(pc) || 50) * v) / 100 / 2;
  }

  // Converte % da ALTURA do container em px — mesma semântica de cqh/vh
  // usada pelos slides (tamanho_letra = % da altura). Fallback 16px enquanto
  // o container não foi medido (measure faz retry a cada 100ms).
  function pctOfHeight(pc: number | string | undefined): number {
    if (height.value <= 0) return 16;
    return ((Number(pc) || 0) / 100) * height.value;
  }

  onMounted(() => {
    measure();
    window.addEventListener("resize", measure);
    _attachObserver();
  });

  watch(container, () => _attachObserver());

  onUnmounted(() => {
    window.removeEventListener("resize", measure);
    if (ro) { ro.disconnect(); ro = null; }
  });

  return { container, width, height, measure, fontSizePc, pctOfHeight };
}
