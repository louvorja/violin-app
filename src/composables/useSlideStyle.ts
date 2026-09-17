/**
 * Configurações visuais centralizadas dos slides de música.
 *
 * As views Projection / ProjectionReturn / Operator e o overlay do Player
 * (media/Index.vue) lêem styles deste composable em vez de hardcode.
 *
 * Persistência: `KEYS.OPTIONS.SLIDE.SLIDES.*` (configurável via Formatação).
 *
 * Cada `slide.*` individual ainda pode sobrescrever via campos próprios
 * (ex.: `slide.color`, `slide.font_size_pct`) — fiel ao Delphi onde o
 * editor de slides definia formatação por slide.
 */

import { computed, ref, type ComputedRef, type CSSProperties } from "vue";
import $userdata from "@/helpers/UserData";
import { KEYS } from "@/constants/UserDataKeys";
import { SLIDE_STYLE_DEFAULT } from "@/config/SlideStyle";
import { useBroadcastListener } from "@/composables/useBroadcastListener";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import { FONT, resolveFont } from "@/config/Fonts";
import { getSetting } from "@/helpers/SettingsStorage";

const SLIDE_BG_STORAGE_ID = "slide_custom_background";
const RETURN_BG_TOP_STORAGE_ID = "return_custom_bg_top";
const RETURN_BG_BOTTOM_STORAGE_ID = "return_custom_bg_bottom";

/**
 * Cache da imagem de fundo resolvida a partir do IndexedDB.
 * Blob URLs são efêmeras — não podem ser persistidas em UserData.
 * O binário fica seguro no IndexedDB; aqui criamos a blob URL uma
 * vez por sessão e reutilizamos.
 */
let _slideBgBlobUrl: string | null = null;
let _slideBgResolving = false;
const _slideBgReady = ref(false);

async function _resolveSlideBgFromIdb(): Promise<void> {
  if (_slideBgResolving) return;
  _slideBgResolving = true;
  try {
    const s = await getSetting<any>(SLIDE_BG_STORAGE_ID).catch(() => null);
    if (s?.image) {
      const blob = new Blob([s.image], { type: s.mime || "image/png" });
      if (_slideBgBlobUrl) URL.revokeObjectURL(_slideBgBlobUrl);
      _slideBgBlobUrl = URL.createObjectURL(blob);
    } else {
      if (_slideBgBlobUrl) {
        URL.revokeObjectURL(_slideBgBlobUrl);
        _slideBgBlobUrl = null;
      }
    }
  } finally {
    _slideBgResolving = false;
    _slideBgReady.value = true;
  }
}

let _returnTopBlobUrl: string | null = null;
let _returnBottomBlobUrl: string | null = null;
let _returnBgResolving = false;
const _returnBgReady = ref(false);

async function _resolveReturnBgFromIdb(): Promise<void> {
  if (_returnBgResolving) return;
  _returnBgResolving = true;
  try {
    const [top, bottom] = await Promise.all([
      getSetting<any>(RETURN_BG_TOP_STORAGE_ID).catch(() => null),
      getSetting<any>(RETURN_BG_BOTTOM_STORAGE_ID).catch(() => null),
    ]);
    if (top?.image) {
      const blob = new Blob([top.image], { type: top.mime || "image/png" });
      if (_returnTopBlobUrl) URL.revokeObjectURL(_returnTopBlobUrl);
      _returnTopBlobUrl = URL.createObjectURL(blob);
    } else {
      if (_returnTopBlobUrl) { URL.revokeObjectURL(_returnTopBlobUrl); _returnTopBlobUrl = null; }
    }
    if (bottom?.image) {
      const blob = new Blob([bottom.image], { type: bottom.mime || "image/png" });
      if (_returnBottomBlobUrl) URL.revokeObjectURL(_returnBottomBlobUrl);
      _returnBottomBlobUrl = URL.createObjectURL(blob);
    } else {
      if (_returnBottomBlobUrl) { URL.revokeObjectURL(_returnBottomBlobUrl); _returnBottomBlobUrl = null; }
    }
  } finally {
    _returnBgResolving = false;
    _returnBgReady.value = true;
  }
}

/**
 * Força re-resolução das imagens de fundo do retorno a partir do IndexedDB.
 * Chamado pelo AppMenuOpcoes após salvar/remover imagens.
 */
