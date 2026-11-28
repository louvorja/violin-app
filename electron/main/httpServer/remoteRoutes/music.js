"use strict";

/**
 * Rotas de busca e biblioteca de músicas no controle remoto.
 *
 * GET /api/music-search       — busca no catálogo oficial + acervo pessoal
 * GET /api/music-library      — álbuns e faixas para navegar
 * GET /api/music-library/image — capa de álbum / ícone do hinário
 */
const path = require("path");
const fs = require("fs");
const jsonCache = require("../../jsonCache.js");
const docStore = require("../../docStore.js");
const mediaResolver = require("../../mediaResolver.js");
const { createMusicSearchCatalog, normalize } = require("../musicSearchCatalog.js");
const { musicCatalogRules } = require("../musicCatalogLoader.js");


/** Teto do acervo pessoal de músicas no renderer. */
const CUSTOM_SONGS_MAX_BYTES = 8 * 1024 * 1024;


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
function officialAlbumPayload(album, count = 0) {
  const subtitle = typeof album.subtitle === "string" && album.subtitle.trim() ? album.subtitle : null;
  return {
    id: `album:${Number(album.id_album)}`,
    title: String(album.name || "").slice(0, 1_000),
    subtitle: subtitle ? subtitle.slice(0, 300) : null,
    // Faixas do catálogo `{lang}_musics` — 0 quando o álbum não tem faixas
    // (mesma régua de `action=songs`: o badge nunca promete o que a lista
    // de faixas não entrega).
    count,
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


/**
 * Cores do ícone por módulo — espelham `src/modules/hymnal{,_1996}/manifest.ts`
 * (`color`), o mesmo tom que o desktop aplica no glifo do módulo.
 */
const HYMNAL_MODULE_COLORS = {
  current: "#c0392b",
  legacy: "#7d3c98",
};


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
 * Registra as rotas de música.
 *
 * @param {import("express").Application} app
 * @param {object} ctx deps do setupRoutes (ver routes.js)
 */
function register(app, ctx) {
  const {
    getValidMainWindow,
    requestRenderer,
    sendRendererError,
    getUserData,
    getDatabaseUrl,
    getApiToken,
    hasDevicePermission,
    isPlainObject,
    isCustomSongsSearchResponse,
  } = ctx;


  /**
   * Garante que o JSON exista no jsonCache; se ainda não está no disco, baixa
   * do banco remoto e grava ali — o mesmo caminho do `louvorja://json_db` que
   * o renderer usa ao abrir um álbum/hinário.
   *
   * Sem isso, as rotas do controle remoto só enxergavam o que o desktop já
   * tinha aberto alguma vez: `album_<id>.json` e `{lang}_hymnal*.json` são
   * baixados sob demanda pelo renderer, não pelo sync.
   *
   * @returns `true` quando o arquivo está (ou passou a estar) disponível.
   */
  async function ensureJsonCache(relPath) {
    const filePath = jsonCache.safeLocalPath(relPath);
    try {
      await fs.promises.access(filePath);
      return true;
    } catch {
      /* ainda não existe no disco */
    }
    const databaseUrl = typeof getDatabaseUrl === "function" ? getDatabaseUrl() : "";
    if (!databaseUrl) return false;
    try {
      const apiToken = typeof getApiToken === "function" ? getApiToken() : "";
      const headers = apiToken ? { "Api-Token": apiToken } : {};
      const result = await jsonCache.fetchJson(relPath, databaseUrl, headers);
      return result?.status === 200 && Boolean(result.body);
    } catch (error) {
      console.warn(
        `[httpServer] jsonCache fetch ${relPath}: ${error?.code || error?.message || error}`
      );
      return false;
    }
  }

  /** JSON do jsonCache, baixando do banco remoto quando ainda não está no disco. */
  async function readJsonCacheOrFetch(relPath) {
    const filePath = jsonCache.safeLocalPath(relPath);
    try {
      return JSON.parse(await fs.promises.readFile(filePath, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (!(await ensureJsonCache(relPath))) return null;
    return readJsonCacheOrNull(filePath);
  }

  /**
   * Contagem de faixas por álbum a partir do catálogo `{lang}_musics`.
   *
   * Uma leitura do catálogo (cacheado, ~1,9 MB) em vez de baixar cada
   * `album_<id>.json`: dá a contagem de todos os álbuns já na lista. A régua
   * é a mesma da lista de faixas — só `id_music > 0` e um voto por álbum.
   */
  async function albumTrackCounts(lang) {
    const catalog = await readJsonCacheOrFetch(`${lang}_musics`);
    const counts = new Map();
    if (!Array.isArray(catalog)) return counts;
    for (const music of catalog) {
      if (!music || Number(Number(music.id_music)) <= 0) continue;
      const seen = new Set();
      for (const association of Array.isArray(music.albums) ? music.albums : []) {
        const albumId = Number(association?.id_album);
        if (!Number.isFinite(albumId) || albumId <= 0 || seen.has(albumId)) continue;
        seen.add(albumId);
        counts.set(albumId, (counts.get(albumId) || 0) + 1);
      }
    }
    return counts;
  }


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
  // /api/music-search?q=...&lang=pt (GET — somente leitura)
  // ---------------------------------------------------------------
  app.get("/api/music-search", async (req, res) => {
    if (!hasDevicePermission(req, "music")) {
      console.log("[httpServer] music-search → 403 (device sem a permission music)");
      return res.status(403).json({ error: "Device sem permissão de música" });
    }
    const q = req.query.q;
    if (typeof q !== "string" || !q.trim() || (q.trim().length < 2 && !/^\d+$/.test(q.trim()))) {
      return res.json({ status: "ok", results: [] });
    }
    const lang = req.query.lang === "es" ? "es" : "pt";
    const query = normalize(q.trim());

    try {
      const filePath = jsonCache.safeLocalPath(`${lang}_musics`);
      // Base ausente no disco: baixa na hora (mesmo caminho do renderer) —
      // antes a busca dava 404 até o desktop abrir o módulo de música.
      await ensureJsonCache(`${lang}_musics`);
      await ensureJsonCache(`${lang}_categories`);
      let results;
      try {
        const userData = typeof getUserData === "function" ? getUserData() : {};
        const disabled = Array.isArray(userData?.options?.disabled_albums)
          ? [...userData.options.disabled_albums] : [];
        // Só `disabled_albums` filtra: o toggle `show_in_main_menu` controla a
        // visibilidade do módulo no desktop, não a disponibilidade do acervo.
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
  // A lista usa jsonCache e docStore; as faixas também consultam o IndexedDB
  // do renderer, onde o instalador do bundle grava os detalhes dos álbuns.
  // ---------------------------------------------------------------
  app.get("/api/music-library", async (req, res) => {
    if (!hasDevicePermission(req, "music")) {
      console.log("[httpServer] music-library → 403 (device sem a permission music)");
      return res.status(403).json({ error: "Device sem permissão de música" });
    }
    try {
      const action = req.query.action || "albums";
      const lang = req.query.lang === "es" ? "es" : "pt";

      if (action === "albums") {
        const categories = await readJsonCacheOrFetch(`${lang}_categories`);
        if (!Array.isArray(categories)) {
          return res.status(404).json({
            error: "Base de músicas não encontrada localmente. Faça uma atualização do banco.",
          });
        }

        // Álbuns desativados pelo operador — `disabled_albums` é a fonte
        // única. O toggle `hymnal_1996.show_in_main_menu` controla só a
        // visibilidade do módulo no desktop (o acervo continua disponível).
        const userData = typeof getUserData === "function" ? getUserData() : {};
        const disabled = [...(userData?.options?.disabled_albums ?? [])];

        const { albumYear, isAlbumEnabled, HYMNAL_ALBUM_IDS } = await musicCatalogRules;

        // Achata categorias → álbuns (dedup por id_album), filtra e ordena como
        // o módulo Álbuns do desktop (ano desc, depois nome).
        const trackCounts = await albumTrackCounts(lang);
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
          .map((album) =>
            officialAlbumPayload(album, trackCounts.get(Number(album.id_album)) || 0)
          );

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
          const file = await readJsonCacheOrFetch(
            which === "legacy" ? `${lang}_hymnal_1996` : `${lang}_hymnal`
          );
          if (!Array.isArray(file)) continue;
          const moduleId = which === "legacy" ? "hymnal_1996" : "hymnal";
          hinarios.push({
            id: `album:${albumId}`,
            title: hymnalTitle(lang, which),
            subtitle: null,
            count: file.length,
            source: "official",
            // Módulo dono do álbum — os clientes usam o ícone do módulo (a
            // mesma marca do desktop). A imagem vem do endpoint de ícones:
            // PNG quadrado pré-tintado, servido pelo backend — os apps não
            // precisam embarcar o SVG/PNG da marca.
            module_id: moduleId,
            color: which === "legacy" ? HYMNAL_MODULE_COLORS.legacy : HYMNAL_MODULE_COLORS.current,
            image: `/api/music-library/image?path=icons/${moduleId}.png`,
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
          if (!Number.isSafeInteger(Number(id)) || Number(id) <= 0) {
            return res.status(400).json({ error: "album inválido" });
          }
          const userData = typeof getUserData === "function" ? getUserData() : {};
          if ((userData?.options?.disabled_albums ?? []).some((value) => Number(value) === Number(id))) {
            return res.status(404).json({ error: "Álbum não encontrado no banco local" });
          }
          // Hinários não têm `album_<id>.json`: as faixas vêm direto de
          // `{lang}_hymnal[_1996].json`. `disabled_albums` é a fonte única —
          // o toggle do módulo não esconde o acervo.
          const { HYMNAL_ALBUM_IDS } = await musicCatalogRules;
          const isCurrentHymnal = Number(id) === HYMNAL_ALBUM_IDS.current;
          const isLegacyHymnal = Number(id) === HYMNAL_ALBUM_IDS.legacy;
          if (isCurrentHymnal || isLegacyHymnal) {
            const userData = typeof getUserData === "function" ? getUserData() : {};
            const disabled = [...(userData?.options?.disabled_albums ?? [])];
            const enabled = !disabled.some((value) => String(value) === id);
            const hymnFile = enabled
              ? await readJsonCacheOrFetch(
                  isLegacyHymnal ? `${lang}_hymnal_1996` : `${lang}_hymnal`
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

          let detail = null;
          let rendererError = null;
          const mainWindow = getValidMainWindow();
          if (mainWindow) {
            try {
              const reply = await requestRenderer(
                mainWindow,
                res,
                "http:music-album",
                { albumId: Number(id) },
                {
                  prefix: "music-album",
                  timeoutMs: 8_000,
                  maxPayloadBytes: 8 * 1024 * 1024,
                  validatePayload: (payload) => {
                    if (!isPlainObject(payload)) return false;
                    const album = payload.album;
                    if (album === null) return true;
                    return (
                      isPlainObject(album) &&
                      album.id_album === Number(id) &&
                      typeof album.name === "string" &&
                      album.name.length <= 1_000 &&
                      Array.isArray(album.musics) &&
                      album.musics.length <= 5_000 &&
                      album.musics.every(
                        (music) =>
                          isPlainObject(music) &&
                          Number.isSafeInteger(music.id_music) &&
                          music.id_music >= 0 &&
                          typeof music.name === "string" &&
                          music.name.length <= 500 &&
                          ((typeof music.duration === "string" && music.duration.length <= 16) ||
                            (Number.isFinite(music.duration) && music.duration >= 0)) &&
                          (music.has_instrumental_music === 0 || music.has_instrumental_music === 1)
                      )
                    );
                  },
                }
              );
              detail = reply.album;
            } catch (error) {
              rendererError = error;
            }
          }
          if (
            res.headersSent ||
            res.writableEnded ||
            res.destroyed ||
            rendererError?.code === "CLIENT_CLOSED"
          )
            return;
          // Instalações anteriores ainda podem ter apenas o cache em disco; sem
          // ele, o banco remoto (o download sob demanda do controle remoto).
          detail ??= await readJsonCacheOrFetch(`album_${id}`);
          if (!detail) {
            if (rendererError)
              return sendRendererError(res, rendererError, "Timeout ao buscar músicas do álbum");
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
    // Capa é parte da navegação de músicas: mesma role do `/api/music-library`.
    if (!hasDevicePermission(req, "music")) {
      console.log("[httpServer] music-library/image → 403 (device sem a permission music)");
      return res.status(403).json({ error: "Device sem permissão de música" });
    }
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

    // Ícones do próprio app (hinários): moram em electron/main/httpServer/
    // icons/, fora do acervo de mídia do usuário — mesmo mime/cache das capas.
    // A regex não aceita `/` nem `..` depois de `icons/` (sem traversal); o
    // arquivo precisa existir no diretório, senão 404.
    const appIcon = relative.match(/^icons\/([a-z0-9_-]+)\.png$/);
    if (appIcon) {
      try {
        const data = await fs.promises.readFile(
          path.join(__dirname, "..", "icons", `${appIcon[1]}.png`)
        );
        res.set("Content-Type", "image/png");
        res.set("Cache-Control", "private, max-age=86400");
        return res.send(data);
      } catch {
        return res.status(404).json({ error: "Ícone não encontrado" });
      }
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
}


module.exports = { register };
