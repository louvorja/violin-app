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
import Telemetry from "@/helpers/Telemetry";
import WebRoles from "@/helpers/projection/WebRoles";
// A mesma lista que o main valida no IPC: duas cópias divergiriam em silêncio.
import { FORWARDABLE_KEYS } from "@root/electron/main/windowKeys.mjs";

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
  // The main process acknowledges `close` only after BrowserWindow `closed`.
  // A same-feature reopen must wait for that acknowledgement instead of
  // reusing a native window that is still in its close animation.
  const pendingClose = _pendingFeatureCloses.get(feature);
  if (pendingClose) await pendingClose;
  await openWindow({ route, feature, monitorId, fullscreen, alwaysOnTop });
}

/**
 * Bandeira: a projeção de URL está no ar?
 *
 * Síncrona de propósito. As setas precisam decidir no mesmo turno de eventos:
 * o `Hotkeys` escuta em `capture` e consome a tecla antes de qualquer IPC
 * responder, então uma consulta assíncrona chegaria tarde demais e a tecla já
 * teria caído na mídia. O preço é a auto-correção, que fica nos dois lados —
 * `forwardSiteKey` repergunta ao main quando a entrega falha, e todo
 * fechamento limpa por aqui.
 */
let _siteActive = false;

/*
 * Fecha a janela de URL e limpa a bandeira.
 *
 * Todo fechamento passa por aqui de propósito: são três caminhos diferentes
 * (fechamento geral, mídia assumindo a tela e pedido do operador) e os três
 * precisam limpar a mesma bandeira — senão as teclas continuariam sendo
 * encaminhadas para uma janela que já não existe.
 */
async function _closeSite(): Promise<void> {
  try {
    // Juntas de propósito: a de retorno só existe se a de projeção existir,
    // e deixar uma órfã manteria a URL na tela depois de "Encerrar projeção".
    // Os loaders vão junto: fechar a projeção tem que revelar uma tela
    // encerrada, não uma tela de loading presa na frente.
    await Promise.all([
      _close(PROJECTION_TYPE.SITE),
      _close(PROJECTION_TYPE.SITE_RETURN),
      _close(PROJECTION_TYPE.SITE_LOADER),
      _close(PROJECTION_TYPE.SITE_LOADER_RETURN),
    ]);
  } finally {
    _siteActive = false;
  }
}

async function _close(feature: string): Promise<void> {
  const pending = _pendingFeatureCloses.get(feature);
  if (pending) return pending;
  const closing = Promise.resolve().then(() => closeWindow(feature));
  _pendingFeatureCloses.set(feature, closing);
  try {
    await closing;
  } finally {
    if (_pendingFeatureCloses.get(feature) === closing) _pendingFeatureCloses.delete(feature);
  }
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
const _musicWindowOpenings = new Set<Promise<void>>();
let _musicWindowGeneration = 0;
const MUSIC_WINDOW_CLOSE_WAIT_MS = 2500;
const _pendingFeatureCloses = new Map<string, Promise<void>>();

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
  /*
   * Mídia e arquivo não são projetados junto com um Site: quem abre a janela
   * de mídia leva a tela. Só aqui, porque todas as janelas de música, arquivo
   * e vídeo online passam por este portão — anúncios e bíblia não passam.
   * A bandeira decide sem IPC: fecha-janela é uma chamada por janela aberta, e
   * este portão atende três delas por projeção.
   */
  if (_siteActive) await _closeSite();
  await _open(plan.route, plan.feature, monitorId ?? target.monitorId, plan.fullscreen, plan.alwaysOnTop);
}

/** O operador abre com qualquer mídia: ele troca a grade de slides pela prévia do vídeo. */
async function _openOperatorIfEnabled(media: MediaKind): Promise<void> {
  if ($userdata.get(KEYS.OPTIONS.OPEN_OPERATOR, false) as boolean) await openMediaWindow("operator", media);
}

/*
 * Cada projeção decide o PRÓPRIO retorno. `options.open_return` (a opção geral
 * de Slides de Músicas) só manda na de música; arquivo e vídeo usam a dele.
 *
 * Um retorno que ficou aberto por outra projeção seria um órfão no telão: com a
 * opção daqui desligada ele é FECHADO em vez de reutilizado — senão o operador
 * veria "PRÓX 1/0" de uma projeção que não está no ar. Ele volta na próxima
 * abertura da projeção dona dele, que é quem liga a própria opção.
 */
