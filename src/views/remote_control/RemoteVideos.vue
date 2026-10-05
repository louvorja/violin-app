<template>
  <div class="rv-root">
    <!-- Campo híbrido: texto pesquisa nos DOIS acervos; URL projeta. -->
    <div class="rv-search">
      <div class="rv-search__field">
        <LjInput
          v-model="query"
          size="touch"
          clearable
          :placeholder="t('remote_control.videos.search_placeholder')"
          :aria-label="t('remote_control.videos.search_placeholder')"
          :icon="ICONS.ACTIONS.SEARCH"
          @update:model-value="onSearch"
          @keydown.enter="onEnter"
        />
      </div>
      <LjButton
        size="touch"
        variant="primary"
        :icon="ICONS.PLAYER.PLAY_OUTLINE"
        :disabled="!isVideoUrl(query)"
        @click="projectUrl"
      >
        {{ t("remote_control.videos.project_url") }}
      </LjButton>
    </div>

    <!-- Resultados da pesquisa: os DOIS acervos. -->
    <template v-if="searching">
      <ul v-if="results.length > 0" class="rv-list">
        <li v-for="video in results" :key="video.url" class="rv-item" @click="project(video)">
          <img
            v-if="imageUrl(video.image)"
            class="rv-item__thumb"
            :src="imageUrl(video.image)"
            loading="lazy"
            alt=""
          />
          <div class="rv-item__text">
            <span class="rv-item__title">{{ video.title }}</span>
            <span v-if="video.channel" class="rv-item__subtitle lj-u-truncate">
              {{ video.channel }}
            </span>
          </div>
          <LjButton
            variant="ghost"
            size="lg"
            :icon="ICONS.PLAYER.PLAY_OUTLINE"
            icon-only
            :title="t('remote_control.videos.project_url')"
            @click.stop="project(video)"
          />
        </li>
      </ul>
      <div v-else-if="!loading" class="rv-state lj-u-text-center lj-u-muted">
        {{ t("remote_control.videos.empty_search") }}
      </div>
      <div v-else class="rv-state rv-state--loading lj-u-text-center">
        <LjSpinner :size="24" />
      </div>
    </template>

    <!-- Sem pesquisa: álbuns, ou os vídeos do álbum aberto. -->
    <template v-else>
      <!-- Voltar + nome do que estamos navegando na mesma linha. -->
      <div v-if="album" class="rv-head">
        <button type="button" class="rv-back" @click="closeAlbum">
          ← {{ t("remote_control.videos.back") }}
        </button>
        <span class="rv-head__title">{{ albumHeaderText(album) }}</span>
      </div>

      <ul v-if="rows.length > 0" class="rv-list">
        <template v-for="row in rows" :key="row.key">
          <li v-if="row.kind === 'group'" class="rv-group">{{ row.label }}</li>
          <li v-else class="rv-item" @click="row.action()">
            <img v-if="row.thumb" class="rv-item__thumb" :src="row.thumb" loading="lazy" alt="" />
            <div class="rv-item__text">
              <span class="rv-item__title">{{ row.title }}</span>
              <span v-if="row.subtitle" class="rv-item__subtitle lj-u-truncate">
                {{ row.subtitle }}
              </span>
            </div>
            <span v-if="row.badge" class="rv-item__badge">{{ row.badge }}</span>
            <LjButton
              v-if="row.playable"
              variant="ghost"
              size="lg"
              :icon="ICONS.PLAYER.PLAY_OUTLINE"
              icon-only
              @click.stop="row.action()"
            />
          </li>
        </template>
      </ul>
      <div v-else-if="!loading" class="rv-state lj-u-text-center lj-u-muted">
        {{ t("remote_control.videos.empty_albums") }}
      </div>
      <div v-else class="rv-state rv-state--loading lj-u-text-center">
        <LjSpinner :size="24" />
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { LjButton, LjInput, LjSpinner } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { apiFetch, postApi } from "@/helpers/ApiClient";

/** Álbum: uma playlist do catálogo ou uma categoria dos Meus Vídeos. */
interface OnlineVideoAlbum {
  id: string;
  title: string | null;
  subtitle: string | null;
  count: number;
  source: "online" | "custom";
  image?: string | null;
}

interface OnlineVideo {
  id: string;
  title: string;
  url: string;
  source: "online" | "custom";
  image?: string | null;
  /** Canal dono do vídeo (terceira linha do card); nulo em Meus Vídeos. */
  channel?: string | null;
}

