/**
 * @category helper-puro — Abre/fecha janelas auxiliares (Projection / Return /
 * Operator) respeitando as preferências do usuário em $userdata.
 *
 * Toda abertura passa por `Projection.ts`, a porta única de janelas: é ela que
 * decide entre `Platform.windows` (Electron) e `window.open` (web/PWA) e mantém
 * o registry por feature. Aqui só ficam as regras de QUAIS janelas abrir.
 *
 * Replica fmMusica + fmMusicaRetorno + fmMusicaOperador do Delphi: ao iniciar
 * uma música, as janelas escolhidas em "Configurações → Slides de Músicas"
 * aparecem automaticamente no monitor preferido.
 */

import Platform from "@/helpers/Platform";
import $userdata from "@/helpers/UserData";
import { PROJECTION_TYPE, PROJECTION_URL } from "@/constants/Projection";
import { KEYS } from "@/constants/UserDataKeys";
import { close as closeWindow, isOpen as isWindowOpen, open as openWindow } from "@/helpers/Projection";

interface DisplaysAPI {
  getPrefs: () => Promise<Record<string, number | string | null>>;
  getPreferred: (feature: string) => Promise<{ id: number } | null>;
}

async function _open(
  route: string,
  feature: string,
  monitorId: number | null,
  fullscreen: boolean,
  alwaysOnTop = false
): Promise<void> {
  await openWindow({ route, feature, monitorId, fullscreen, alwaysOnTop });
}

async function _close(feature: string): Promise<void> {
  await closeWindow(feature);
}

/**
 * Verifica se a janela de projeção de fundo está aberta.
 * Quando está aberta, as demais projeções (música, arquivo, bíblia)
 * renderizam dentro dela, sem abrir janelas separadas.
 */
async function isBackgroundOpen(): Promise<boolean> {
  return await isWindowOpen(PROJECTION_TYPE.BACKGROUND);
}

/**
 * Onde (e se) a janela de uma feature deve abrir.
 *
 * O desktop resolve pelo papel de monitor e devolve o display já reconhecido —
 * se o monitor do papel não está presente, `open` é false e a janela não abre,
 * em vez de cair na tela do operador. No web não há monitor a escolher: basta
 * saber se a feature tem um papel atribuído.
 */
async function _target(feature: string): Promise<{ open: boolean; monitorId: number | null }> {
  const api = (Platform as { displays?: DisplaysAPI }).displays;
  if (Platform.isDesktop && api?.getPreferred) {
    try {
      const pref = await api.getPreferred(feature);
      return { open: !!pref, monitorId: pref?.id ?? null };
    } catch {
      return { open: false, monitorId: null };
    }
  }

  const roles =
    ($userdata.get(KEYS.OPTIONS.DISPLAYS.FEATURE_ROLES, {}) as Record<string, string>) ?? {};
  return { open: !!roles[feature], monitorId: null };
}

/**
 * Abre as janelas auxiliares respeitando as preferências do usuário.
 *
 * Comportamento (replica Delphi):
 * - Pref "musicas" = null ("Mesma janela"): NÃO abre janela separada — o
 *   diálogo do Player na janela principal já mostra o slide.
 * - Pref "musicas" = <monitorId>: abre BrowserWindow no monitor escolhido,
 *   fullscreen ou janela conforme `options.fullscreen`.
 * - "operador" e "retorno" só abrem se `options.open_operator` /
 *   `options.open_return` estiverem habilitados nas configurações.
 */
export async function openProjectionWindows(): Promise<void> {
  if (await isBackgroundOpen()) return;

  const fullscreen = $userdata.get(KEYS.OPTIONS.FULLSCREEN, true) as boolean;
  const alwaysOnTop = $userdata.get(KEYS.OPTIONS.ALWAYS_ON_TOP, true) as boolean;
  const openOperator = $userdata.get(KEYS.OPTIONS.OPEN_OPERATOR, false) as boolean;
  const openReturn = ($userdata.get(KEYS.OPTIONS.OPEN_RETURN, false) as boolean);

  const projection = await _target(PROJECTION_TYPE.MUSIC);
  if (projection.open) {
    await _open(
      PROJECTION_URL.BASE, PROJECTION_TYPE.MUSIC, projection.monitorId, fullscreen, alwaysOnTop
    );
  }

  if (openReturn) {
    const ret = await _target(PROJECTION_TYPE.RETURN);
    if (ret.open) {
      await _open(
        PROJECTION_URL.RETURN, PROJECTION_TYPE.RETURN, ret.monitorId, fullscreen, alwaysOnTop
      );
    }
  }

  if (openOperator) {
    // Operador NÃO usa always-on-top (o operador precisa interagir com a
    // janela principal sem que o overlay roube foco).
    const op = await _target(PROJECTION_TYPE.OPERATOR);
    await _open(PROJECTION_URL.OPERATOR, PROJECTION_TYPE.OPERATOR, op.monitorId, false, false);
  }
}