async function _wantsMediaReturn(optionOn: boolean): Promise<boolean> {
  if (optionOn) return true;
  if (await isWindowOpen(PROJECTION_TYPE.RETURN)) await _close(PROJECTION_TYPE.RETURN);
  return false;
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
async function _openProjectionWindows(): Promise<void> {
  if (await isBackgroundOpen()) return;

  await openMediaWindow("projection", "music");
  if ($userdata.get(KEYS.OPTIONS.OPEN_RETURN, false) as boolean) await openMediaWindow("return", "music");
  /* Mesma regra do arquivo e do vídeo: retorno de outra projeção vira órfão aqui. */
  else if (await isWindowOpen(PROJECTION_TYPE.RETURN)) await _close(PROJECTION_TYPE.RETURN);
  await _openOperatorIfEnabled("music");
}

export function openProjectionWindows(): Promise<void> {
  ++_musicWindowGeneration;
  const opening = _openProjectionWindows();
  _musicWindowOpenings.add(opening);
  void opening.finally(() => _musicWindowOpenings.delete(opening)).catch(() => {});
  return opening;
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
  /*
   * Só a opção de arquivo. A opção geral `options.open_return` é da música
   * (Slides de Músicas): ligá-la não pode puxar uma tela de retorno para cima
   * de uma projeção de arquivo cuja opção própria está desligada.
   */
  const returnOn = $userdata.get(KEYS.OPTIONS.FILE_PROJECTION.SHOW_RETURN, false) as boolean;
  if (await _wantsMediaReturn(returnOn)) await openMediaWindow("return", "file");
  await _openOperatorIfEnabled("file");
}

/**
 * Abre a janela de projeção de Anúncios (reutiliza preferências de arquivo).
 */
export async function openAnnouncementsWindow(): Promise<boolean> {
  const fullscreen = $userdata.get(KEYS.OPTIONS.FILE_PROJECTION.FULLSCREEN, true) as boolean;
  const alwaysOnTop = $userdata.get(
    KEYS.OPTIONS.FILE_PROJECTION.ALWAYS_ON_TOP,
    true
  ) as boolean;
  let target = await _target(PROJECTION_TYPE.FILE);
  if (!target.open) target = await _target(PROJECTION_TYPE.MUSIC);
  if (!target.open) return false;
  await _open(
    PROJECTION_URL.ANNOUNCEMENTS,
    PROJECTION_TYPE.ANNOUNCEMENTS,
    target.monitorId,
    fullscreen,
    alwaysOnTop
  );
  return isWindowOpen(PROJECTION_TYPE.ANNOUNCEMENTS);
}

export async function closeAnnouncementsWindow(): Promise<void> {
  await _close(PROJECTION_TYPE.ANNOUNCEMENTS);
}

/** A projeção de URL está no ar? Síncrona — ver a bandeira em `_siteActive`. */
export function isSiteProjectionActive(): boolean {
  return _siteActive;
}

/**
 * Esta tecla deve ir para a janela de URL? Devolve a tecla ou null.
 *
 * `null` significa "não é minha" — quem chama não pode nem `preventDefault`:
 * as setas seguem para a mídia, a bíblia ou o navegador como sempre. Por isso
 * as três condições de saída aqui são o que protege o comportamento atual.
 */
export function takeSiteKey(
  e: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey">
): string | null {
  if (!_siteActive) return null;
  /*
   * Sem projeção aberta não há nada a encaminhar — e este é o estado normal
   * na maior parte do tempo, então não loga.
   */
  if (!Platform.isDesktop) return null;
  /*
   * No web/PWA não há porta de envio (janela é popup de outra origem) e as
   * setas seguem o comportamento de sempre. Também sem log, é esperado.
   */
  if (!Platform.windows?.sendKey) return null;
  // Combinação é atalho do app (música anterior/próxima, por exemplo).
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  return FORWARDABLE_KEYS.includes(e.key) ? e.key : null;
}

/**
 * Envia a tecla para a janela de URL.
 *
 * Se a entrega falhar, repergunta ao main se a janela ainda existe em vez de
 * assumir: a bandeira não pode ficar presa engolindo tecla de uma janela que
 * morreu sozinha (macOS fecha com ESC dentro do fullscreen), nem ser apagada
 * por um erro transitório enquanto a janela segue lá.
 */
export async function forwardSiteKey(key: string): Promise<boolean> {
  const send = Platform.windows?.sendKey;
  if (!send) return false;

  // Espelho: a de retorno carrega a MESMA URL em janela independente, então
  // sem receber a tecla ela ficaria parada no slide inicial enquanto a de
  // projeção passa. Fire-and-forget de propósito — não soma latência à tecla,
  // e quando a opção está desligada a janela não existe e o main responde
  // `window`, que aqui NÃO é falha.
  const principal = await send(PROJECTION_TYPE.SITE, key).catch(() => null);
  if (principal?.ok) {
    void send(PROJECTION_TYPE.SITE_RETURN, key).catch(() => {});
    return true;
  }

  // Só o principal manda a bandeira de baixo: é ele que a opção controla.
  _siteActive = await isWindowOpen(PROJECTION_TYPE.SITE);
  return false;
}

/** Fecha a janela de URL e limpa a bandeira. */
export async function closeSiteWindow(): Promise<void> {
  await _closeSite();
}

/** De onde veio o Site que está sendo projetado — só existe estes dois. */
export type SiteProjectionSource = "liturgy" | "canva";

/**
 * Projeta a URL de um item de liturgia do tipo Site.
 *
 * A `route` é a própria URL: o windowFactory carrega direto, fora da SPA e sem
 * o preload do app — um site arbitrário não pode herdar `louvorjaApi`. Reutiliza
 * as preferências de projeção de arquivo (mesma tela, mesma moldura), porque é
 * a projeção mais próxima que existe de "mostrar um documento no telão".
 */
export async function openSiteWindow(
  url: string,
  source: SiteProjectionSource
): Promise<boolean> {
  if (!url) return false;
  const iniciadoEm = Date.now();
  let loader = false;
  let retorno = false;

  try {
    const fullscreen = $userdata.get(KEYS.OPTIONS.FILE_PROJECTION.FULLSCREEN, true) as boolean;
    const alwaysOnTop = $userdata.get(
      KEYS.OPTIONS.FILE_PROJECTION.ALWAYS_ON_TOP,
      true
    ) as boolean;
    /*
     * Monitor preferido do site, se houver; senão o da projeção de arquivo, que
     * é o papel que o operador já associou ao telão. Sem nenhum dos três, null
     * deixa o Projection resolver pelo dele próprio — a janela precisa abrir.
     */
    let target = await _target(PROJECTION_TYPE.SITE);
    if (!target.open) target = await _target(PROJECTION_TYPE.FILE);
    if (!target.open) target = await _target(PROJECTION_TYPE.MUSIC);

    /*
     * O loader nasce ANTES da de Site, no MESMO monitor e com a MESMA moldura:
     * é ele quem tem que estar na tela quando a página externa aparecer.
     */
    loader = await _abrirLoaderSite(
      PROJECTION_TYPE.SITE_LOADER,
      target.monitorId,
      fullscreen,
      alwaysOnTop
    );
    await _open(url, PROJECTION_TYPE.SITE, target.monitorId, fullscreen, alwaysOnTop);
    const aberta = await isWindowOpen(PROJECTION_TYPE.SITE);
    _siteActive = aberta;

    if (aberta) {
      retorno = await _openSiteReturn(url, fullscreen, alwaysOnTop);
      if (loader || retorno) await _aguardarLoadersSite();
    } else {
      /* Sem janela de Site não há o que cobrir: loader órfão só taparia o telão. */
      await _fecharLoadersSite();
    }

    /*
     * O evento único de "site projetado": liturgia e Canva passam por aqui,
     * então é um filtro só para responder quanto isso é usado. Nada de URL,
     * design ou título — só origem, resultado e quanto demorou.
     */
    Telemetry.track("site_projected", {
      source,
      ok: aberta,
      has_loader: loader,
      has_return: retorno,
      duration_ms: Date.now() - iniciadoEm,
    });
    return aberta;
  } catch (error) {
    /* Falha que NUNGA chega ao `report` do Projection — ainda assim é uso. */
    Telemetry.track("site_projected", {
      source,
      ok: false,
      has_loader: loader,
      has_return: retorno,
      duration_ms: Date.now() - iniciadoEm,
      /* Só código: a mensagem pode carregar a URL. */
      reason: (error as { code?: string } | null)?.code || "exception",
    });
    throw error;
  }
}

/**
 * Tela de loading da projeção de Site, no mesmo monitor da janela externa.
 *
 * Só existe no desktop: é o main quem controla o ciclo (abrir, esperar, avisar
 * e fechar) e no web/PWA não há essa porta — lá a página abre num popup e um
 * loader a mais seria só um segundo popup na tela do operador.
 *
 * @returns true se a tela de loading abriu
 */
async function _abrirLoaderSite(
  feature: string,
  monitorId: number | null,
  fullscreen: boolean,
  alwaysOnTop: boolean
): Promise<boolean> {
  if (!window.louvorjaApi?.siteLoader) return false;
  const rota =
    feature === PROJECTION_TYPE.SITE_LOADER_RETURN
      ? PROJECTION_URL.SITE_LOADER_RETURN
      : PROJECTION_URL.SITE_LOADER;
  try {
    await _open(rota, feature, monitorId, fullscreen, alwaysOnTop);
    return await isWindowOpen(feature);
  } catch {
    /* Loading é cortesia: sem ele a projeção de Site segue normal. */
    return false;
  }
}

/**
 * Diz ao main que TODAS as janelas deste ciclo já existem.
 *
 * Só então ele passa a esperar cada uma — antes disso ele estaria adivinhando,
 * e adivinhar erra: a de retorno pode não existir (opção desligada, ou ligada
 * sem monitor). Enquanto ele espera, os loaders seguem cobrindo a tela; se a
 * chamada falhar, os loaders são fechados aqui, porque o main só aciona o
 * timeout DEPOIS de receber este aviso.
 */
async function _aguardarLoadersSite(): Promise<void> {
  try {
    const r = (await window.louvorjaApi?.siteLoader?.aguardar?.()) as
      | { ok?: boolean }
      | undefined;
    if (r?.ok !== false) return;
  } catch {
    /* invoke rejeitou — fecha abaixo em vez de deixar a tela presa. */
  }
  await _fecharLoadersSite();
}

/** Fecha as telas de loading, se alguma existir. */
async function _fecharLoadersSite(): Promise<void> {
  await Promise.all([
    _close(PROJECTION_TYPE.SITE_LOADER),
    _close(PROJECTION_TYPE.SITE_LOADER_RETURN),
  ]);
}

/**
 * Tela de retorno da projeção de URL.
 *
 * É a mesma URL aberta no monitor de retorno, como o arquivo faz com o arquivo
 * — o operador enxerga o que está no telão sem desviar a vista do palco. O
 * monitor segue a mesma cadeia das outras telas de retorno: o do papel do site,
 * senão o da tela de retorno de música. Sem nenhum dos dois, a projeção segue
 * sem retorno em vez de não abrir.
 */
async function _openSiteReturn(
  url: string,
  fullscreen: boolean,
  alwaysOnTop: boolean
): Promise<boolean> {
  if (!$userdata.get(KEYS.OPTIONS.SITE_PROJECTION.SHOW_RETURN, false)) {
    /*
     * Sem a opção, um espelho de uma abertura anterior seria um órfão no monitor
     * de retorno — a URL antiga continuaria no ar. Mesma regra do arquivo/vídeo:
     * fecha em vez de deixar sobrar.
     */
    if (await isWindowOpen(PROJECTION_TYPE.SITE_RETURN)) await _close(PROJECTION_TYPE.SITE_RETURN);
    return false;
  }
  let target = await _target(PROJECTION_TYPE.SITE_RETURN);
  if (!target.open) target = await _target(PROJECTION_TYPE.RETURN);
  if (!target.open) return false;
  /* Mesma ordem do principal: loader primeiro, no mesmo monitor. */
  await _abrirLoaderSite(
    PROJECTION_TYPE.SITE_LOADER_RETURN,
    target.monitorId,
    fullscreen,
    alwaysOnTop
  );
  await _open(url, PROJECTION_TYPE.SITE_RETURN, target.monitorId, fullscreen, alwaysOnTop);
  return isWindowOpen(PROJECTION_TYPE.SITE_RETURN);
}

/**
 * Abre janelas de projeção para VÍDEOS ON-LINE (YouTube).
 * Usa a feature "online_video" diretamente, sem passar pelo fallback
 * "file_projection", para não conflitar com a configuração do
 * Player de Áudio/Vídeo (que pode estar em monitor diferente).
 */
export async function openVideoProjectionWindows(): Promise<void> {
  if (await isBackgroundOpen()) return;

  await openMediaWindow("projection", "video");
  const returnOn = $userdata.get(KEYS.OPTIONS.ONLINE_VIDEO_PROJECTION.SHOW_RETURN, false) as boolean;
  if (await _wantsMediaReturn(returnOn)) await openMediaWindow("return", "video");
  await _openOperatorIfEnabled("video");
}

/** A janela que mostra o vídeo on-line está aberta? Sem ela, o player embutido toca na principal. */
export function isVideoProjectionOpen(): Promise<boolean> {
  return isWindowOpen(PROJECTION_TYPE.FILE);
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
    closeMusicProjectionWindows(),
    _close(PROJECTION_TYPE.OPERATOR),
    _close(PROJECTION_TYPE.BIBLE),
    _close(PROJECTION_TYPE.BIBLE_RETURN),
    closeFileProjectionWindows(),
    /*
     * O Site é uma projeção como as outras: sem isto "Encerrar projeção"
     * deixava a URL na tela.
     */
    _closeSite(),
  ]);
}