const props = defineProps<{ token?: string }>();

const emit = defineEmits<{
  (e: "show-snackbar", message: string, type?: string): void;
}>();

const { t, locale } = useI18n();

const query = ref("");
const results = ref<OnlineVideo[]>([]);
const loading = ref(false);
const albums = ref<OnlineVideoAlbum[]>([]);
const album = ref<OnlineVideoAlbum | null>(null);
const videos = ref<OnlineVideo[]>([]);
let searchTimeout: ReturnType<typeof setTimeout> | null = null;

// Campo no modo URL (projeta): não é busca, então não entra na lista de results.
const searching = computed(() => {
  const term = query.value.trim();
  return term.length >= 2 && !isVideoUrl(term);
});
const sourceLabel = (source: OnlineVideo["source"]) =>
  t(source === "custom" ? "remote_control.videos.mine" : "remote_control.videos.catalog");

/**
 * URL da miniatura: `http(s)` do catálogo remoto vai direto; caminho relativo
 * (`/api/online-videos/image?...`) é o desktop servindo o blob do IndexedDB e
 * precisa do token do controle web. `""` = sem thumb (o card fica sem imagem).
 */
const imageUrl = (raw?: string | null): string => {
  if (!raw) return "";
  if (/^https?:\/\//.test(raw)) return raw;
  const sep = raw.includes("?") ? "&" : "?";
  return `${raw}${sep}token=${props.token ?? ""}`;
};

/**
 * O campo híbrido está no modo **URL** (projeta) e não de busca? Mesmas regras
 * do KMP (`ViolinApiClient.isVideoUrl`): esquema, `www.` e atalhos do YouTube —
 * o desktop valida o link de verdade na rota e responde 400 para o resto.
 */
const isVideoUrl = (text: string): boolean => {
  const value = text.trim().toLowerCase();
  if (!value) return false;
  return (
    value.startsWith("http://") ||
    value.startsWith("https://") ||
    value.startsWith("www.") ||
    value.startsWith("youtube.com/") ||
    value.startsWith("m.youtube.com/") ||
    value.startsWith("youtu.be/")
  );
};

/** Linha da lista: cabeçalho de grupo ou um card (á/vídeo). */
type Row =
  | { kind: "group"; key: string; label: string }
  | {
      kind: "item";
      key: string;
      title: string;
      subtitle: string;
      badge: string | null;
      thumb: string;
      playable: boolean;
      action: () => void;
    };

/** Nome de quem estamos navegando: `título — canal` (mesmo texto do app). */
const albumHeaderText = (entry: OnlineVideoAlbum): string =>
  [entry.title ?? t("remote_control.videos.uncategorized"), entry.subtitle ?? ""]
    .filter((part) => part.length > 0)
    .join(" — ");

const videoRow = (video: OnlineVideo): Row => ({
  kind: "item",
  key: video.url,
  title: video.title,
  // Terceira linha: o canal (Meus Vídeos não têm → Some).
  subtitle: video.channel ?? "",
  badge: null,
  thumb: imageUrl(video.image),
  playable: true,
  action: () => project(video),
});

const albumRow = (entry: OnlineVideoAlbum): Row => ({
  kind: "item",
  key: entry.id,
  title: entry.title || t("remote_control.videos.uncategorized"),
  subtitle: entry.subtitle || sourceLabel(entry.source),
  badge: String(entry.count),
  thumb: imageUrl(entry.image),
  playable: false,
  action: () => openAlbum(entry),
});

/**
 * Cabeçalhos fixos ("Vídeos Online" / "Meus Vídeos Online") com os itens de
 * cada grupo — e, com um álbum aberto, o mesmo cabeçalho passa a mostrar o
 * nome do que estamos navegando (playlist/categoria), como no app.
 */
const rows = computed<Row[]>(() => {
  // Com um álbum aberto, o cabeçalho com o nome fica na barra do voltar
  // (`.rv-head`) — a lista só traz os vídeos.
  if (album.value) return videos.value.map(videoRow);

  const catalogo = albums.value.filter((entry) => entry.source === "online");
  const meus = albums.value.filter((entry) => entry.source === "custom");
  const linhas: Row[] = [];
  if (catalogo.length > 0) {
    linhas.push({ kind: "group", key: "g-catalogo", label: t("remote_control.videos.catalog") });
    linhas.push(...catalogo.map(albumRow));
  }
  if (meus.length > 0) {
    linhas.push({ kind: "group", key: "g-meus", label: t("remote_control.videos.mine") });
    linhas.push(...meus.map(albumRow));
  }
  return linhas;
});

/**
 * Texto do erro de uma resposta HTTP.
 *
 * O desktop manda `error` pronto (ex.: "Timeout ao buscar vídeos online",
 * "Device sem permissão de vídeos online") — sem isto a aba virava lista vazia
 * e o operador não sabia se era conteúdo ou falha.
 */
async function mensagemDeErro(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    if (body.error) return body.error;
  } catch {
    /* corpo não é JSON */
  }
  return `${t("remote_control.errors.generic")}: ${res.status}`;
}

