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
import $appdata from "@/helpers/AppData";
import { isProgressiveUrl } from "@/helpers/OnlineVideo";
import { PROJECTION_TYPE, PROJECTION_URL } from "@/constants/Projection";
import { KEYS } from "@/constants/UserDataKeys";
import { close as closeWindow, isOpen as isWindowOpen, open as openWindow } from "@/helpers/Projection";
import { roleOfFeature } from "@/helpers/DisplayRoles";
import WebRoles from "@/helpers/projection/WebRoles";

interface DisplaysAPI {
  getPrefs: () => Promise<Record<string, number | string | null>>;
  getPreferred: (feature: string) => Promise<{ id: number } | null>;
}

async function _open(
  route: string,
  feature: string,
  monitorId: number | string | null,
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

  // Papel da feature: escolha explícita do usuário ou o padrão do módulo.
  // Exigir escolha explícita fazia a projeção nunca abrir para quem só
  // atribuiu o monitor ao papel, que é o caminho normal.
  const chosen =
    ($userdata.get(KEYS.OPTIONS.DISPLAYS.FEATURE_ROLES, {}) as Record<string, string>) ?? {};
  const role = feature in chosen ? chosen[feature] : roleOfFeature(feature);
  if (!role) return { open: false, monitorId: null };

  // Só abre janela separada se o papel tiver uma tela de fato disponível.
  return { open: !!WebRoles.screenForRole(role), monitorId: null };
}

export type WindowKind = "projection" | "return" | "operator";
/** O que está no ar: música/slides, arquivo (imagem ou vídeo da liturgia) ou vídeo on-line (YouTube). */
export type MediaKind = "music" | "file" | "video";

/**
 * O que o player tem no ar agora. O player embutido do YouTube e o vídeo baixado ou em streaming
 * são "video"; vídeo de arquivo é "file"; o resto é música. Quem abre janela pergunta aqui em vez
 * de supor música: as rotas de música não mostram arquivo nem vídeo.
 */
export function currentMediaKind(): MediaKind {
  const config = KEYS.MODULES.MEDIA.CONFIG;
  const embedded = $appdata.get<boolean>(config.IS_YOUTUBE, false) === true;
  if (!embedded && $appdata.get<boolean>(config.VIDEO_FILE, false) !== true) return "music";
  const source = String($appdata.get<string>(config.AUDIO, "") ?? "");
  const online =
    embedded || source.startsWith("louvorja://onlinevideo/") || isProgressiveUrl(source);
  return online ? "video" : "file";
}

export interface WindowPlan {
  route: string;
  /** Chave da janela no main: a mesma chave nunca abre duas janelas. */
  feature: string;
  /** Features cujo monitor vale para esta janela, em ordem: a primeira com monitor decide. */
  monitors: string[];
  fullscreen: boolean;
  alwaysOnTop: boolean;
}

/**
 * Que janela abrir, e onde, para cada mídia. É a única tabela: a abertura automática ao dar
 * play, o menu do player e o botão "Abrir no monitor" passam por ela, então abrem exatamente
 * a mesma janela. As rotas de música não tocam arquivo nem vídeo — o retorno ficava em
 * "PRÓX 1/0" e a projeção em branco por cima do telão —, por isso cada mídia tem as suas.
 */
export function mediaWindowPlan(kind: WindowKind, media: MediaKind): WindowPlan {
  if (kind === "operator") {
    // O operador precisa interagir com a janela principal: nunca em tela cheia nem no topo.
    return {
      route: PROJECTION_URL.OPERATOR,
      feature: PROJECTION_TYPE.OPERATOR,
      monitors: [PROJECTION_TYPE.OPERATOR],
      fullscreen: false,
      alwaysOnTop: false,
    };
  }

  const { MUSIC, RETURN, FILE, FILE_RETURN, ONLINE_VIDEO, ONLINE_VIDEO_RETURN } = PROJECTION_TYPE;
  const prefs =
    media === "music"
      ? KEYS.OPTIONS
      : media === "file"
        ? KEYS.OPTIONS.FILE_PROJECTION
        : KEYS.OPTIONS.ONLINE_VIDEO_PROJECTION;
  const table: Record<MediaKind, Record<"projection" | "return", Omit<WindowPlan, "fullscreen" | "alwaysOnTop">>> = {
    music: {
      projection: { route: PROJECTION_URL.MUSIC, feature: MUSIC, monitors: [MUSIC] },
      return: { route: PROJECTION_URL.RETURN, feature: RETURN, monitors: [RETURN] },
    },
    // O arquivo e o vídeo on-line usam a mesma rota; a chave do retorno difere porque cada um
    // tem a sua opção de monitor, e o retorno sob demanda tem que repetir a da abertura automática.
    file: {
      projection: { route: PROJECTION_URL.FILE, feature: FILE, monitors: [FILE, MUSIC] },
      return: { route: PROJECTION_URL.FILE_RETURN, feature: FILE_RETURN, monitors: [FILE_RETURN, RETURN] },
    },
    video: {
      projection: { route: PROJECTION_URL.FILE, feature: FILE, monitors: [ONLINE_VIDEO, MUSIC] },
      return: {
        route: PROJECTION_URL.FILE_RETURN,
        feature: ONLINE_VIDEO_RETURN,
        monitors: [ONLINE_VIDEO_RETURN, RETURN],
      },
    },
  };

  return {
    ...table[media][kind],
    fullscreen: $userdata.get(prefs.FULLSCREEN, true) as boolean,
    alwaysOnTop: $userdata.get(prefs.ALWAYS_ON_TOP, true) as boolean,
  };
}

