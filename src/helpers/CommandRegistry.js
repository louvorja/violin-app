/**
 * CommandRegistry — Registro central de ações (commands) do app.
 * Usado pelo Command Palette (Ctrl+K).
 *
 * Cada comando tem:
 *   - id: string único
 *   - title: label exibido
 *   - keywords: array de strings adicionais para fuzzy match
 *   - tracks?: number[] — números de hino da música (busca por número exato)
 *   - icon: mdi-icon-name
 *   - category: "action" | "module" | "music" | "hymn" | "bible" | "favorite" | "recent"
 *   - shortcut?: string (ex: "Ctrl+K") — apenas exibido, não registra
 *   - subtitle?: string — subtítulo exibido abaixo do título
 *   - run: () => void  — executa o comando
 * @category deve-virar-composable — Usa Modules (AppData) e useMedia composable.
 */

import Fuse from "fuse.js";
import Modules from "@/helpers/Modules";
import Media from "@/composables/useMedia";
import Platform from "@/helpers/Platform";
import { loadCustomMusicCatalog } from "@/helpers/CustomMusicCatalog";
import { executeMusic } from "@/helpers/MusicExecution";
import { currentMediaKind, openMediaWindow } from "@/helpers/ProjectionWindows";
import { ICONS } from "@/config/Icons";
import { hymnalTracks } from "@/helpers/Hymnal";
import { KEYS, moduleShowInMainMenu } from "@/constants/UserDataKeys";
import {
  albumYears,
  prepareMusicCatalog,
  visibleMusic,
  musicTitle,
  musicAlbumLabel,
  compareMusics,
} from "@root/config/musicCatalog.mjs";

let _loaded = false;
let _commands = [];
let _fuse = null;
let _externalCommands = [];
let _visibleCommands = [];
let _initialLoad = null;
let _customRevision = 0;

function _buildIndex() {
  _fuse = new Fuse(_visibleCommands, {
    keys: [
      { name: "title", weight: 2 },
      { name: "keywords", weight: 1 },
      { name: "subtitle", weight: 0.5 },
    ],
    threshold: 0.3,
    ignoreLocation: true,
    minMatchCharLength: 1,
  });
}

/** Registra um comando dinâmico (ex: módulo externo) */
export function register(command) {
  _externalCommands.push(command);
  if (_loaded) {
    _commands.push(command);
    _visibleCommands.push(command);
    _buildIndex();
  }
}

/** Retorna true se os comandos já foram carregados */
export function isLoaded() {
  return _loaded;
}

/** Reaplica preferências ao cache, inclusive enquanto a paleta está aberta. */
export function visibleCommands(disabled = []) {
  _visibleCommands = _commands.flatMap((command) => {
    if (!command.music) return [command];
    const music = visibleMusic(command.music, disabled);
    return music
      ? [
          {
            ...command,
            music,
            title: musicTitle(music),
            tracks: hymnalTracks(music),
            subtitle: musicAlbumLabel(music, command.customLabel),
          },
        ]
      : [];
  });
  _buildIndex();
  return _visibleCommands;
}

/**
 * Busca fuzzy nos comandos carregados.
 * @param {string} query
 * @param {{ limit?: number, offset?: number, signal?: AbortSignal }} opts
 * @returns {{ results: Array, hasMore: boolean }}
 */
export function search(query, { limit = 50, offset = 0, signal } = {}) {
  if (!_fuse || !_commands.length) return { results: [], hasMore: false };
  if (signal?.aborted) return { results: [], hasMore: false };

  const raw = _fuse.search(query).map((r) => r.item);
  // Preserva os lugares das ações; ordena as músicas pelos álbuns mais recentes.
  const musics = raw
    .filter((command) => command.category === "music")
    .sort((a, b) => compareMusics(a.music, b.music));
  let musicIndex = 0;
  const ordered = raw.map((command) =>
    command.category === "music" ? musics[musicIndex++] : command
  );

  if (signal?.aborted) return { results: [], hasMore: false };

  return {
    results: ordered.slice(offset, offset + limit),
    hasMore: raw.length > offset + limit,
  };
}

