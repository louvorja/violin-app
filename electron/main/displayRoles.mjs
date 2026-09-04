/**
 * displayRoles.js — Papéis de monitor.
 *
 * Em vez de cada módulo guardar o seu próprio monitor (o que produzia dezenas
 * de preferências capazes de divergir entre si), o usuário atribui monitores a
 * três PAPÉIS e cada módulo aponta para um deles.
 *
 * A vantagem prática: quando um monitor some, o papel fica órfão e a janela
 * simplesmente não abre — em vez de invadir a tela do operador.
 *
 * Módulo PURO: sem dependências, sem I/O.
 *
 * ESM porque o renderer e o web/PWA também precisam do mapa feature→papel
 * (o Vite não converte CommonJS de arquivos do projeto). O main process
 * chega aqui pela ponte em `monitorIdentityBridge.cjs`.
 */

export const ROLES = {
  /** Tela que a congregação vê. */
  PROJECTION: "projection",
  /** Retorno / stage display, visível ao músico e ao operador. */
  STAGE: "stage",
  /** Tela onde o operador trabalha. */
  OPERATOR: "operator",
};

/**
 * Papel de cada feature conhecida. Serve de allowlist na migração: chave fora
 * daqui não é interpretada, vai para quarentena.
 */
export const FEATURE_ROLE = {
  // Apresentação
  musicas: ROLES.PROJECTION,
  music: ROLES.PROJECTION,
  media: ROLES.PROJECTION,
  bible: ROLES.PROJECTION,
  file_projection: ROLES.PROJECTION,
  online_video: ROLES.PROJECTION,
  background_projection: ROLES.PROJECTION,
  announcements: ROLES.PROJECTION,
  counter: ROLES.PROJECTION,
  draw: ROLES.PROJECTION,
  name_draw: ROLES.PROJECTION,
  message_board: ROLES.PROJECTION,
  stopwatch: ROLES.PROJECTION,
  timer: ROLES.PROJECTION,
  timer_worship: ROLES.PROJECTION,
  media_library: ROLES.PROJECTION,
  default: ROLES.PROJECTION,
  "shell:projection": ROLES.PROJECTION,

  // Retorno / stage
  retorno: ROLES.STAGE,
  bible_return: ROLES.STAGE,
  file_return: ROLES.STAGE,
  online_video_return: ROLES.STAGE,
  background_projection_return: ROLES.STAGE,
  clock: ROLES.STAGE,
  clock_fullscreen: ROLES.STAGE,

  // Operador
  operador: ROLES.OPERATOR,
  "shell:operator": ROLES.OPERATOR,
};

/**
 * Feature histórica de cada papel. O voto dela pesa mais na derivação, porque
 * é a que o usuário configurava de fato na tela de Opções.
 */
export const CANONICAL_FEATURE = {
  [ROLES.PROJECTION]: "musicas",
  [ROLES.STAGE]: "retorno",
  [ROLES.OPERATOR]: "operador",
};

export const CANONICAL_WEIGHT = 10;

/**
 * Papel padrão de famílias de features criadas dinamicamente, onde não dá para
 * listar cada nome. Ex.: "transmission:/obs/bible" (uma por rota de captura).
 */
export const FEATURE_PREFIX_ROLE = {
  "transmission:": ROLES.PROJECTION,
};

/** Papel de uma feature, ou null se ela não for conhecida. */
export function roleOfFeature(feature) {
  if (Object.prototype.hasOwnProperty.call(FEATURE_ROLE, feature)) {
    return FEATURE_ROLE[feature];
  }
  for (const [prefix, role] of Object.entries(FEATURE_PREFIX_ROLE)) {
    if (typeof feature === "string" && feature.startsWith(prefix)) return role;
  }
  return null;
}

/**
 * Deriva o monitor de cada papel a partir das preferências por feature.
 *
 * Escolhe por votação: o monitor mais citado entre as features de um papel
 * vence, com a feature canônica valendo por várias. Assim um usuário que
 * configurou "Monitor 2" em bíblia, sorteio e cronômetro tem o papel
 * "projection" apontando para o Monitor 2, mesmo que "musicas" nunca tenha
 * sido configurado.
 *
 * @param {Record<string, number|string|null>} prefs  monitor_prefs legado
 * @param {(raw: number|string|null) => number|null} resolveId
 *        Normaliza o valor bruto para um id (ver monitorPrefs.resolveWantedId)
 * @returns {{
 *   roles: Record<string, number|null>,
 *   divergent: Record<string, number>,
 *   unknown: Record<string, number|string|null>
 * }}
 *   roles     — id do monitor escolhido para cada papel (null = sem escolha)
 *   divergent — features cuja escolha diferia do papel; preservadas para não
 *               sumir em silêncio, já que agora elas seguem o papel
 *   unknown   — chaves fora da allowlist, em quarentena
 */
export function deriveRoles(prefs, resolveId) {
  const votes = {
    [ROLES.PROJECTION]: new Map(),
    [ROLES.STAGE]: new Map(),
    [ROLES.OPERATOR]: new Map(),
  };
  const unknown = {};
  const byFeature = {};

  for (const [feature, raw] of Object.entries(prefs || {})) {
    const role = roleOfFeature(feature);
    if (!role) {
      unknown[feature] = raw;
      continue;
    }
    const id = resolveId(raw);
    if (id == null) continue;

    byFeature[feature] = id;
    const weight = CANONICAL_FEATURE[role] === feature ? CANONICAL_WEIGHT : 1;
    votes[role].set(id, (votes[role].get(id) || 0) + weight);
  }

  const roles = {};
  for (const role of Object.values(ROLES)) {
    let winner = null;
    let best = 0;
    for (const [id, count] of votes[role]) {
      if (count > best) {
        best = count;
        winner = id;
      }
    }
    roles[role] = winner;
  }

  const divergent = {};
  for (const [feature, id] of Object.entries(byFeature)) {
    const role = roleOfFeature(feature);
    if (roles[role] !== id) divergent[feature] = id;
  }

  return { roles, divergent, unknown };
}