export function refreshReturnBg(): void {
  _returnBgResolving = false;
  _returnBgReady.value = false;
  void _resolveReturnBgFromIdb();
}

export type SlideOption = Record<string, unknown> | null;

interface SlideStyleAPI {
  cfg:                ComputedRef<SlideCfg>;
  coverStyle:         (slide?: SlideOption) => CSSProperties;
  lyricStyle:         (slide?: SlideOption) => CSSProperties;
  auxStyle:           (slide?: SlideOption) => CSSProperties;
  nextStyle:          (slide?: SlideOption) => CSSProperties;
  bgStyle:            (slide?: SlideOption) => CSSProperties;
  returnTopBgStyle:   () => CSSProperties;
  returnBottomBgStyle:() => CSSProperties;
  rootStyle:          ComputedRef<CSSProperties>;
  repeatColor:        () => string;
  textBoxStyle:       () => CSSProperties;
  textTransform:      ComputedRef<string>;
  returnTopTextTransform:    ComputedRef<string>;
  returnBottomTextTransform: ComputedRef<string>;
}

interface SlideCfg {
  font: string;
  font_size_cover: number;
  font_size_lyric: number;
  font_size_aux: number;
  font_size_next: number;
  color_cover: string;
  color_lyric: string;
  color_repeat: string;
  color_next: string;
  color_aux: string;
  background_color: string;
  background_image: string;
  background_position: string;
  progress_color: string;
  show_progress_bar: boolean;
  show_title_first_slide: boolean;
  text_align: "top" | "center" | "bottom";
  transition_speed_ms: number;
  text_bg_opacity: number;
  text_bg_blur_enabled: boolean;
  text_bg_blur: number;
  text_border_enabled: boolean;
  text_border_color: string;
  text_border_width: number;
  text_border_radius: number;
  affect_external_slides: boolean;
  custom_background_active: boolean;
  shadow_enabled: boolean;
  shadow_color: string;
  shadow_blur: number;
  shadow_offset_x: number;
  shadow_offset_y: number;
  // Fundo da tela de retorno
  custom_return_background_active: boolean;
  return_bg_top_color: string;
  return_bg_top_image: string;
  return_bg_top_position: string;
  return_bg_bottom_color: string;
  return_bg_bottom_image: string;
  return_bg_bottom_position: string;
  // Formatação do retorno
  return_height_bottom: number;
  return_font_size_cover: number;
  return_font_size_lyric: number;
  return_top_text_case: string;
  return_top_text_align: string;
  return_bottom_text_case: string;
  return_bottom_text_align: string;
  custom_return_text_format_active: boolean;
}

/**
 * Lê config do slide combinando:
 *   1. `userdata.options.slides.*` (legado/granular) — base
 *   2. Chaves planas `userdata.options.*` gravadas pela tela "Opções" do AppMenu,
 *      gated por `custom_text_format` e `custom_background` (toggles do Delphi).
 */
