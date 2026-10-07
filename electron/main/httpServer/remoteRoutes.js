"use strict";

/**
 * Rotas do CONTROLE REMOTO — as features que o app/web do operador usa:
 * teclado, liturgia, busca/navegação de músicas, vídeos online, som de
 * fundo, volume e chat.
 *
 * Extraído de routes.js: o motor de renderer, os validadores contratuais e
 * `getUserData` chegam no `ctx` do `register` (montado pelo setupRoutes do
 * arquivo principal); payloads/builders e utilitários destas rotas são
 * privados daqui. Este arquivo não requer routes.js (sem ciclo).
 */
const path = require("path");
const fs = require("fs");
const jsonCache = require("../jsonCache.js");
const devices = require("../devices.js");
const docStore = require("../docStore.js");
const { safeSend } = require("../safeWebContents.js");
const mediaResolver = require("../mediaResolver.js");
const { createMusicSearchCatalog, normalize } = require("./musicSearchCatalog.js");


const KEY_LITURGY_DAYS = "modules.liturgy.days";

const KEY_LITURGY_ACTIVE_DAY = "modules.liturgy.active_day";


/** Coleção (docStore) onde o histórico do chat é persistido — igual ao renderer. */
const CHAT_MESSAGES_COLLECTION = "chat.messages";


/** Rate limit simples: 1 msg/500ms por device. */
const _chatRateLimit = new Map();


/**
 * Códigos VK legados (modo clássico do app) → nomes de tecla do DOM.
 * O modo clássico remapeia as setas para números (37/38/39/40…).
 */
const LEGACY_VK_KEYS = {
  13: "Enter",
  27: "Escape",
  32: "Space",
  35: "End",
  36: "Home",
  37: "ArrowLeft",
  38: "ArrowUp",
  39: "ArrowRight",
  40: "ArrowDown",
};


/** Aliases aceitos → nome DOM usado pelo `Hotkeys` do renderer. */
const KEY_ALIASES = {
  arrowleft: "ArrowLeft",
  arrowright: "ArrowRight",
  arrowup: "ArrowUp",
  arrowdown: "ArrowDown",
  esc: "Escape",
  " ": "Space",
  space: "Space",
  return: "Enter",
};


/**
 * Normaliza o nome da tecla recebido do client para o nome DOM.
 *
 * O app manda `ArrowRight`/`Space`/`Home`… (e o modo clássico, códigos VK).
 * O `Hotkeys` do renderer compara por `KeyboardEvent.key`, então a chave
 * precisa chegar no formato DOM.
 */
function normalizeKeyName(rawKey) {
  const str = String(rawKey ?? "");
  // Espaço literal (" ") é uma tecla, não whitespace a aparar.
  if (str === " ") return "Space";
  const trimmed = str.trim();
  if (!trimmed) return null;
  if (LEGACY_VK_KEYS[trimmed]) return LEGACY_VK_KEYS[trimmed];
  const alias = KEY_ALIASES[trimmed.toLowerCase()];
  if (alias) return alias;
  return trimmed;
}


/** Teto do acervo pessoal de músicas no renderer. */
const CUSTOM_SONGS_MAX_BYTES = 8 * 1024 * 1024;


/** Teto dos dois acervos de vídeo (catálogo remoto + Meus Vídeos). */

const ONLINE_VIDEOS_MAX_BYTES = 8 * 1024 * 1024;

/** Miniatura servida em binário (blob do IDB do renderer). */
const ONLINE_VIDEOS_IMAGE_MAX_BYTES = 8 * 1024 * 1024;

const ONLINE_VIDEOS_READ_ACTIONS = new Set(["albums", "videos", "search"]);

const ONLINE_VIDEOS_IMAGE_KINDS = new Set(["video", "category"]);


/**
 * Extrai o id de um link do YouTube (`watch?v=`, `youtu.be`, `embed`, `shorts`,
 * `live`) ou de um id cru de 11 caracteres.
 *
 * Só o **id** segue para o renderer: a URL nunca vira argumento de comando, e
 * id inválido vira 400 na hora (em vez de um 200 que não projeta nada).
 */
function extractYoutubeVideoId(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(trimmed)) return trimmed;
  const match = trimmed.match(
    /(?:youtu\.be\/|[?&]v=|\/embed\/|\/shorts\/|\/live\/)([A-Za-z0-9_-]{11})/
  );
  return match ? match[1] : null;
}


/** MIME por extensão para as capas servidas de `<dados>/files/`. */
const IMAGE_MIME_BY_EXT = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
};


function imageMimeForPath(filePath) {
  return IMAGE_MIME_BY_EXT[path.extname(String(filePath)).toLowerCase()] || "application/octet-stream";
}