/**
 * Abre as janelas de projeção de arquivo (imagem/vídeo da liturgia).
 * Usa rotas dedicadas para não interferir com as janelas de música.
 *
 * Se não houver monitor específico para arquivo, usa o mesmo da projeção
 * principal (fallback "Mesma janela" abre na janela atual).
 */
export async function openFileProjectionWindows(): Promise<void> {
  if (await isBackgroundOpen()) return;

  const fullscreen = ($userdata.get(KEYS.OPTIONS.FILE_PROJECTION.FULLSCREEN, true) as boolean);
  const alwaysOnTop = ($userdata.get(KEYS.OPTIONS.FILE_PROJECTION.ALWAYS_ON_TOP, true) as boolean);

  // Projeção de arquivo — cai na configuração de música quando não tem a sua.
  let file = await _target(PROJECTION_TYPE.FILE);
  if (!file.open) file = await _target(PROJECTION_TYPE.MUSIC);
  if (file.open) {
    await _open(PROJECTION_URL.FILE, PROJECTION_TYPE.FILE, file.monitorId, fullscreen, alwaysOnTop);
  }

  // Retorno de arquivo — respeita a opção específica de arquivo
  const openFileReturn = $userdata.get(KEYS.OPTIONS.FILE_PROJECTION.SHOW_RETURN, false) as boolean;
  if (openFileReturn) {
    const ret = await _target(PROJECTION_TYPE.FILE_RETURN);
    if (ret.open) {
      await _open(
        PROJECTION_URL.FILE_RETURN, PROJECTION_TYPE.FILE_RETURN, ret.monitorId,
        fullscreen, alwaysOnTop
      );
    }
  }
}

/**
 * Abre a janela de projeção de Anúncios (reutiliza preferências de arquivo).
 */
export async function openAnnouncementsWindow(): Promise<void> {
  const fullscreen = $userdata.get(KEYS.OPTIONS.FILE_PROJECTION.FULLSCREEN, true) as boolean;
  const alwaysOnTop = $userdata.get(
    KEYS.OPTIONS.FILE_PROJECTION.ALWAYS_ON_TOP,
    true
  ) as boolean;
  let target = await _target(PROJECTION_TYPE.FILE);
  if (!target.open) target = await _target(PROJECTION_TYPE.MUSIC);
  if (target.open) {
    await _open(
      PROJECTION_URL.ANNOUNCEMENTS,
      PROJECTION_TYPE.ANNOUNCEMENTS,
      target.monitorId,
      fullscreen,
      alwaysOnTop
    );
  }
}

export async function closeAnnouncementsWindow(): Promise<void> {
  await _close(PROJECTION_TYPE.ANNOUNCEMENTS);
}

/**
 * Abre janelas de projeção para VÍDEOS ON-LINE (YouTube).
 * Usa a feature "online_video" diretamente, sem passar pelo fallback
 * "file_projection", para não conflitar com a configuração do
 * Player de Áudio/Vídeo (que pode estar em monitor diferente).
 */
export async function openVideoProjectionWindows(): Promise<void> {
  if (await isBackgroundOpen()) return;

  const fullscreen = ($userdata.get(KEYS.OPTIONS.ONLINE_VIDEO_PROJECTION.FULLSCREEN, true) as boolean);
  const alwaysOnTop = ($userdata.get(KEYS.OPTIONS.ONLINE_VIDEO_PROJECTION.ALWAYS_ON_TOP, true) as boolean);

  let video = await _target(PROJECTION_TYPE.ONLINE_VIDEO);
  if (!video.open) video = await _target(PROJECTION_TYPE.MUSIC);
  if (video.open) {
    await _open(PROJECTION_URL.FILE, PROJECTION_TYPE.FILE, video.monitorId, fullscreen, alwaysOnTop);
  }

  const openVideoReturn = $userdata.get(KEYS.OPTIONS.ONLINE_VIDEO_PROJECTION.SHOW_RETURN, false) as boolean;
  if (openVideoReturn) {
    const ret = await _target(PROJECTION_TYPE.ONLINE_VIDEO_RETURN);
    if (ret.open) {
      await _open(
        PROJECTION_URL.FILE_RETURN,
        PROJECTION_TYPE.ONLINE_VIDEO_RETURN,
        ret.monitorId,
        fullscreen,
        alwaysOnTop
      );
    }
  }
}

