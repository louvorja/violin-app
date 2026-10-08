export const PROJECTION_TYPE = {
  MUSIC: "musicas",
  OPERATOR: "operador",
  RETURN: "retorno",
  BIBLE: "bible",
  BIBLE_RETURN: "bible_return",
  FILE: "file_projection",
  FILE_RETURN: "file_return",
  ONLINE_VIDEO: "online_video",
  ONLINE_VIDEO_RETURN: "online_video_return",
  BACKGROUND: "background_projection",
  BACKGROUND_RETURN: "background_projection_return",
  ANNOUNCEMENTS: "announcements",
  /**
   * Item de liturgia do tipo Site: não tem rota própria. A `route` desta
   * janela é a URL que o operador colou, e o windowFactory a carrega direto
   * — fora da SPA, sem o preload do app, porque um site arbitrário não pode
   * herdar `louvorjaApi`.
   */
  SITE: "site",
  /**
   * A mesma URL no monitor de retorno, aberta quando a opção de Projeção de
   * Sites está ligada. A `route` também é a URL: é uma janela externa como a
   * de cima, e passa pelo mesmo tratamento (sem preload, com partição).
   */
  SITE_RETURN: "site_return",
  /**
   * Tela de loading que cobre o monitor ENQUANTO a janela de Site carrega e
   * entra no modo de apresentação. É janela da SPA (tem preload, rota própria)
   * — só a de Site é externa.
   */
  SITE_LOADER: "site_loader",
  /** A mesma tela de loading no monitor de retorno, para os dois fades juntos. */
  SITE_LOADER_RETURN: "site_loader_return",
};

const RETURN_URL = "/return"
const URL_BASE = "/projection"
export const PROJECTION_URL = {
  BASE: URL_BASE,
  // A projeção de música é a própria rota base; o operador tem rota própria.
  MUSIC: URL_BASE,
  OPERATOR: "/operator",
  RETURN: URL_BASE + RETURN_URL,
  BIBLE: URL_BASE + "/" + PROJECTION_TYPE.BIBLE,
  BIBLE_RETURN: URL_BASE + "/" + PROJECTION_TYPE.BIBLE + RETURN_URL,
  FILE: URL_BASE + "/file",
  FILE_RETURN: URL_BASE + "/file" + RETURN_URL,
  ONLINE_VIDEO: `${URL_BASE}/${PROJECTION_TYPE.ONLINE_VIDEO}`,
  ONLINE_VIDEO_RETURN: `${URL_BASE}/${PROJECTION_TYPE.ONLINE_VIDEO_RETURN}`,
  BACKGROUND: URL_BASE + "/"+ PROJECTION_TYPE.BACKGROUND,
  BACKGROUND_RETURN: URL_BASE + "/" + PROJECTION_TYPE.BACKGROUND + RETURN_URL,
  ANNOUNCEMENTS: `${URL_BASE}/${PROJECTION_TYPE.ANNOUNCEMENTS}`,
  SITE_LOADER: URL_BASE + "/" + PROJECTION_TYPE.SITE_LOADER,
  SITE_LOADER_RETURN: URL_BASE + "/" + PROJECTION_TYPE.SITE_LOADER_RETURN,
};