const _readSlideOpts = (): SlideCfg => {
  const _numeroNaFaixa = (chave: string, padrao: number, min: number, max: number): number => {
    const n = Number($userdata.get<number>(chave, padrao));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : padrao;
  };

  const legacy = ($userdata.get(KEYS.OPTIONS.SLIDE.SLIDES, {}) as Partial<typeof SLIDE_STYLE_DEFAULT>) ?? {};
  const merged: SlideCfg = { ...SLIDE_STYLE_DEFAULT, ...legacy };

  // text_align e show_title_first_slide são chaves planas globais (sempre aplicam)
  const textAlign = $userdata.get<string>(KEYS.OPTIONS.SLIDE.TEXT_ALIGN, null);
  if (textAlign === "top" || textAlign === "center" || textAlign === "bottom") {
    merged.text_align = textAlign;
  }
  const showTitle = $userdata.get<boolean>(KEYS.OPTIONS.SLIDE.SHOW_TITLE_FIRST_SLIDE, null);
  if (typeof showTitle === "boolean") merged.show_title_first_slide = showTitle;

  // Fonte (chave plana salva pelo select de fonte nas Opções)
  const slideFont = $userdata.get<string>(KEYS.OPTIONS.SLIDE.FONT, null);
  merged.font = resolveFont(slideFont || merged.font, FONT.PROJECTION.FALLBACK);

  // O blur é um atalho global e também pode ser ajustado dentro da formatação personalizada.
  merged.text_bg_blur_enabled =
    $userdata.get<boolean>(KEYS.OPTIONS.SLIDE.TEXT_BG_BLUR_ENABLED, false) === true;
  const textBgBlur = Number($userdata.get<number>(KEYS.OPTIONS.SLIDE.TEXT_BG_BLUR, 12));
  merged.text_bg_blur = Number.isFinite(textBgBlur)
    ? Math.min(30, Math.max(0, textBgBlur))
    : 12;

  // Formatação de texto personalizada
  const customTextFormat =
    $userdata.get<boolean>(KEYS.OPTIONS.SLIDE.CUSTOM_TEXT_FORMAT, false) === true;
  merged.text_border_enabled = false;
  merged.shadow_enabled = false;
  if (customTextFormat) {
    const titleColor = $userdata.get<string>(KEYS.OPTIONS.SLIDE.TITLE_COLOR, null);
    const textColor = $userdata.get<string>(KEYS.OPTIONS.SLIDE.TEXT_COLOR, null);
    const repeatColor = $userdata.get<string>(KEYS.OPTIONS.SLIDE.REPEAT_COLOR, null);
    const auxColor = $userdata.get<string>(KEYS.OPTIONS.SLIDE.AUX_COLOR, null);
    const titleSize = Number($userdata.get<number>(KEYS.OPTIONS.SLIDE.TITLE_SIZE, null) ?? NaN);
    const bodySize = Number($userdata.get<number>(KEYS.OPTIONS.SLIDE.BODY_SIZE, null) ?? NaN);
    const auxSize = Number($userdata.get<number>(KEYS.OPTIONS.SLIDE.AUX_SIZE, null) ?? NaN);
    const textBgOpacity = _numeroNaFaixa(
      KEYS.OPTIONS.SLIDE.TEXT_BG_OPACITY, 75, 0, 100
    );
    const textBorderWidth = Number(
      $userdata.get<number>(KEYS.OPTIONS.SLIDE.TEXT_BORDER_WIDTH, 2)
    );
    if (typeof titleColor === "string") merged.color_cover = titleColor;
    if (typeof textColor === "string") merged.color_lyric = textColor;
    if (typeof repeatColor === "string") merged.color_repeat = repeatColor;
    if (typeof auxColor === "string") merged.color_aux = auxColor;
    if (Number.isFinite(titleSize) && titleSize > 0) merged.font_size_cover = titleSize;
    if (Number.isFinite(bodySize) && bodySize > 0) merged.font_size_lyric = bodySize;
    if (Number.isFinite(auxSize) && auxSize > 0) merged.font_size_aux = auxSize;
    merged.text_bg_opacity = textBgOpacity;
    merged.text_border_enabled =
      $userdata.get<boolean>(KEYS.OPTIONS.SLIDE.TEXT_BORDER_ENABLED, false) === true;
    merged.text_border_color =
      $userdata.get<string>(KEYS.OPTIONS.SLIDE.TEXT_BORDER_COLOR, "#FFFFFF") || "#FFFFFF";
    merged.text_border_width = Number.isFinite(textBorderWidth)
      ? Math.min(10, Math.max(1, textBorderWidth))
      : 2;
    merged.text_border_radius = _numeroNaFaixa(
      KEYS.OPTIONS.SLIDE.TEXT_BORDER_RADIUS, 0, 0, 50
    );
  }

  // Flag global de "afetar slides externos"
  const affectExternal = $userdata.get(KEYS.OPTIONS.SLIDE.AFFECT_EXTERNAL_SLIDES, null);
  if (typeof affectExternal === "boolean") merged.affect_external_slides = affectExternal;

  // Sombra no texto. O interruptor é o mesmo "Formatação de texto personalizada"
  // da tela de Opções — lê-lo fora daquele gate deixava a sombra na projeção
  // depois de o usuário desligar a formatação.
  if (customTextFormat) {
    merged.shadow_enabled =
      $userdata.get<boolean>(KEYS.OPTIONS.SLIDE.SHADOW_ENABLED, false) === true;
  }
  merged.shadow_color =
    $userdata.get<string>(KEYS.OPTIONS.SLIDE.SHADOW_COLOR, "#000000") || "#000000";
  // Number(...) || default descartava o zero que o usuário escolheu: desfoque 0
  // virava 12 e deslocamento 0 virava 2. Zero é valor legítimo nos três.
  merged.shadow_blur = _numeroNaFaixa(KEYS.OPTIONS.SLIDE.SHADOW_BLUR, 12, 0, 30);
  merged.shadow_offset_x = _numeroNaFaixa(KEYS.OPTIONS.SLIDE.SHADOW_OFFSET_X, 0, -20, 20);
  merged.shadow_offset_y = _numeroNaFaixa(KEYS.OPTIONS.SLIDE.SHADOW_OFFSET_Y, 2, -20, 20);

  // Fundo personalizado
  if ($userdata.get(KEYS.OPTIONS.SLIDE.CUSTOM_BACKGROUND, false) as boolean) {
    merged.custom_background_active = true;
    const bgTransparent = $userdata.get<boolean>(KEYS.OPTIONS.SLIDE.BG_TRANSPARENT, false) === true;
    const bgColor = $userdata.get<string>(KEYS.OPTIONS.SLIDE.BG_COLOR, null);
    const bgPos = $userdata.get<string>(KEYS.OPTIONS.SLIDE.BG_POSITION, null);
    merged.background_color = bgTransparent
      ? "transparent"
      : typeof bgColor === "string"
        ? bgColor
        : merged.background_color;
    // Imagem resolvida do IndexedDB (blob URL cacheada em memória).
    // O valor antigo em UserData era uma blob URL efêmera que morria no
    // unmount do painel de Opções; agora o binário mora no IndexedDB e
    // a blob URL é criada uma vez por sessão.
    if (_slideBgBlobUrl) merged.background_image = _slideBgBlobUrl;
    if (typeof bgPos === "string") {
      const map: Record<string, string> = {
        center: "center center",
        cover: "center center",
        contain: "center center",
        stretch: "center center",
        tile: "0 0",
      };
      merged.background_position = map[bgPos] || bgPos;
    }
  } else {
    // Sem fundo personalizado: usa Imagem de Fundo global (única chave global_bg_color)
    const globalBg = $userdata.get<string>("options.global_bg_color", null);
    if (typeof globalBg === "string") merged.background_color = globalBg;
  }

  // Fundo da tela de retorno (independente do fundo dos slides)
  if ($userdata.get(KEYS.OPTIONS.SLIDE.CUSTOM_RETURN_BACKGROUND, false) as boolean) {
    merged.custom_return_background_active = true;
    const topColor = $userdata.get<string>(KEYS.OPTIONS.SLIDE.RETURN_BG_TOP_COLOR, null);
    const bottomColor = $userdata.get<string>(KEYS.OPTIONS.SLIDE.RETURN_BG_BOTTOM_COLOR, null);
    const topPos = $userdata.get<string>(KEYS.OPTIONS.SLIDE.RETURN_BG_TOP_POSITION, null);
    const bottomPos = $userdata.get<string>(KEYS.OPTIONS.SLIDE.RETURN_BG_BOTTOM_POSITION, null);
    if (typeof topColor === "string") merged.return_bg_top_color = topColor;
    if (typeof bottomColor === "string") merged.return_bg_bottom_color = bottomColor;
    if (_returnTopBlobUrl) merged.return_bg_top_image = _returnTopBlobUrl;
    if (_returnBottomBlobUrl) merged.return_bg_bottom_image = _returnBottomBlobUrl;
    if (typeof topPos === "string") {
      const map: Record<string, string> = {
        center: "center center", cover: "center center", contain: "center center",
        stretch: "center center", tile: "0 0",
      };
      merged.return_bg_top_position = map[topPos] || topPos;
    }
    if (typeof bottomPos === "string") {
      const map: Record<string, string> = {
        center: "center center", cover: "center center", contain: "center center",
        stretch: "center center", tile: "0 0",
      };
      merged.return_bg_bottom_position = map[bottomPos] || bottomPos;
    }
  }

  // Formatação de texto do retorno — tamanhos, estilo e alinhamento
  const customReturnText =
    $userdata.get<boolean>(KEYS.OPTIONS.SLIDE.CUSTOM_RETURN_TEXT_FORMAT, false) === true;
  merged.custom_return_text_format_active = customReturnText;
  if (customReturnText) {
    const returnHeightBottom = _numeroNaFaixa(
      KEYS.OPTIONS.SLIDE.RETURN_HEIGHT_BOTTOM,
      SLIDE_STYLE_DEFAULT.return_height_bottom, 8, 50
    );
    const returnCoverSize = _numeroNaFaixa(
      KEYS.OPTIONS.SLIDE.RETURN_FONT_SIZE_COVER,
      SLIDE_STYLE_DEFAULT.return_font_size_cover, 6, 60
    );
    const returnLyricSize = _numeroNaFaixa(
      KEYS.OPTIONS.SLIDE.RETURN_FONT_SIZE_LYRIC,
      SLIDE_STYLE_DEFAULT.return_font_size_lyric, 6, 60
    );
    merged.return_height_bottom = returnHeightBottom;
    merged.return_font_size_cover = returnCoverSize;
    merged.return_font_size_lyric = returnLyricSize;

    // Próximo slide — tamanho do texto no rodapé
    merged.font_size_next = _numeroNaFaixa(
      KEYS.OPTIONS.SLIDE.FONT_SIZE_NEXT,
      SLIDE_STYLE_DEFAULT.font_size_next, 3, 15
    );

    // Topo — estilo e alinhamento
    const topCase = $userdata.get<string>(KEYS.OPTIONS.SLIDE.RETURN_TOP_TEXT_CASE, null);
    const topAlign = $userdata.get<string>(KEYS.OPTIONS.SLIDE.RETURN_TOP_TEXT_ALIGN, null);
    if (typeof topCase === "string") merged.return_top_text_case = topCase;
    if (typeof topAlign === "string") merged.return_top_text_align = topAlign;

    // Rodapé — estilo e alinhamento
    const bottomCase = $userdata.get<string>(KEYS.OPTIONS.SLIDE.RETURN_BOTTOM_TEXT_CASE, null);
    const bottomAlign = $userdata.get<string>(KEYS.OPTIONS.SLIDE.RETURN_BOTTOM_TEXT_ALIGN, null);
    if (typeof bottomCase === "string") merged.return_bottom_text_case = bottomCase;
    if (typeof bottomAlign === "string") merged.return_bottom_text_align = bottomAlign;
  }

  return merged;
};