/**
 * Abre uma janela da mídia que está no ar. Automático (ao dar play) ou `explicit` (o operador
 * clicou no menu do player): é a mesma função.
 *
 * Sem monitor para o papel, o automático não abre nada — o operador é a exceção, que sempre abre.
 * Pedido pelo operador, a janela é tentada assim mesmo e o main explica a recusa em vez de o
 * clique parecer morto.
 *
 * O retorno de música (PRÓX/1/0) ocupa o mesmo monitor e não sabe mostrar arquivo nem vídeo:
 * o retorno do arquivo/vídeo entra no lugar dele, e ele sai também quando não há onde pôr o outro.
 *
 * `monitorId` é o monitor que o operador escolheu à mão (o menu do botão "Abrir no monitor");
 * sem ele vale o do papel da janela.
 */
export async function openMediaWindow(
  kind: WindowKind,
  media: MediaKind,
  {
    explicit = false,
    monitorId,
  }: { explicit?: boolean; monitorId?: number | string | null } = {}
): Promise<void> {
  const plan = mediaWindowPlan(kind, media);

  let target: { open: boolean; monitorId: number | null } = { open: false, monitorId: null };
  for (const feature of plan.monitors) {
    target = await _target(feature);
    if (target.open) break;
  }
  const placeable = target.open || explicit || kind === "operator";

  if (kind === "return" && media !== "music") {
    if (placeable || (await isWindowOpen(PROJECTION_TYPE.RETURN))) await _close(PROJECTION_TYPE.RETURN);
  }
  if (!placeable) return;
  await _open(plan.route, plan.feature, monitorId ?? target.monitorId, plan.fullscreen, plan.alwaysOnTop);
}

/** O operador abre com qualquer mídia: ele troca a grade de slides pela prévia do vídeo. */
async function _openOperatorIfEnabled(media: MediaKind): Promise<void> {
  if ($userdata.get(KEYS.OPTIONS.OPEN_OPERATOR, false) as boolean) await openMediaWindow("operator", media);
}

/**
 * O retorno de música que já está na tela não sabe mostrar arquivo nem vídeo: o do arquivo/vídeo
 * é pedido mesmo com a opção de retorno desligada, senão ele ficaria em "PRÓX 1/0" sobre o telão.
 */
async function _wantsMediaReturn(optionOn: boolean): Promise<boolean> {
  return optionOn || (await isWindowOpen(PROJECTION_TYPE.RETURN));
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

  await openMediaWindow("projection", "music");
  if ($userdata.get(KEYS.OPTIONS.OPEN_RETURN, false) as boolean) await openMediaWindow("return", "music");
  await _openOperatorIfEnabled("music");
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

  await openMediaWindow("projection", "file");
  // A opção geral de retorno é o fallback histórico de quem já usava "Abrir Tela de Retorno"
  // antes da configuração específica do player.
  const returnOn =
    ($userdata.get(KEYS.OPTIONS.FILE_PROJECTION.SHOW_RETURN, false) as boolean) ||
    ($userdata.get(KEYS.OPTIONS.OPEN_RETURN, false) as boolean);
  if (await _wantsMediaReturn(returnOn)) await openMediaWindow("return", "file");
  await _openOperatorIfEnabled("file");
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
export async function openVideoProjectionWindows(
  { withOperator = false }: { withOperator?: boolean } = {}
): Promise<void> {
  if (await isBackgroundOpen()) return;

  await openMediaWindow("projection", "video");
  const returnOn = $userdata.get(KEYS.OPTIONS.ONLINE_VIDEO_PROJECTION.SHOW_RETURN, false) as boolean;
  if (await _wantsMediaReturn(returnOn)) await openMediaWindow("return", "video");
  // O vídeo baixado é um arquivo como os da liturgia, e o operador mostra a prévia dele.
  // O player embutido do YouTube não tem o que mostrar ali.
  if (withOperator) await _openOperatorIfEnabled("video");
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

export default { openProjectionWindows, closeProjectionWindows, closeBibleWindows, openBibleWindow, openFileProjectionWindows, openAnnouncementsWindow, closeAnnouncementsWindow, openVideoProjectionWindows, openMediaWindow, mediaWindowPlan, currentMediaKind, openBackgroundProjectionWindows, closeBackgroundProjectionWindows };