/**
 * Abre especificamente a janela da Bíblia se houver monitor configurado.
 */
export async function openBibleWindow(): Promise<void> {
  if (await isBackgroundOpen()) return;

  let bible = await _target(PROJECTION_TYPE.BIBLE);
  if (!bible.open) bible = await _target(PROJECTION_TYPE.MUSIC);
  const openReturn = ($userdata.get(KEYS.MODULES.BIBLE.SHOW_RETURN, false) as boolean);
  const fullscreen = $userdata.get(KEYS.OPTIONS.FULLSCREEN, true) as boolean;
  const alwaysOnTop = $userdata.get(KEYS.OPTIONS.ALWAYS_ON_TOP, true) as boolean;

  if (bible.open) {
    await _open(PROJECTION_URL.BIBLE, PROJECTION_TYPE.BIBLE, bible.monitorId, fullscreen, alwaysOnTop);
  }

  if (openReturn) {
    const ret = await _target(PROJECTION_TYPE.BIBLE_RETURN);
    if (ret.open) {
      await _open(
        PROJECTION_URL.BIBLE_RETURN,
        PROJECTION_TYPE.BIBLE_RETURN,
        ret.monitorId,
        fullscreen,
        alwaysOnTop
      );
    }
  }
}

/**
 * Abre janelas de projeção de fundo (imagem/vídeo do módulo Projeção de Fundo).
 * Fullscreen, sem alwaysOnTop. Usa o monitor primário configurado nas
 * preferências de projeção (KEY_OPTIONS_MONITOR_PRIMARY). Se nenhum monitor
 * estiver configurado, não projeta.
 */
export async function openBackgroundProjectionWindows(): Promise<void> {
  const background = await _target(PROJECTION_TYPE.BACKGROUND);
  if (background.open) {
    await _open(
      PROJECTION_URL.BACKGROUND, PROJECTION_TYPE.BACKGROUND, background.monitorId, true, false
    );
  }

  const showReturn = $userdata.get(KEYS.MODULES.BACKGROUND_PROJECTION.SHOW_RETURN, false) as boolean;
  if (showReturn) {
    const ret = await _target(PROJECTION_TYPE.BACKGROUND_RETURN);
    if (ret.open) {
      await _open(
        PROJECTION_URL.BACKGROUND_RETURN,
        PROJECTION_TYPE.BACKGROUND_RETURN,
        ret.monitorId,
        true,
        false
      );
    }
  }
}

/**
 * Fecha as janelas de projeção de fundo.
 */
export async function closeBackgroundProjectionWindows(): Promise<void> {
  await Promise.all([
    _close(PROJECTION_TYPE.BACKGROUND),
    _close(PROJECTION_TYPE.BACKGROUND_RETURN),
  ]);
}

/**
 * Fecha todas as janelas auxiliares abertas pela media.
 */
export async function closeProjectionWindows(): Promise<void> {
  await Promise.all([
    _close(PROJECTION_TYPE.MUSIC),
    _close(PROJECTION_TYPE.OPERATOR),
    _close(PROJECTION_TYPE.RETURN),
    _close(PROJECTION_TYPE.BIBLE),
    _close(PROJECTION_TYPE.BIBLE_RETURN),
    _close(PROJECTION_TYPE.FILE),
    _close(PROJECTION_TYPE.FILE_RETURN),
    _close(PROJECTION_TYPE.ONLINE_VIDEO),
    _close(PROJECTION_TYPE.ONLINE_VIDEO_RETURN),
  ]);
}

export async function closeBibleWindows(): Promise<void> {
  await Promise.all([
    _close(PROJECTION_TYPE.BIBLE),
    _close(PROJECTION_TYPE.BIBLE_RETURN),
  ]);
}

export default { openProjectionWindows, closeProjectionWindows, closeBibleWindows, openBibleWindow, openFileProjectionWindows, openAnnouncementsWindow, closeAnnouncementsWindow, openVideoProjectionWindows, openBackgroundProjectionWindows, closeBackgroundProjectionWindows };