export function useSlideStyle(): SlideStyleAPI {
  const _tick = ref(0);

  useBroadcastListener(BROADCAST_TYPE.SLIDE_FONT_CHANGED, () => {
    _tick.value += 1;
  });

  // Re resolve imagens de fundo do retorno quando outra janela altera
  // (pick/remove no AppMenuOpcoes da janela principal).
  useBroadcastListener(BROADCAST_TYPE.RETURN_BG_CHANGED, () => {
    refreshReturnBg();
  });

  // Resolve imagem de fundo do IndexedDB na primeira uso (uma vez por sessão).
  if (!_slideBgResolving && !_slideBgReady.value) {
    _resolveSlideBgFromIdb();
  }
  if (!_returnBgResolving && !_returnBgReady.value) {
    _resolveReturnBgFromIdb();
  }

  const cfg = computed(() => {
    void _tick.value;
    void _slideBgReady.value; // dependência reativa — re-avalia quando o IndexedDB resolve
    void _returnBgReady.value;
    // Re-avalia quando o checkbox de fundo personalizado ou retorno é toggleado
    void $userdata.get<boolean>(KEYS.OPTIONS.SLIDE.CUSTOM_BACKGROUND, false);
    void $userdata.get<boolean>(KEYS.OPTIONS.SLIDE.CUSTOM_RETURN_BACKGROUND, false);
    void $userdata.get<boolean>(KEYS.OPTIONS.SLIDE.CUSTOM_RETURN_TEXT_FORMAT, false);
    return _readSlideOpts();
  });

  function _baseFont(slide: SlideOption): string {
    const fromSlide = slide && typeof slide.font === "string" ? slide.font : null;
    return resolveFont(fromSlide, cfg.value.font, cfg.value.font);
  }

  /** Quando affect_external_slides=true, ignora overrides do slide e usa só o cfg. */
  function _pickSize(fromSlide: number | undefined, fromCfg: number): number {
    if (cfg.value.affect_external_slides) return fromCfg;
    return Number(fromSlide) || fromCfg;
  }
  function _pickColor(fromSlide: string | undefined, fromCfg: string): string {
    if (cfg.value.affect_external_slides) return fromCfg;
    return fromSlide || fromCfg;
  }

  function _buildTextShadow(): string | undefined {
    if (!cfg.value.shadow_enabled) return undefined;
    const { shadow_color, shadow_blur, shadow_offset_x, shadow_offset_y } = cfg.value;
    return `${shadow_offset_x}px ${shadow_offset_y}px ${shadow_blur}px ${shadow_color}`;
  }

  function coverStyle(slide?: SlideOption): CSSProperties {
    const sizePct = _pickSize(
      (slide as { font_size_pct?: number })?.font_size_pct,
      cfg.value.font_size_cover
    );
    const color = _pickColor(
      (slide as { color?: string })?.color,
      cfg.value.color_cover
    );
    return {
      fontFamily: _baseFont(slide ?? null),
      fontSize: `clamp(28px, ${sizePct}vh, 200px)`,
      color,
      fontWeight: 700,
      textAlign: "center",
      letterSpacing: "0.02em",
      textShadow: _buildTextShadow() ?? "none",
      lineHeight: 1.3,
      maxWidth: "92vw",
    };
  }

  function lyricStyle(slide?: SlideOption): CSSProperties {
    const sizePct = _pickSize(
      (slide as { font_size_pct?: number })?.font_size_pct,
      cfg.value.font_size_lyric
    );
    const color = _pickColor(
      (slide as { color?: string })?.color,
      cfg.value.color_lyric
    );
    return {
      fontFamily: _baseFont(slide ?? null),
      fontSize: `clamp(28px, ${sizePct}vh, 200px)`,
      color,
      fontWeight: 600,
      textAlign: "center",
      letterSpacing: "0.01em",
      textShadow: _buildTextShadow() ?? "none",
      lineHeight: 1.3,
      maxWidth: "92vw",
    };
  }

  function auxStyle(slide?: SlideOption): CSSProperties {
    const sizePct = _pickSize(
      (slide as { font_size_aux_pct?: number })?.font_size_aux_pct,
      cfg.value.font_size_aux
    );
    const color = _pickColor(
      (slide as { color_aux?: string })?.color_aux,
      cfg.value.color_aux
    );
    return {
      fontFamily: _baseFont(slide ?? null),
      fontSize: `clamp(20px, ${sizePct}vh, 120px)`,
      color,
      fontWeight: 600,
      textAlign: "center",
      textShadow: _buildTextShadow() ?? "none",
      lineHeight: 1.3,
      maxWidth: "92vw",
    };
  }

  function nextStyle(slide?: SlideOption): CSSProperties {
    const sizePct = cfg.value.font_size_next;
    return {
      fontFamily: _baseFont(slide ?? null),
      // O próximo slide vive no painel de retorno, que é um container de
      // consulta menor que a viewport. Calcular em `vh` permite que duas
      // linhas ultrapassem o painel e sejam cortadas pelo overflow.
      // O fator 100/18 preserva a escala configurada historicamente, enquanto
      // o teto reserva espaço para duas linhas de line-height 1.2.
      fontSize: `clamp(14px, min(${sizePct * (100 / 18)}cqh, calc(41.6667cqh - 1px)), 120px)`,
      color: cfg.value.color_next,
      opacity: 0.85,
      fontWeight: 600,
      lineHeight: 1.2,
      textShadow: _buildTextShadow() ?? "0 1px 4px rgba(0,0,0,0.6)",
    };
  }

  function bgStyle(slide?: SlideOption): CSSProperties {
    const slideUrl = (slide as { url_image?: string })?.url_image;
    // Regras (replicando o Delphi):
    //   1. "Fundo personalizado" + "afetar slides externos" → custom vence:
    //      cor sólida ou imagem custom substitui a url_image do slide.
    //      Se bg_image estiver vazio, mostra SÓ a cor (sem imagem do slide).
    //   2. Sem custom OU sem affect_external → usa url_image do slide;
    //      se o slide não tem imagem, cai no background_color global.
    // O bug anterior era exigir background_image truthy na condição —
    // resultado: usuário marcava "Fundo personalizado" + cor preta + imagem
    // vazia e o slide continuava mostrando a capa original da música.
    const customWins =
      cfg.value.affect_external_slides && cfg.value.custom_background_active;
    const url = customWins
      ? cfg.value.background_image // pode ser "" → sem imagem, só a cor
      : slideUrl || cfg.value.background_image || "";
    // Quando custom NÃO vence e o slide tem image_position numérica (0-8 do
    // banco), preserva o posicionamento original do slide.
    let position: string = cfg.value.background_position;
    const slideImagePos = (slide as { image_position?: number | string })?.image_position;
    if (!customWins && typeof slideImagePos === "number") {
      const POSITIONS = [
        "top left", "top center", "top right",
        "center left", "center center", "center right",
        "bottom left", "bottom center", "bottom right",
      ];
      position = POSITIONS[slideImagePos] || position;
    }
    return {
      backgroundImage: url ? `url(${url})` : undefined,
      backgroundSize: "cover",
      backgroundPosition: position,
      backgroundColor: cfg.value.background_color,
      backgroundRepeat: "no-repeat",
    };
  }

  function returnTopBgStyle(): CSSProperties {
    const url = cfg.value.return_bg_top_image || "";
    return {
      backgroundImage: url ? `url(${url})` : undefined,
      backgroundSize: "cover",
      backgroundPosition: cfg.value.return_bg_top_position,
      backgroundColor: cfg.value.return_bg_top_color,
      backgroundRepeat: "no-repeat",
    };
  }

  function returnBottomBgStyle(): CSSProperties {
    const url = cfg.value.return_bg_bottom_image || "";
    return {
      backgroundImage: url ? `url(${url})` : undefined,
      backgroundSize: "cover",
      backgroundPosition: cfg.value.return_bg_bottom_position,
      backgroundColor: cfg.value.return_bg_bottom_color,
      backgroundRepeat: "no-repeat",
    };
  }

  /** Cor para texto repetido (refrão). */
  function repeatColor(): string {
    return cfg.value.color_repeat;
  }

  /** Caixa de texto com fundo, blur do backdrop e borda opcionais. */
  function textBoxStyle(): CSSProperties {
    const backdropFilter = cfg.value.text_bg_blur_enabled
      ? `blur(${cfg.value.text_bg_blur}px)`
      : "none";
    return {
      backgroundColor: `rgba(0, 0, 0, ${cfg.value.text_bg_opacity / 100})`,
      backdropFilter,
      WebkitBackdropFilter: backdropFilter,
      border: cfg.value.text_border_enabled
        ? `${cfg.value.text_border_width}px solid ${cfg.value.text_border_color}`
        : "none",
      borderRadius: cfg.value.text_border_radius
        ? `${cfg.value.text_border_radius}px`
        : undefined,
      boxSizing: "border-box",
    };
  }

  const rootStyle = computed<CSSProperties>(() => ({
    background: cfg.value.background_color,
    transition: `opacity ${cfg.value.transition_speed_ms}ms linear`,
  }));

  const textTransform = computed(() => {
    // O gate é o "Formatação de texto do retorno personalizada" da tela; sem
    // ele o interruptor não controlava nada. O estado desligado continua sendo
    // "uppercase": trocar para "none" mudaria o stage display de quem nunca
    // abriu a opção — ao vivo, no meio de um culto.
    const bruto = $userdata.get(KEYS.OPTIONS.SLIDE.CUSTOM_RETURN_TEXT_FORMAT, false)
      ? String($userdata.get(KEYS.OPTIONS.SLIDE.RETURN_TEXT_CASE, "uppercase"))
      : "uppercase";
    // Valor legado: "normal" não existe em text-transform e era ignorado, então
    // escolher "Normal" não desfazia o caixa alta.
    return bruto === "normal" ? "none" : bruto;
  });

  const _normalizeTextCase = (v: string | null | undefined): string => {
    const raw = v ?? "uppercase";
    return raw === "normal" ? "none" : raw;
  };

  const returnTopTextTransform = computed(() => {
    if (cfg.value.custom_return_text_format_active) {
      return _normalizeTextCase(cfg.value.return_top_text_case);
    }
    return "uppercase";
  });

  const returnBottomTextTransform = computed(() => {
    if (cfg.value.custom_return_text_format_active) {
      return _normalizeTextCase(cfg.value.return_bottom_text_case);
    }
    return "uppercase";
  });

  return { cfg, coverStyle, lyricStyle, auxStyle, nextStyle, bgStyle, returnTopBgStyle, returnBottomBgStyle, rootStyle, repeatColor, textBoxStyle, textTransform, returnTopTextTransform, returnBottomTextTransform };
}
