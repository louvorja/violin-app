/**
 * useModuleBodyStyle — Estilos reativos do body de um módulo utilitário.
 *
 * Lê os campos de customização gravados pelo FormatPanel (opção "Personalizar"):
 *   - texto:    font, font_color, font_size
 *   - fundo:    background_color, image, image_opacity, image_fit
 *   - layout:   border_spacing, vertical_align, horizontal_align
 *   - alarme:   alert_color
 *
 * Escuta MODULE_FORMAT_CHANGED e USERDATA_PATCH para refletir ao vivo.
 * Retorna estilos prontos para aplicar no template do módulo.
 *
* Uso:
 *   const { rootStyle, textStyle, alertStyle, bgImage, imageStyle, container } = useModuleBodyStyle("timer");
 */
import { ref, computed, type CSSProperties } from "vue";
import UserData from "@/helpers/UserData";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import { useBroadcastListener } from "@/composables/useBroadcastListener";
import { useContainerSize } from "@/composables/useContainerSize";
import { FONT, resolveFont } from "@/config/Fonts";
import { horizontalTextAlign, moduleCustomizationDefault } from "@/helpers/ModuleFormatting";

export function useModuleBodyStyle(moduleId: string) {
  // Força re-leitura do UserData quando formatação muda.
  const tick = ref(0);

  const { container, fontSizePc } = useContainerSize();

  useBroadcastListener(BROADCAST_TYPE.MODULE_FORMAT_CHANGED, (payload) => {
    const p = payload as { module?: string } | null;
    if (p && p.module === moduleId) tick.value += 1;
  });

  useBroadcastListener(BROADCAST_TYPE.USERDATA_PATCH, (payload) => {
    const p = payload as { path?: string } | null;
    if (p && typeof p.path === "string" && p.path.startsWith(`modules.${moduleId}.`)) {
      tick.value += 1;
    }
  });

  function read<T = unknown>(key: string, fallback: T): T {
    void tick.value;
    const manifestDefault = moduleCustomizationDefault(moduleId, key, fallback);
    const v = UserData.get<T>(`modules.${moduleId}.${key}`, manifestDefault);
    return v == null ? manifestDefault : v;
  }

  const font = computed(() =>
    resolveFont(read<string>("font", ""), FONT.PROJECTION.FALLBACK)
  );
  const font_color = computed(() => read<string>("font_color", "#FFFFFF"));
  const font_size = computed(() => read<number>("font_size", 50));
  const text_shadow = computed(() => read<boolean>("text_shadow", false));
  const text_shadow_color = computed(() => read<string>("text_shadow_color", "#000000"));
  const text_shadow_blur = computed(() => read<number>("text_shadow_blur", 4));
  const alert_color = computed(() => read<string>("alert_color", "#E74C3C"));
  const background_color = computed(() => read<string>("background_color", "#000000"));
  const border_spacing = computed(() => read<number>("border_spacing", 10));
  const vertical_align = computed(() => read<string>("vertical_align", "center"));
  const horizontal_align = computed(() => read<string>("horizontal_align", "center"));
  const image = computed(() => read<string>("image", ""));
  const image_opacity = computed(() => read<number>("image_opacity", 100));
  const image_fit = computed(() => read<string>("image_fit", "cover"));
  const reference_font = computed(() =>
    resolveFont(read<string | null>("reference_font", font.value), font.value, font.value)
  );
  const reference_font_color = computed(() =>
    read<string>("reference_font_color", font_color.value)
  );
  const reference_font_size = computed(() => read<number>("reference_font_size", 10));
  const text_background_enabled = computed(() => read<boolean>("text_background_enabled", false));
  const text_background_color = computed(() =>
    read<string>("text_background_color", "transparent")
  );

  // Alinhamento do conteúdo do body.
  // Módulos usam flex-direction: column, então:
  //   justifyContent → eixo vertical (main axis)
  //   alignItems     → eixo horizontal (cross axis)
  const alignItems = computed(() =>
    horizontal_align.value === "start" ? "flex-start" : horizontal_align.value === "end" ? "flex-end" : "center"
  );
  const justifyContent = computed(() =>
    vertical_align.value === "start" ? "flex-start" : vertical_align.value === "end" ? "flex-end" : "center"
  );

  /** Estilos do container do body (fundo + padding + alinhamento). */
  const rootStyle = computed<CSSProperties>(() => ({
    background: background_color.value,
    padding: `${Number(border_spacing.value) || 10}px`,
    alignItems: alignItems.value,
    justifyContent: justifyContent.value,
  }));

  /** Estilos do texto principal (fonte, cor, tamanho proporcional ao container). */
  const textStyle = computed<CSSProperties>(() => ({
    fontFamily: font.value,
    color: font_color.value,
    fontSize: `${fontSizePc(font_size.value)}px`,
    lineHeight: 1.4,
    textAlign: horizontalTextAlign(horizontal_align.value),
    width: "100%",
    boxSizing: "border-box",
    backgroundColor: text_background_enabled.value
      ? text_background_color.value || "transparent"
      : "transparent",
    ...(text_shadow.value
      ? {
          textShadow: `0 0 ${text_shadow_blur.value || 4}px ${text_shadow_color.value || "#000000"}, 0 0 ${text_shadow_blur.value || 4}px ${text_shadow_color.value || "#000000"}`,
        }
      : {}),
  }));

  /** Estilos da referência/linha auxiliar (data, horário-alvo, etc.). */
  const referenceStyle = computed<CSSProperties>(() => ({
    fontFamily: reference_font.value,
    color: reference_font_color.value,
    fontSize: `${fontSizePc(reference_font_size.value)}px`,
    lineHeight: 1.5,
    textAlign: horizontalTextAlign(horizontal_align.value),
    width: "100%",
    boxSizing: "border-box",
  }));

  /** Cor do alerta (estado de alarme). */
  const alertStyle = computed<CSSProperties>(() => ({ color: alert_color.value }));

  /** Imagem de fundo (opcional). */
  const bgImage = computed(() => image.value || "");

  /** Estilos da imagem de fundo (opacidade + object-fit). */
  const imageStyle = computed<CSSProperties>(() => ({
    opacity: Math.max(0, Math.min(100, image_opacity.value)) / 100,
    objectFit: image_fit.value as CSSProperties["objectFit"],
  }));

  return {
    rootStyle,
    textStyle,
    referenceStyle,
    alertStyle,
    bgImage,
    imageStyle,
    container,
  };
}