/** Busca os álbuns dos dois acervos. */
async function fetchAlbums(): Promise<void> {
  try {
    const lang = locale.value || "pt";
    const res = await apiFetch(
      `/api/online-videos?action=albums&lang=${lang}&token=${props.token}`
    );
    if (res.ok) {
      const data = (await res.json()) as { albums?: OnlineVideoAlbum[] };
      albums.value = data.albums || [];
    } else {
      albums.value = [];
      emit("show-snackbar", await mensagemDeErro(res), "error");
    }
  } catch (e) {
    console.error("[RemoteVideos] albums error:", e);
    albums.value = [];
    emit("show-snackbar", t("remote_control.errors.generic"), "error");
  }
}

/** Busca os vídeos de um álbum. */
async function fetchAlbumVideos(entry: OnlineVideoAlbum): Promise<void> {
  try {
    const lang = locale.value || "pt";
    const res = await apiFetch(
      `/api/online-videos?action=videos&album=${encodeURIComponent(entry.id)}&lang=${lang}&token=${props.token}`
    );
    if (res.ok) {
      const data = (await res.json()) as { videos?: OnlineVideo[] };
      videos.value = data.videos || [];
    } else {
      videos.value = [];
      emit("show-snackbar", await mensagemDeErro(res), "error");
    }
  } catch (e) {
    console.error("[RemoteVideos] album error:", e);
    videos.value = [];
    emit("show-snackbar", t("remote_control.errors.generic"), "error");
  }
}

/** Busca o texto digitado nos dois acervos. */
async function fetchSearch(term: string): Promise<void> {
  try {
    const lang = locale.value || "pt";
    const res = await apiFetch(
      `/api/online-videos?action=search&q=${encodeURIComponent(term)}&lang=${lang}&token=${props.token}`
    );
    if (res.ok) {
      const data = (await res.json()) as { videos?: OnlineVideo[] };
      results.value = data.videos || [];
    } else {
      results.value = [];
      emit("show-snackbar", await mensagemDeErro(res), "error");
    }
  } catch (e) {
    console.error("[RemoteVideos] search error:", e);
    results.value = [];
    emit("show-snackbar", t("remote_control.errors.generic"), "error");
  }
}

/**
 * Rebusca o que está na tela: álbuns, o álbum aberto e a busca — é o que o
 * botão **Atualizar** do topo dispara (mesma semântica do puxar-para-baixo
 * no app).
 */
async function refresh(): Promise<void> {
  loading.value = true;
  try {
    await fetchAlbums();
    if (album.value) await fetchAlbumVideos(album.value);
    const q = query.value.trim();
    if (q.length >= 2 && !isVideoUrl(q)) await fetchSearch(q);
  } finally {
    loading.value = false;
  }
}

async function openAlbum(entry: OnlineVideoAlbum): Promise<void> {
  album.value = entry;
  videos.value = [];
  loading.value = true;
  await fetchAlbumVideos(entry);
  loading.value = false;
}

function closeAlbum(): void {
  album.value = null;
  videos.value = [];
}

async function onSearch(): Promise<void> {
  if (searchTimeout) clearTimeout(searchTimeout);
  const q = query.value.trim();
  if (isVideoUrl(q)) {
    results.value = [];
    loading.value = false;
    return;
  }
  if (q.length < 2) {
    results.value = [];
    // Sem isto, limpar a busca antes do debounce deixava o spinner preso:
    // quem zera `loading` era o timer que acabou de ser cancelado.
    loading.value = false;
    return;
  }
  loading.value = true;
  searchTimeout = setTimeout(async () => {
    await fetchSearch(q);
    loading.value = false;
  }, 300);
}