/** JSON do jsonCache ou `null` quando o arquivo ainda não existe. */
async function readJsonCacheOrNull(filePath) {
  try {
    return JSON.parse(await fs.promises.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}


/**
 * Capa de um álbum: `http(s)` vira URL direta; caminho relativo vira a rota
 * própria `/api/music-library/image` (os clientes absolutizam com host+token).
 */
function musicLibraryImageUrl(urlImage) {
  const raw = typeof urlImage === "string" ? urlImage.trim() : "";
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  return `/api/music-library/image?path=${encodeURIComponent(raw)}`;
}


/** Payload de um álbum oficial (vem do `{lang}_categories`). `count: 0` = sem contagem conhecida. */
function officialAlbumPayload(album) {
  const subtitle = typeof album.subtitle === "string" && album.subtitle.trim() ? album.subtitle : null;
  return {
    id: `album:${Number(album.id_album)}`,
    title: String(album.name || "").slice(0, 1_000),
    subtitle: subtitle ? subtitle.slice(0, 300) : null,
    count: 0,
    source: "official",
    color: typeof album.color === "string" && album.color ? album.color : null,
    image: musicLibraryImageUrl(album.url_image),
  };
}


/** Payload de uma coletânea personalizada (sem capa — só a cor, como no desktop). */
function customCollectionPayload(collection) {
  return {
    id: `collection:${String(collection.id)}`,
    title: String(collection.nome || "").slice(0, 1_000),
    subtitle: null,
    count: Array.isArray(collection.song_ids) ? collection.song_ids.length : 0,
    source: "custom",
    color: typeof collection.cor === "string" && collection.cor ? collection.cor : null,
    image: null,
  };
}


/**
 * Álbum virtual das músicas pessoais que não estão em nenhuma coletânea.
 *
 * Só existe na resposta quando há pelo menos uma órfã — um "Sem álbum" vazio
 * seria ruído na lista. O prefixo é próprio (não `collection:`): um id
 * `orphans:xyz` cai no 400 de "album inválido" do handler.
 */
const ORPHANS_ALBUM_ID = "orphans:none";


/** Título do álbum virtual — o `lang` da query é o mesmo que os 3 clientes já mandam. */
function noAlbumTitle(lang) {
  return lang === "es" ? "Sin álbum" : "Sem álbum";
}


/** Títulos dos hinários — parity com `config/modules/titles.ts`. */
function hymnalTitle(lang, which) {
  if (which === "legacy") return lang === "es" ? "Himnario 1996" : "Hinário 1996";
  return lang === "es" ? "Himnario Adventista" : "Hinário Adventista";
}


/**
 * Faixa do hinário — mesmo rótulo do `HymnalBrowser` do desktop
 * ("Hino nº N - Nome"; sem track válido, só o nome).
 */
function hymnalSongPayload(hymn, albumName) {
  const base = officialSongPayload(hymn, albumName);
  const track = Number(hymn?.track);
  if (Number.isInteger(track) && track > 0) {
    return { ...base, name: `Hino nº ${track} - ${base.name}`.slice(0, 500) };
  }
  return base;
}


/**
 * Músicas pessoais de fora de **toda** coletânea (em duas coletâneas não
 * conta como órfã), na ordem do docStore.
 *
 * A mesma função alimenta `action=albums` (count) e `action=songs` (lista) —
 * o badge do card nunca pode divergir das faixas. Sem nome também ficam de
 * fora, na régua da busca (`loadCustomMusicCatalog`): senão o badge contava
 * lixo que a busca não mostra e a linha saía em branco.
 */
function orphanCustomSongs() {
  const songs = docStore.read("custom_collections.songs") || [];
  const collections = docStore.read("custom_collections.collections") || [];
  const used = new Set();
  for (const collection of collections) {
    if (!Array.isArray(collection?.song_ids)) continue;
    for (const songId of collection.song_ids) {
      if (typeof songId === "string" && songId) used.add(songId);
    }
  }
  return songs.filter(
    (song) =>
      song &&
      typeof song.id === "string" &&
      song.id &&
      typeof song.nome === "string" &&
      song.nome.trim() &&
      !used.has(song.id)
  );
}


/** `m:ss` (`h:mm:ss` acima de uma hora); aceita "hh:mm:ss" ou segundos — igual ao `shortTime` do desktop. */
function formatMusicDuration(value) {
  const pad = (n) => String(Math.floor(n)).padStart(2, "0");
  let hours = 0;
  let minutes = 0;
  let seconds = 0;
  if (typeof value === "string") {
    const parts = value.split(":").map(Number);
    if (parts.some((n) => !Number.isFinite(n))) return "";
    if (parts.length >= 3) [hours, minutes, seconds] = parts;
    else [minutes, seconds] = parts;
  } else {
    if (!Number.isFinite(value) || value < 0) return "";
    hours = Math.floor(value / 3600);
    minutes = Math.floor((value % 3600) / 60);
    seconds = value % 60;
  }
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}


/** Faixa de um álbum oficial (detalhe `album_<id>`), no formato de `MusicResult`. */
function officialSongPayload(music, albumName) {
  return {
    id_music: Number(music.id_music) || 0,
    name: String(music.name || "").slice(0, 500),
    duration: formatMusicDuration(music.duration),
    has_instrumental_music: music.has_instrumental_music ? 1 : 0,
    albums_names: albumName.slice(0, 1_000),
    custom_song_id: null,
    has_audio: 1,
  };
}


/** Faixa de uma coletânea personalizada — execução pelo UUID (`custom_song_id`). */
function customSongPayload(song, collectionName, index) {
  return {
    // Negativo sintético, mesma convenção de `loadCustomMusicCatalog`: só lista.
    id_music: -(index + 2),
    name: String(song.nome || "").slice(0, 500),
    duration: "",
    has_instrumental_music: song.playback_token ? 1 : 0,
    has_audio: song.audio_token ? 1 : 0,
    albums_names: String(collectionName || "").slice(0, 1_000),
    custom_song_id: typeof song.id === "string" ? song.id : null,
  };
}

  const musicSearchCatalog = createMusicSearchCatalog();

/**
 * Registra as rotas do controle remoto.
 *
 * @param {import("express").Application} app
 * @param {object} ctx motor de renderer, validadores e deps (ver routes.js)
 */
function register(app, ctx) {
  const {
    getValidMainWindow,
    requestRenderer,
    sendRendererError,
    getUserData,
    isCustomSongsSearchResponse,
    isOnlineVideosAlbumsResponse,
    isOnlineVideosVideosResponse,
    isOnlineVideoImageResponse,
    isBackgroundSoundStateResponse,
    isVolumeResponse,
    hasOnlineVideosPermission,
    hasDevicePermission,
  } = ctx;


  /**
   * Músicas do acervo pessoal (IDB do renderer), filtradas com o **mesmo**
   * `normalize` da busca oficial. Aditivo por natureza: renderer indisponível
   * ou fora do ar → devolve `[]` e a busca oficial segue intacta.
   *
   * A consulta numérica é exclusiva do hinário oficial (personalizadas não têm
   * número de hino), então nesses casos nem se consulta.
   */
  async function searchCustomSongs(query, res) {
    const mainWindow = getValidMainWindow();
    if (!mainWindow) return [];
    try {
      const data = await requestRenderer(
        mainWindow,
        res,
        "http:custom-music",
        {},
        {
          prefix: "custom-music",
          timeoutMs: 4_000,
          maxPayloadBytes: CUSTOM_SONGS_MAX_BYTES,
          validatePayload: isCustomSongsSearchResponse,
        }
      );
      return (data.songs || [])
        .filter(
          (song) =>
            normalize(song.name).includes(query) || normalize(song.albums_names).includes(query)
        )
        .slice(0, 20);
    } catch (error) {
      console.warn(
        `[httpServer] music-search pessoal falhou: ${error?.code || error?.message || error}`
      );
      return [];
    }
  }


  // ---------------------------------------------------------------
  // POST /api/keyboard — simular tecla
  // Body: { key: string, modifiers?: string[] }
  //
  // Injeta um KeyboardEvent sintético no renderer em vez de usar
  // `webContents.sendInputEvent`. Dois motivos:
  //  1. `sendInputEvent` exige a BrowserWindow EM FOCO (ver docs do Electron),
  //     e o controle remoto é usado justamente com o desktop em segundo plano;
  //  2. `sendInputEvent.keyCode` só aceita códigos de Accelerator ("Right"),
  //     não nomes DOM ("ArrowRight") — era o que o app enviava.
  // O evento sintético cai no `Hotkeys` do renderer, reaproveitando todo o
  // roteamento já existente (Media × Bíblia).
  // ---------------------------------------------------------------
  app.post("/api/keyboard", (req, res) => {
    const mainWindow = getValidMainWindow();
    const rawKey = req.body && req.body.key;
    const modifiers = (req.body && req.body.modifiers) || [];
    if (!rawKey || !mainWindow) {
      return res.status(400).json({ error: "key faltando ou janela indisponível" });
    }

    const key = normalizeKeyName(rawKey);
    if (!key) {
      return res.status(400).json({ error: `key inválida: ${rawKey}` });
    }

    const mods = new Set(
      (Array.isArray(modifiers) ? modifiers : []).map((m) => String(m).toLowerCase())
    );
    const event = {
      key,
      bubbles: true,
      cancelable: true,
      ctrlKey: mods.has("control") || mods.has("ctrl"),
      metaKey: mods.has("meta") || mods.has("cmd") || mods.has("command"),
      altKey: mods.has("alt"),
      shiftKey: mods.has("shift"),
    };

    try {
      // `executeJavaScript` roda independente de foco/minimização.
      mainWindow.webContents
        .executeJavaScript(
          `window.dispatchEvent(new KeyboardEvent("keydown", ${JSON.stringify(event)}))`
        )
        .catch(() => { /* janela ainda carregando ou destruída */ });
      res.json({ status: "ok", key, modifiers });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });



  // ---------------------------------------------------------------
  // POST /api/liturgy-execute — executa item da liturgia
  // Body: { id: string, tag?: string }
  // ---------------------------------------------------------------
  app.post("/api/liturgy-execute", (req, res) => {
    const mainWindow = getValidMainWindow();
    if (!mainWindow) {
      return res.status(503).json({ error: "Janela principal não disponível" });
    }
    const id = req.body && req.body.id;
    if (!id) {
      return res.status(400).json({ error: "id é obrigatório" });
    }

    // O dia que o cliente exibiu (a rota GET devolve o `day` da lista): o
    // renderer busca o item nele e só cai no fallback (hoje → dia ativo) se
    // faltar ou vier fora de 0..6.
    const rawDay = req.body && req.body.day;
    const parsedDay = typeof rawDay === "string" && rawDay.trim() !== "" ? Number(rawDay) : rawDay;
    const day = Number.isInteger(parsedDay) && parsedDay >= 0 && parsedDay <= 6 ? parsedDay : undefined;

    const payload = {
      action: "liturgy-execute",
      id,
      tag: req.body.tag,
      ...(day !== undefined ? { day } : {}),
    };
    safeSend(mainWindow, "http:song-slides", payload);
    res.json({ status: "ok", action: "liturgy-execute", payload });
  });



  // ---------------------------------------------------------------
  // /api/music-search?q=...&lang=pt (GET — somente leitura)
  // ---------------------------------------------------------------
  app.get("/api/music-search", async (req, res) => {
    const q = req.query.q;
    if (typeof q !== "string" || !q.trim() || (q.trim().length < 2 && !/^\d+$/.test(q.trim()))) {
      return res.json({ status: "ok", results: [] });
    }
    const lang = req.query.lang === "es" ? "es" : "pt";
    const query = normalize(q.trim());

    try {
      const filePath = jsonCache.safeLocalPath(`${lang}_musics`);
      let results;
      try {
        const userData = typeof getUserData === "function" ? getUserData() : {};
        const disabled = Array.isArray(userData?.options?.disabled_albums)
          ? [...userData.options.disabled_albums] : [];
        if (userData?.modules?.hymnal_1996?.show_in_main_menu !== true) disabled.push(629);
        results = await musicSearchCatalog.search(filePath, query, disabled,
          jsonCache.safeLocalPath(`${lang}_categories`));
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        return res.status(404).json({
          error: "Base de músicas não encontrada localmente. Faça uma atualização do banco.",
        });
      }
      // Acervo pessoal vem depois do oficial — mesma ordem do spotlight do
      // desktop (`MusicSpotlight`: [...oficial, ...customMusics]).
      const custom = /^\d+$/.test(query) ? [] : await searchCustomSongs(query, res);
      const merged = [...results, ...custom];
      if (custom.length > 0) {
        console.log(`[httpServer] music-search pessoal ok (${custom.length} de ${merged.length})`);
      }
      res.json({ status: "ok", results: merged, total: merged.length });
    } catch (e) {
      console.error("[httpServer] /api/music-search error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });



  // ---------------------------------------------------------------
  // GET /api/music-library — álbuns para navegar no controle remoto
  //   action=albums → álbuns oficiais ({lang}_categories) + coletâneas
  //   action=songs  → faixas de um álbum (`album:<id>` ou `collection:<uuid>`)
  //   (a capa tem rota própria, logo abaixo)
  //
  // Tudo legível no main: jsonCache (catálogo) e docStore (coletâneas) — sem
  // ida ao renderer, diferente de Vídeos Online.
  // ---------------------------------------------------------------
  app.get("/api/music-library", async (req, res) => {
    try {
      const action = req.query.action || "albums";
      const lang = req.query.lang === "es" ? "es" : "pt";

      if (action === "albums") {
        const categories = await readJsonCacheOrNull(jsonCache.safeLocalPath(`${lang}_categories`));
        if (!Array.isArray(categories)) {
          return res.status(404).json({
            error: "Base de músicas não encontrada localmente. Faça uma atualização do banco.",
          });
        }

        // Mesma régua da busca oficial: álbuns desativados e o hinário 1996
        // ligado pelo toggle de compatibilidade.
        const userData = typeof getUserData === "function" ? getUserData() : {};
        const disabled = [...(userData?.options?.disabled_albums ?? [])];
        if (userData?.modules?.hymnal_1996?.show_in_main_menu !== true) disabled.push(629);

        const { albumYear, isAlbumEnabled, HYMNAL_ALBUM_IDS } = await import(
          "../../../config/musicCatalog.mjs"
        );

        // Achata categorias → álbuns (dedup por id_album), filtra e ordena como
        // o módulo Álbuns do desktop (ano desc, depois nome).
        const oficiais = [
          ...new Map(
            categories
              .flatMap((category) => (Array.isArray(category?.albums) ? category.albums : []))
              .filter(
                (album) =>
                  album && Number.isFinite(Number(album.id_album)) && isAlbumEnabled(album.id_album, disabled)
              )
              .map((album) => [Number(album.id_album), album])
          ).values(),
        ]
          .sort(
            (a, b) =>
              albumYear(b) - albumYear(a) || String(a.name || "").localeCompare(String(b.name || ""))
          )
          .map(officialAlbumPayload);

        const colecoes = (docStore.read("custom_collections.collections") || [])
          .filter(
            (collection) =>
              collection &&
              typeof collection.id === "string" &&
              collection.id &&
              typeof collection.nome === "string" &&
              collection.nome.trim()
          )
          .map(customCollectionPayload);

        // Órfãs (pessoais sem coletânea) viram um álbum no FIM — dentro do
        // grupo "Coletâneas" dos clientes (source: "custom").
        const avulsas = orphanCustomSongs();
        const semAlbum = avulsas.length
          ? [
              {
                id: ORPHANS_ALBUM_ID,
                title: noAlbumTitle(lang),
                subtitle: null,
                count: avulsas.length,
                source: "custom",
                color: null,
                image: null,
              },
            ]
          : [];

        // Hinários pinados no TOPO: não vêm em `{lang}_categories` (o catálogo
        // atual não os traz), as faixas lêem `{lang}_hymnal[_1996].json` (mesma
        // fonte do sync). A legacy some sozinha com o toggle off: o `disabled`
        // acima já contém 629 nesse caso (mesma régua do desktop).
        const hinarios = [];
        for (const [which, albumId] of [
          ["current", HYMNAL_ALBUM_IDS.current],
          ["legacy", HYMNAL_ALBUM_IDS.legacy],
        ]) {
          if (!isAlbumEnabled(albumId, disabled)) continue;
          const file = await readJsonCacheOrNull(
            jsonCache.safeLocalPath(which === "legacy" ? `${lang}_hymnal_1996` : `${lang}_hymnal`)
          );
          if (!Array.isArray(file)) continue;
          hinarios.push({
            id: `album:${albumId}`,
            title: hymnalTitle(lang, which),
            subtitle: null,
            count: file.length,
            source: "official",
            // Módulo dono do álbum — os clientes usam o ícone do módulo
            // (a mesma marca do desktop) no lugar da nota musical.
            module_id: which === "legacy" ? "hymnal_1996" : "hymnal",
            color: null,
            image: null,
          });
        }
        // Se o hinário já estava nas categorias (catálogos antigos), sai de lá
        // para não duplicar o card.
        const pinnedIds = new Set(hinarios.map((hinario) => hinario.id));
        const oficiaisSemHinario = oficiais.filter((album) => !pinnedIds.has(album.id));

        const albums = [...hinarios, ...oficiaisSemHinario, ...colecoes, ...semAlbum];
        console.log(
          `[httpServer] music-library albums → ${hinarios.length} hinários + ` +
            `${oficiaisSemHinario.length} oficiais + ${colecoes.length} coletâneas + ` +
            `${semAlbum.length} sem álbum`
        );
        return res.json({ status: "ok", albums });
      }

      if (action === "songs") {
        const album = typeof req.query.album === "string" ? req.query.album.trim().slice(0, 256) : "";
        if (!album) {
          return res.status(400).json({ error: "album obrigatório" });
        }

        if (album.startsWith("album:")) {
          const id = album.slice("album:".length);
          if (!/^\d+$/.test(id)) {
            return res.status(400).json({ error: "album inválido" });
          }
          // Hinários não têm `album_<id>.json`: as faixas vêm direto de
          // `{lang}_hymnal[_1996].json`. O mesmo gate da lista — a legacy some
          // com o toggle de compatibilidade off (ou fora do disco).
          const { HYMNAL_ALBUM_IDS } = await import("../../../config/musicCatalog.mjs");
          const isCurrentHymnal = Number(id) === HYMNAL_ALBUM_IDS.current;
          const isLegacyHymnal = Number(id) === HYMNAL_ALBUM_IDS.legacy;
          if (isCurrentHymnal || isLegacyHymnal) {
            const userData = typeof getUserData === "function" ? getUserData() : {};
            const disabled = [...(userData?.options?.disabled_albums ?? [])];
            if (userData?.modules?.hymnal_1996?.show_in_main_menu !== true) {
              disabled.push(HYMNAL_ALBUM_IDS.legacy);
            }
            const enabled = !disabled.some((value) => String(value) === id);
            const hymnFile = enabled
              ? await readJsonCacheOrNull(
                  jsonCache.safeLocalPath(isLegacyHymnal ? `${lang}_hymnal_1996` : `${lang}_hymnal`)
                )
              : null;
            if (!Array.isArray(hymnFile)) {
              return res.status(404).json({ error: "Álbum não encontrado no banco local" });
            }
            const title = hymnalTitle(lang, isLegacyHymnal ? "legacy" : "current");
            const songs = hymnFile
              .filter((hymn) => hymn && Number(Number(hymn.id_music)) > 0)
              .map((hymn) => hymnalSongPayload(hymn, title));
            return res.json({ status: "ok", songs });
          }

          const detail = await readJsonCacheOrNull(jsonCache.safeLocalPath(`album_${id}`));
          if (!detail) {
            return res.status(404).json({ error: "Álbum não encontrado no banco local" });
          }
          const albumName = typeof detail.name === "string" ? detail.name : "";
          const songs = (Array.isArray(detail.musics) ? detail.musics : [])
            .filter((music) => music && Number(Number(music.id_music)) > 0)
            .map((music) => officialSongPayload(music, albumName));
          return res.json({ status: "ok", songs });
        }

        if (album.startsWith("collection:")) {
          const id = album.slice("collection:".length);
          const colecao = (docStore.read("custom_collections.collections") || []).find(
            (collection) => collection && collection.id === id
          );
          if (!colecao) {
            return res.status(404).json({ error: "Coletânea não encontrada" });
          }
          const songIds = new Set(
            (Array.isArray(colecao.song_ids) ? colecao.song_ids : []).filter(
              (songId) => typeof songId === "string" && songId
            )
          );
          const porId = new Map(
            (docStore.read("custom_collections.songs") || [])
              .filter((song) => song && songIds.has(song.id))
              .map((song) => [song.id, song])
          );
          // A ordem é a da coletânea (como no desktop), não a do arquivo.
          const songs = [...songIds]
            .map((songId) => porId.get(songId))
            .filter(Boolean)
            .map((song, index) => customSongPayload(song, colecao.nome, index));
          return res.json({ status: "ok", songs });
        }

        if (album === ORPHANS_ALBUM_ID) {
          const songs = orphanCustomSongs().map((song, index) =>
            customSongPayload(song, noAlbumTitle(lang), index)
          );
          return res.json({ status: "ok", songs });
        }

        return res.status(400).json({ error: "album inválido" });
      }

      return res.status(400).json({ error: "action inválida", valid: ["albums", "songs"] });
    } catch (e) {
      console.error("[httpServer] /api/music-library error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });



  // ---------------------------------------------------------------
  // GET /api/music-library/image?path=… — capa de álbum em <dados>/files/
  // Mesmo guard de path traversal do protocolo louvorja://files (resolveWrite).
  // ---------------------------------------------------------------
  app.get("/api/music-library/image", async (req, res) => {
    const raw = typeof req.query.path === "string" ? req.query.path : "";
    if (!raw) {
      return res.status(400).json({ error: "path é obrigatório" });
    }

    let relative;
    try {
      relative = decodeURIComponent(raw).replace(/^\/+/, "");
    } catch {
      relative = raw.replace(/^\/+/, "");
    }
    if (!mediaResolver.resolveWrite(relative)) {
      return res.status(403).json({ error: "Caminho inválido" });
    }

    const found = await mediaResolver.resolveRead(relative);
    if (!found?.path) {
      return res.status(404).json({ error: "Capa não encontrada" });
    }
    try {
      const data = await fs.promises.readFile(found.path);
      res.set("Content-Type", imageMimeForPath(found.path));
      res.set("Cache-Control", "private, max-age=86400");
      res.send(data);
    } catch {
      res.status(404).json({ error: "Capa não encontrada" });
    }
  });



  // ---------------------------------------------------------------
  // /api/online-videos — Vídeos Online (controle remoto)
  //
  // GET  action=albums|videos|search — consulta os DOIS acervos no renderer
  //      (catálogo remoto `{lang}_collections_online` + Meus Vídeos no IDB)
  // POST action=play|close           — projeta uma URL do YouTube / encerra
  //
  // Devices pareados exigem a permission `online_videos` (ou `root`).
  // ---------------------------------------------------------------
  app.get("/api/online-videos", async (req, res) => {
    if (!hasOnlineVideosPermission(req)) {
      console.log("[httpServer] online-videos → 403 (device sem a permission online_videos)");
      return res.status(403).json({ error: "Device sem permissão de vídeos online" });
    }
    const mainWindow = getValidMainWindow();
    if (!mainWindow) {
      return res.status(503).json({ error: "Janela principal não disponível" });
    }

    const action = req.query.action || "albums";
    if (!ONLINE_VIDEOS_READ_ACTIONS.has(action)) {
      return res
        .status(400)
        .json({ error: "action inválida para GET", valid: [...ONLINE_VIDEOS_READ_ACTIONS] });
    }

    const lang = req.query.lang === "es" ? "es" : "pt";
    const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 200) : "";
    const album = typeof req.query.album === "string" ? req.query.album.trim().slice(0, 512) : "";
    if (action === "videos" && !album) {
      return res.status(400).json({ error: "album obrigatório" });
    }

    try {
      const data = await requestRenderer(
        mainWindow,
        res,
        "http:online-videos",
        { action, lang, q, album },
        {
          prefix: "online-videos",
          timeoutMs: 8_000,
          maxPayloadBytes: ONLINE_VIDEOS_MAX_BYTES,
          validatePayload:
            action === "albums" ? isOnlineVideosAlbumsResponse : isOnlineVideosVideosResponse,
        }
      );
      if (!res.headersSent && !res.writableEnded) {
        // O log de recebimento (middleware) não mostra o desfecho — aqui sim:
        // é o que aparece no terminal quando a aba Vídeos Online consulta.
        const count = Array.isArray(data?.albums)
          ? data.albums.length
          : Array.isArray(data?.videos)
            ? data.videos.length
            : 0;
        console.log(`[httpServer] online-videos → ${action} ok (${count} itens)`);
        res.json(data);
      }
    } catch (error) {
      console.warn(
        `[httpServer] online-videos → ${action} falhou: ${error?.code || error?.message || error}`
      );
      sendRendererError(res, error, "Timeout ao buscar vídeos online");
    }
  });



  // ---------------------------------------------------------------
  // GET /api/online-videos/image?kind=video|category&id=...
  // Miniatura dos **Meus Vídeos** (blob no IndexedDB do renderer) e dos
  // ícones de imagem das categorias. As do catálogo remoto não passam por
  // aqui: são URLs públicas (ytimg) que o cliente carrega direto.
  // ---------------------------------------------------------------
  app.get("/api/online-videos/image", async (req, res) => {
    if (!hasOnlineVideosPermission(req)) {
      console.log("[httpServer] online-videos image → 403 (device sem a permission online_videos)");
      return res.status(403).json({ error: "Device sem permissão de vídeos online" });
    }
    const mainWindow = getValidMainWindow();
    if (!mainWindow) {
      return res.status(503).json({ error: "Janela principal não disponível" });
    }

    const kind = typeof req.query.kind === "string" ? req.query.kind : "";
    const id = typeof req.query.id === "string" ? req.query.id.trim().slice(0, 256) : "";
    if (!ONLINE_VIDEOS_IMAGE_KINDS.has(kind)) {
      return res.status(400).json({ error: "kind inválido", valid: [...ONLINE_VIDEOS_IMAGE_KINDS] });
    }
    if (!id) {
      return res.status(400).json({ error: "id obrigatório" });
    }

    try {
      const image = await requestRenderer(
        mainWindow,
        res,
        "http:online-videos",
        { action: "image", kind, id },
        {
          prefix: "online-videos",
          timeoutMs: 5_000,
          maxPayloadBytes: ONLINE_VIDEOS_IMAGE_MAX_BYTES,
          validatePayload: isOnlineVideoImageResponse,
        }
      );
      if (res.headersSent || res.writableEnded) return;

      if (!image.data) {
        console.log(`[httpServer] online-videos image → 404 (${kind}:${id})`);
        return res.status(404).json({ error: "Miniatura não encontrada" });
      }
      const bytes = ArrayBuffer.isView(image.data)
        ? Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength)
        : Buffer.from(image.data);
      res.set("Content-Type", image.mime);
      res.set("Cache-Control", "private, max-age=86400");
      res.send(bytes);
    } catch (error) {
      console.warn(
        `[httpServer] online-videos image → falhou: ${error?.code || error?.message || error}`
      );
      sendRendererError(res, error, "Timeout ao buscar a miniatura");
    }
  });



  app.post("/api/online-videos", (req, res) => {
    if (!hasOnlineVideosPermission(req)) {
      console.log("[httpServer] online-videos → 403 no comando (device sem a permission)");
      return res.status(403).json({ error: "Device sem permissão de vídeos online" });
    }
    const mainWindow = getValidMainWindow();
    if (!mainWindow) {
      return res.status(503).json({ error: "Janela principal não disponível" });
    }

    const action = req.body && req.body.action;
    if (action === "play") {
      const url = typeof req.body.url === "string" ? req.body.url.trim() : "";
      const title = typeof req.body.title === "string" ? req.body.title.trim().slice(0, 500) : "";
      const videoId = extractYoutubeVideoId(url);
      if (!videoId) {
        return res.status(400).json({ error: "url do YouTube inválida" });
      }
      safeSend(mainWindow, "http:online-videos", { action: "play", videoId, title });
      return res.json({ status: "ok", action: "play" });
    }

    if (action === "close") {
      safeSend(mainWindow, "http:online-videos", { action: "close" });
      return res.json({ status: "ok", action: "close" });
    }

    res.status(400).json({ error: "action inválida", valid: ["play", "close"] });
  });



  // ---------------------------------------------------------------
  // /api/background-sound — Som de fundo no controle remoto
  // GET  → estado + biblioteca (metadados; os bytes ficam no renderer)
  // POST → play/pause/resume/stop (o player single do desktop, sem o módulo aberto)
  // Permission: background_sound (ou root)
  // ---------------------------------------------------------------
  app.get("/api/background-sound", async (req, res) => {
    if (!hasDevicePermission(req, "background_sound")) {
      console.log("[httpServer] background-sound → 403 (device sem a permission)");
      return res.status(403).json({ error: "Device sem permissão de som de fundo" });
    }
    const mainWindow = getValidMainWindow();
    if (!mainWindow) {
      return res.status(503).json({ error: "Janela principal não disponível" });
    }
    try {
      const data = await requestRenderer(
        mainWindow,
        res,
        "http:background-sound",
        { action: "state" },
        {
          prefix: "background-sound",
          timeoutMs: 4_000,
          maxPayloadBytes: 4 * 1024 * 1024,
          validatePayload: isBackgroundSoundStateResponse,
        }
      );
      if (!res.headersSent && !res.writableEnded) {
        console.log(
          `[httpServer] background-sound → estado ok (${data.files.length} sons, playing=${data.playing})`
        );
        res.json(data);
      }
    } catch (error) {
      console.warn(
        `[httpServer] background-sound estado falhou: ${error?.code || error?.message || error}`
      );
      sendRendererError(res, error, "Timeout ao buscar o som de fundo");
    }
  });



  const BACKGROUND_SOUND_ACTIONS = new Set(["play", "pause", "resume", "stop"]);
  app.post("/api/background-sound", (req, res) => {
    if (!hasDevicePermission(req, "background_sound")) {
      console.log("[httpServer] background-sound → 403 no comando (device sem a permission)");
      return res.status(403).json({ error: "Device sem permissão de som de fundo" });
    }
    const mainWindow = getValidMainWindow();
    if (!mainWindow) {
      return res.status(503).json({ error: "Janela principal não disponível" });
    }
    const action = req.body && req.body.action;
    if (!BACKGROUND_SOUND_ACTIONS.has(action)) {
      return res
        .status(400)
        .json({ error: "action inválida", valid: [...BACKGROUND_SOUND_ACTIONS] });
    }
    const id = typeof req.body.id === "string" ? req.body.id.trim().slice(0, 256) : "";
    if (action === "play" && !id) {
      return res.status(400).json({ error: "id é obrigatório para play" });
    }
    safeSend(mainWindow, "http:background-sound", { action, ...(id ? { id } : {}) });
    res.json({ status: "ok", action });
  });



  // ---------------------------------------------------------------
  // POST /api/volume — volume dos players (projeção + som de fundo)
  //   { action: up|down, step? }  → passo (padrão 1%, clamp 0..100)
  //   { action: set, value }      → nível absoluto (0..100) — iOS espelha o iPhone
  // Permission: volume (ou root). Somente modo Violin (o Delphi não serve isto).
  // ---------------------------------------------------------------
  app.post("/api/volume", async (req, res) => {
    if (!hasDevicePermission(req, "volume")) {
      console.log("[httpServer] volume → 403 (device sem a permission)");
      return res.status(403).json({ error: "Device sem permissão de volume" });
    }
    const mainWindow = getValidMainWindow();
    if (!mainWindow) {
      return res.status(503).json({ error: "Janela principal não disponível" });
    }
    const action = req.body && req.body.action;
    if (!["up", "down", "set"].includes(action)) {
      return res.status(400).json({ error: "action inválida", valid: ["up", "down", "set"] });
    }
    // `== null` cobre `undefined` (campo ausente) e `null` (cliente que manda
    // a propriedade explicitamente) — os dois significam "padrão 1%".
    const step = req.body.step == null ? 1 : req.body.step;
    const value = req.body.value;
    if (!Number.isInteger(step) || step < 1 || step > 100) {
      return res.status(400).json({ error: "step deve ser um inteiro entre 1 e 100" });
    }
    if (action === "set" && (!Number.isInteger(value) || value < 0 || value > 100)) {
      return res.status(400).json({ error: "value deve ser um inteiro entre 0 e 100" });
    }
    try {
      const data = await requestRenderer(
        mainWindow,
        res,
        "http:volume",
        { action, step, ...(action === "set" ? { value } : {}) },
        {
          prefix: "volume",
          timeoutMs: 3_000,
          maxPayloadBytes: 4_096,
          validatePayload: isVolumeResponse,
        }
      );
      if (!res.headersSent && !res.writableEnded) {
        console.log(`[httpServer] volume → ${action} = ${data.value}%`);
        res.json(data);
      }
    } catch (error) {
      console.warn(`[httpServer] volume falhou: ${error?.code || error?.message || error}`);
      sendRendererError(res, error, "Timeout ao ajustar o volume");
    }
  });



  // ---------------------------------------------------------------
  // POST /api/chat — enviar mensagem de chat
  // Body: { text: string, sender: string }
  // Headers: X-Device-Id (opcional)
  // ---------------------------------------------------------------
  app.post("/api/chat", (req, res) => {
    const { text, sender } = req.body || {};
    if (!text || typeof text !== "string" || text.trim().length === 0) {
      return res.status(400).json({ error: "text obrigatório" });
    }
    if (text.length > 2000) {
      return res.status(400).json({ error: "text excede 2000 caracteres" });
    }

    // Rate limit: 1 msg/seg por device
    const deviceId = req.headers && req.headers["x-device-id"];
    const rateKey = deviceId || req.ip;
    const now = Date.now();
    const last = _chatRateLimit.get(rateKey) || 0;
    if (now - last < 1000) {
      return res.status(429).json({ error: "Rate limit: 1 msg/seg" });
    }
    _chatRateLimit.set(rateKey, now);

    // Verifica permissão "chat" do device (se identificado)
    if (deviceId) {
      const device = devices.findById(String(deviceId));
      if (device && device.permissions && !device.permissions.includes("chat") && !device.permissions.includes("root")) {
        return res.status(403).json({ error: "Device sem permissão de chat" });
      }
    }

    const foundDevice = deviceId ? devices.findById(String(deviceId)) : null;
    const deviceName = foundDevice?.name;

    // Id gerado pelo client (app) para casar a mensagem otimista com o eco SSE
    // e evitar duplicata na tela. Aceita só strings curtas; senão gera um UUID.
    const rawId = req.body && req.body.id;
    const id =
      typeof rawId === "string" && rawId.trim().length > 0 && rawId.trim().length <= 64
        ? rawId.trim()
        : crypto.randomUUID();

    const msg = {
      id,
      sender: deviceName || sender || "Dispositivo",
      deviceId: deviceId || undefined,
      platform: foundDevice?.platform || undefined,
      text: text.trim(),
      timestamp: new Date().toISOString(),
    };

    // Publica via SSE para todos os clients conectados
    const events = require("./events.js");
    events.publish({ type: "chat_message", payload: msg });

    // Envia IPC para o renderer local
    const mainWindow = getValidMainWindow();
    if (mainWindow) {
      safeSend(mainWindow, "transmission:chat-message", msg);
    }

    res.json({ ok: true, id: msg.id });
  });



  // ---------------------------------------------------------------
  // GET /api/chat/history — últimas mensagens do chat (somente leitura)
  //
  // Devolve até `chat_history_limit` mensagens (definido nas opções do
  // desktop), da mais antiga para a mais recente. O app usa isso para
  // preencher lacunas após reconectar.
  // ---------------------------------------------------------------
  app.get("/api/chat/history", (_req, res) => {
    const limit = devices.getChatHistoryLimit();
    let messages = [];
    try {
      messages = docStore.read(CHAT_MESSAGES_COLLECTION);
    } catch (e) {
      console.warn("[httpServer] /api/chat/history: falha ao ler o histórico:", e.message);
    }
    const ordenadas = [...messages].sort((a, b) =>
      String(a && a.timestamp ? a.timestamp : "").localeCompare(
        String(b && b.timestamp ? b.timestamp : ""),
      ),
    );
    res.json({ status: "ok", messages: ordenadas.slice(-limit) });
  });



  // ---------------------------------------------------------------
  // /api/liturgy — itens da liturgia do dia (GET)
  // ---------------------------------------------------------------
  app.get("/api/liturgy", (req, res) => {
    const userData = typeof getUserData === "function" ? getUserData() : {};
    const day = req.query.day != null ? parseInt(req.query.day, 10) : new Date().getDay();

    function getByPath(obj, path, fallback) {
      if (!path || !obj) return fallback;
      const keys = path.split(".");
      let cur = obj;
      for (const key of keys) {
        if (cur[key] === undefined || cur[key] === null) return fallback;
        cur = cur[key];
      }
      return cur;
    }

    const allDays = getByPath(userData, KEY_LITURGY_DAYS, {});
    let items = allDays[day] || [];

    if (items.length === 0) {
      const activeDay = getByPath(userData, KEY_LITURGY_ACTIVE_DAY, day);
      if (activeDay !== day) {
        items = allDays[activeDay] || [];
        return res.json({ status: "ok", day: activeDay, items, is_active_day: true });
      }
    }

    res.json({ status: "ok", day, items });
  });
}

module.exports = {
  register,
  normalizeKeyName,
  extractYoutubeVideoId,
};