/** Comandos estáticos do sistema */
function staticCommands(t) {
  return [
    // Módulos
    {
      id: "module:liturgy",
      title: t("shell.cmd.open_liturgy"),
      keywords: ["liturgia", "culto", "programa"],
      icon: ICONS.UI.VIEW_LIST,
      category: "module",
      run: () => Modules.open("liturgy"),
    },
    {
      id: "module:bible",
      title: t("shell.cmd.open_bible"),
      keywords: ["biblia", "versiculo", "scripture"],
      icon: ICONS.MODULES.BIBLE,
      category: "module",
      run: () => Modules.open("bible"),
    },
    {
      id: "module:hymnal",
      title: t("shell.cmd.open_hymnal"),
      keywords: ["hino", "hinario", "cantai"],
      icon: ICONS.MUSIC.CLEF,
      category: "module",
      run: () => Modules.open("hymnal"),
    },
    {
      id: "module:musics",
      title: t("shell.cmd.open_musics"),
      keywords: ["musicas", "songs", "louvor"],
      icon: ICONS.MUSIC.MUSIC,
      category: "module",
      run: () => Modules.open("musics"),
    },
    {
      id: "module:favorites",
      title: t("shell.cmd.open_favorites"),
      keywords: ["favoritos", "estrela", "salvos"],
      icon: ICONS.MODULES.FAVORITES,
      category: "module",
      run: () => Modules.open("favorites"),
    },
    {
      id: "module:history",
      title: t("shell.cmd.open_history"),
      keywords: ["historico", "recentes"],
      icon: ICONS.MODULES.HISTORY,
      category: "module",
      run: () => Modules.open("history"),
    },
    {
      id: "module:slide_editor",
      title: t("shell.cmd.open_slide_editor"),
      keywords: ["editor", "slides", "personalizar"],
      icon: ICONS.MODULES.SLIDE_EDITOR,
      category: "module",
      run: () => Modules.open("slide_editor"),
    },
    // Ações de mídia
    {
      id: "media:close",
      title: t("shell.cmd.close_media"),
      keywords: ["fechar", "stop", "parar"],
      icon: ICONS.PLAYER.STOP,
      category: "action",
      shortcut: "Esc",
      run: () => Media.close(true),
    },
    {
      id: "media:next",
      title: t("shell.cmd.next_slide"),
      keywords: ["proximo", "next", "avancar"],
      icon: ICONS.PLAYER.NEXT,
      category: "action",
      shortcut: "PgDn",
      run: () => Media.nextSlide(),
    },
    {
      id: "media:prev",
      title: t("shell.cmd.prev_slide"),
      keywords: ["anterior", "previous", "voltar"],
      icon: ICONS.PLAYER.PREV,
      category: "action",
      shortcut: "PgUp",
      run: () => Media.prevSlide(),
    },

    // Tema
    {
      id: "theme:toggle",
      title: t("shell.cmd.toggle_theme"),
      keywords: ["tema", "dark", "light", "escuro", "claro"],
      icon: ICONS.UI.THEME_LIGHT_DARK,
      category: "action",
      run: () => {
        // Quem sabe trocar de tema é a shell; a palette só avisa.
        window.dispatchEvent(new CustomEvent("louvorja:toggle-theme"));
      },
    },

    // Projeção
    {
      id: "projection:open",
      title: t("shell.cmd.open_projection"),
      keywords: ["projetar", "projection", "monitor"],
      icon: ICONS.PROJECTION.PRESENTATION,
      category: "action",
      run: () => {
        void openMediaWindow("projection", currentMediaKind(), { explicit: true });
      },
    },
    {
      id: "operator:open",
      title: t("shell.cmd.open_operator"),
      keywords: ["operador", "grade", "operator"],
      icon: ICONS.UI.VIEW_GRID,
      category: "action",
      run: () => {
        void openMediaWindow("operator", currentMediaKind(), { explicit: true });
      },
    },
  ];
}