/** Libera somente as janelas que exibem arquivo/vídeo ao assumir slides de música ou do editor. */
export async function closeFileProjectionWindows(): Promise<void> {
  await Promise.all([
    _close(PROJECTION_TYPE.FILE),
    _close(PROJECTION_TYPE.FILE_RETURN),
    _close(PROJECTION_TYPE.ONLINE_VIDEO),
    _close(PROJECTION_TYPE.ONLINE_VIDEO_RETURN),
  ]);
}

/** Ao entrar arquivo/vídeo, remove as duas telas que ainda exibiriam a música anterior. */
export async function closeMusicProjectionWindows(): Promise<void> {
  const generation = ++_musicWindowGeneration;
  if (_musicWindowOpenings.size) {
    const finished = Promise.allSettled([..._musicWindowOpenings]);
    let settled = false;
    const done = finished.then(() => { settled = true; });
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      done,
      new Promise<void>((resolve) => { timer = setTimeout(resolve, MUSIC_WINDOW_CLOSE_WAIT_MS); }),
    ]);
    if (timer) clearTimeout(timer);
    if (!settled) {
      void done.then(() => {
        if (generation === _musicWindowGeneration) {
          void Promise.all([_close(PROJECTION_TYPE.MUSIC), _close(PROJECTION_TYPE.RETURN)]).catch(() => {});
        }
      });
    }
  }
  if (generation !== _musicWindowGeneration) return;
  await Promise.all([
    _close(PROJECTION_TYPE.MUSIC),
    _close(PROJECTION_TYPE.RETURN),
  ]);
}

export async function closeBibleWindows(): Promise<void> {
  await Promise.all([
    _close(PROJECTION_TYPE.BIBLE),
    _close(PROJECTION_TYPE.BIBLE_RETURN),
  ]);
}

export default { openProjectionWindows, closeProjectionWindows, closeBibleWindows, openBibleWindow, openFileProjectionWindows, openAnnouncementsWindow, closeAnnouncementsWindow, openSiteWindow,
  closeSiteWindow, isSiteProjectionActive, takeSiteKey, forwardSiteKey, openVideoProjectionWindows, openMediaWindow, mediaWindowPlan, currentMediaKind, openBackgroundProjectionWindows, closeBackgroundProjectionWindows };