async function project(video: OnlineVideo): Promise<void> {
  await sendPlay({ url: video.url, title: video.title });
}

async function projectUrl(): Promise<void> {
  const value = query.value.trim();
  if (!isVideoUrl(value)) return;
  await sendPlay({ url: value, title: value });
}

/** Enter projeta quando o campo está no modo URL (a busca já roda no digitar). */
function onEnter(): void {
  if (isVideoUrl(query.value)) void projectUrl();
}

async function sendPlay(payload: { url: string; title: string }): Promise<void> {
  try {
    const res = await postApi("/api/online-videos", { action: "play", ...payload }, props.token);
    if (res.ok) {
      emit("show-snackbar", t("remote_control.videos.projected"));
    } else {
      const err = (await res.json()) as { error?: string };
      emit(
        "show-snackbar",
        `${t("remote_control.videos.project_error")}: ${err.error || res.statusText}`,
        "error"
      );
    }
  } catch (e) {
    emit("show-snackbar", t("remote_control.videos.project_error"), "error");
  }
}

onMounted(() => void refresh());

defineExpose({ refresh });
</script>

<style scoped>
.rv-root {
  padding: var(--lj-space-6);
}

/* O LjInput é inline-flex e encolhe para a largura intrínseca do <input>. */
.rv-search__field :deep(.lj-input) {
  width: 100%;
}

/* Campo híbrido (pesquisa/URL) com o Projecar à direita. */
.rv-search {
  display: flex;
  gap: var(--lj-space-4);
  align-items: center;
}

.rv-search__field {
  flex: 1;
  min-width: 0;
}

/* Voltar + nome do álbum navegando, na mesma linha. */
.rv-head {
  display: flex;
  gap: var(--lj-space-4);
  align-items: center;
  min-width: 0;
  margin-top: var(--lj-space-5);
}

.rv-head__title {
  overflow: hidden;
  min-width: 0;
  color: var(--lj-ui-accent);
  font-size: var(--lj-text-sm);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rv-back {
  display: block;
  flex: none;
  padding: var(--lj-space-3) var(--lj-space-4);
  background: transparent;
  border: none;
  border-radius: var(--lj-ui-radius);
  color: var(--lj-ui-accent);
  font-family: var(--lj-font-shell);
  font-size: var(--lj-text-base);
  cursor: pointer;
}

.rv-back:hover {
  background: var(--lj-surface-bg-hover);
}

.rv-list {
  margin: var(--lj-space-4) 0 0;
  padding: 0;
  list-style: none;
}

/* Cabeçalho fixo por origem (e o nome do álbum aberto) — o mesmo papel do
   cabeçalho de seção da tela de módulos no app. */
.rv-group {
  padding: var(--lj-space-5) var(--lj-space-5) var(--lj-space-2);
  color: var(--lj-ui-accent);
  font-size: var(--lj-text-sm);
  font-weight: 600;
  list-style: none;
}

/* Tela de dedo: a linha inteira é alvo, altura de toque. */
.rv-item {
  display: flex;
  align-items: center;
  gap: var(--lj-space-5);
  min-height: 56px;
  padding: var(--lj-space-4) var(--lj-space-5);
  border-radius: var(--lj-ui-radius);
  cursor: pointer;
}

.rv-item:hover {
  background: var(--lj-surface-bg-hover);
}

/* Miniatura 16:9 do vídeo/playlist/categoria; some quando não há thumb. */
.rv-item__thumb {
  flex: none;
  width: 64px;
  height: 36px;
  object-fit: cover;
  border-radius: var(--lj-ui-radius);
  background: var(--lj-surface-bg-hover);
}

.rv-item__text {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--lj-space-1);
  min-width: 0;
}

/* Título em 2 linhas: o vídeo do catálogo tem detalhe para a segunda —
   o canal fica na linha de baixo. */
.rv-item__title {
  display: -webkit-box;
  overflow: hidden;
  color: var(--lj-text);
  font-size: var(--lj-text-xl);
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.rv-item__subtitle {
  color: var(--lj-text-muted);
  font-size: var(--lj-text-lg);
}

.rv-item__badge {
  color: var(--lj-text-muted);
  font-size: var(--lj-text-lg);
}

.rv-state {
  margin-top: var(--lj-space-8);
  font-size: var(--lj-text-lg);
}

.rv-state--loading {
  color: var(--lj-ui-accent);
}
</style>