/** Pega comandos dinâmicos: músicas, favoritos, histórico recente */
async function dynamicCommands($database, $userdata) {
  const lang = $userdata.get(KEYS.OPTIONS.LANGUAGE, "pt") || "pt";
  const dynamic = [];

  // Favoritos
  const favorites = $userdata.get("favorites", []);
  if (Array.isArray(favorites)) {
    favorites.forEach((f) => {
      if (!f || !f.id_music) return;
      dynamic.push({
        id: `fav:${f.id_music}`,
        title: f.name || String(f.id_music),
        keywords: ["favorito"],
        icon: ICONS.UI.STAR,
        category: "favorite",
        run: () => executeMusic({ id_music: Number(f.id_music) }),
      });
    });
  }

  // Histórico (últimas 20)
  const history = $userdata.get("history", []);
  const historyList = Array.isArray(history) ? history.slice(0, 20) : [];
  historyList.forEach((h) => {
    if (!h || !h.id_music) return;
    dynamic.push({
      id: `hist:${h.id_music}`,
      title: h.name || String(h.id_music),
      keywords: ["recente", "historico"],
      icon: ICONS.UI.HISTORY,
      category: "recent",
      run: () => executeMusic({ id_music: Number(h.id_music) }),
    });
  });

  // Músicas (lista do banco) — pode ser grande, carrega lazy só se solicitado
  try {
    const [musics, categories] = await Promise.all([
      $database.get(`${lang}_musics`),
      $database.get(`${lang}_categories`, { silent: true }).catch(() => []),
    ]);
    if (Array.isArray(musics)) {
      const catalog = prepareMusicCatalog(musics, [], albumYears(categories));
      const byId = new Map(catalog.map((music) => [Number(music.id_music), music]));
      dynamic.forEach((command) => {
        const id = Number(command.id.split(":")[1]);
        command.music = byId.get(id);
      });
      const limited = catalog.slice(0, 5000);
      limited.forEach((m) => {
        if (!m || !m.id_music) return;
        const tracks = hymnalTracks(m);
        dynamic.push({
          id: `music:${m.id_music}`,
          title: m.name || String(m.id_music),
          keywords: ["musica"],
          tracks,
          music: m,
          icon: ICONS.MUSIC.NOTE,
          category: "music",
          subtitle: m.albums_names || "",
          run: () => executeMusic({ id_music: Number(m.id_music) }),
        });
      });
    }
  } catch (e) {
    console.warn("[CommandRegistry] Falha ao carregar músicas:", e);
  }

  return dynamic;
}

/** Cacheia o catálogo remoto e relê o acervo pessoal a cada abertura da paleta. */
export async function getAll($database, $userdata, t) {
  const saved = $userdata.get(KEYS.OPTIONS.DISABLED_ALBUMS, []);
  const disabled = Array.isArray(saved) ? [...saved] : [];
  if (!$userdata.get(moduleShowInMainMenu("hymnal_1996"), false)) disabled.push(629);
  if (!_loaded && !_initialLoad) {
    _initialLoad = dynamicCommands($database, $userdata).then((dyn) => {
      _commands = [...staticCommands(t), ...dyn, ..._externalCommands];
      _loaded = true;
    });
  }
  const revision = ++_customRevision;
  const custom = Platform.isRemote ? [] : await loadCustomMusicCatalog();
  await _initialLoad;
  if (revision === _customRevision) {
    const customLabel = t("components.music_search.custom_album");
    _commands = [
      ..._commands.filter((command) => !command.id.startsWith("custom-music:")),
      ...custom.map((music) => ({
        id: `custom-music:${music.custom_song_id}`,
        title: music.name,
        keywords: ["musica", ...(music.custom_collection_names || [])],
        music,
        customLabel,
        icon: ICONS.MUSIC.NOTE,
        category: "music",
        run: () =>
          executeMusic({ id_music: Number(music.id_music), custom_song_id: music.custom_song_id }),
      })),
    ];
  }
  return visibleCommands(disabled);
}

export default { register, getAll, search, isLoaded, visibleCommands };
