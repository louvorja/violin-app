import $liturgy from "@/helpers/Liturgy";
import $media from "@/composables/useMedia";
import { heicToJpeg } from "@/helpers/ImageConvert";
import { KEYS } from "@/constants/UserDataKeys";
import $alert from "@/helpers/Alert";
import $path from "@/helpers/Path";
import $broadcast from "@/helpers/Broadcast";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import { useFileProjection } from "@/composables/useFileProjection";
import { openFileProjectionWindows, openAnnouncementsWindow } from "@/helpers/ProjectionWindows";
import $appdata from "@/helpers/AppData";
import $userdata from "@/helpers/UserData";
import $idb from "@/helpers/IndexedDB";
import { DB_TABLE } from "@/constants/DbTables";
import Platform from "@/helpers/Platform";
import { LiturgyItemTypeEnum } from "@/enums/LiturgyItemTypeEnum";
import { MusicActionEnum } from "@/enums/MusicActionEnum";
import { useBackgroundSound } from "@/composables/useBackgroundSound";
import {
  readAllSlots as readAllOverlaySlots,
  writeSlot as writeOverlaySlot,
} from "@/helpers/Overlay";
import type { LiturgyItem } from "@/types/Liturgy";
import { AUDIO_EXT, IMAGE_EXT, VIDEO_EXT } from "@constants/FileTypes";
import { fetchWithTimeout, NET_TIMEOUT } from "@/helpers/Http";
import { useLiturgyI18n, chaveLiturgia } from "../i18n";

/**
 * Executar um item da liturgia — tocar a música, projetar o arquivo, abrir o
 * site, ligar o overlay.
 *
 * Mora aqui, e não dentro de `useLiturgyItems`, porque tem mais de um
 * consumidor: a tela do módulo e o painel de liturgia da shell. Enquanto essa
 * lógica era privada do módulo, o painel sabia executar só música e site — todo
 * o resto abria a tela de liturgia e devolvia o problema para o operador, no
 * meio do culto. Duplicar não era opção: são dez tipos de item, cada um com sua
 * janela de projeção, seu cache no IDB e seu jeito de morrer.
 */
export function useLiturgyExecution() {
  const { t } = useLiturgyI18n();

  /** Instância compartilhada com o módulo Som de Fundo (mesmo player). */
  const $bgSound = useBackgroundSound();

  function isYoutube(url: string | undefined | null): boolean {
    if (!url) return false;
    return /youtu\.?be/i.test(url);
  }

  /* ============== Item execution ============== */
  function executeItem(item: LiturgyItem): void {
    switch (item.tipo) {
      case LiturgyItemTypeEnum.MUSICA:
        playMusic(item, item.subtipo || "sung");
        break;
      case LiturgyItemTypeEnum.SITE:
        executeSite(item);
        break;
      case LiturgyItemTypeEnum.ARQUIVO:
        openFile(item);
        break;
      case LiturgyItemTypeEnum.ITENS_AGENDADOS: {
        const activeDate = $liturgy.getActiveDate();
        const sched = $liturgy.findScheduledForToday(item.id, activeDate);
        const arquivo = sched ? String((sched as Record<string, unknown>).arquivo || "") : "";
        if (arquivo) {
          // Segue o fluxo de projeção de arquivos:
          // vídeo → projeção; áudio → reprodutor principal do programa.
          void openFile({
            ...item,
            tipo: LiturgyItemTypeEnum.ARQUIVO,
            dir: arquivo,
          } as LiturgyItem);
        } else {
          $alert.error({ text: chaveLiturgia("dialog.scheduled_not_found") });
        }
        break;
      }
      case LiturgyItemTypeEnum.VIDEO_ONLINE:
        executeOnlineVideo(item);
        break;
      case LiturgyItemTypeEnum.MEDIA_LIBRARY:
        void executeMediaLibraryItem(item);
        break;
      case LiturgyItemTypeEnum.BG_SOUND:
        void executeBgSoundItem(item);
        break;
      case LiturgyItemTypeEnum.ANUNCIOS:
        void executeAnnouncements(item);
        break;
      case LiturgyItemTypeEnum.ANOTACAO:
        // Título e texto entram sem tradução: são o que o operador escreveu.
        $alert.show({ title: item.item, text: item.subitem || "", translate: false });
        break;
      case LiturgyItemTypeEnum.OVERLAY:
        void toggleOverlay(item);
        break;
    }

    // Após execução, ativar overlay vinculado (se houver)
    void activateLinkedOverlay(item);
  }

  async function playMusic(item: LiturgyItem, mode = "sung"): Promise<void> {
    if (item.escolha || !item.id_music) {
      $alert.info({ text: chaveLiturgia("dialog.music_choose_first") });
      return;
    }

    if (mode === "audio" || mode === "audio_pb") {
      $media.stop();
      await $media.openAudio({
        id_music: item.id_music,
        mode: (mode === "audio_pb" ? "instrumental" : "audio") as MusicActionEnum,
      });
      return;
    }

    const map: Record<string, { id_music: number; mode: MusicActionEnum }> = {
      sung: { id_music: item.id_music, mode: MusicActionEnum.AUDIO },
      pb: { id_music: item.id_music, mode: MusicActionEnum.INSTRUMENTAL },
      lyric: { id_music: item.id_music, mode: MusicActionEnum.NO_AUDIO },
      no_audio: { id_music: item.id_music, mode: MusicActionEnum.NO_AUDIO },
    };
    $media.open(map[mode] || map.sung);
  }

  function openLyric(musica: number): void {
    if (!musica || Number.isNaN(musica) || musica === -1) {
      $alert.info({ text: chaveLiturgia("dialog.music_choose_first") });
      return;
    }

    $media.openLyric({ id_music: musica }).catch((err: unknown) => {
      console.warn("[useLiturgyItems] openLyric falhou:", err);
    });
  }

  function openUrl(url: string): void {
    if (!url) return;
    const valid = $liturgy.validateUrl(url);
    window.open(valid, "_blank", "noopener,noreferrer");
  }

  function extractYoutubeId(url: string): string | null {
    const m = url.match(
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/)([a-zA-Z0-9_-]{11})/
    );
    return m ? m[1] : null;
  }

  function buildEmbedUrl(url: string): string | null {
    const id = extractYoutubeId(url);
    if (!id) return null;
    return `https://www.youtube.com/embed/${id}?autoplay=1&rel=0&controls=0`;
  }

  function executeSite(item: LiturgyItem): void {
    const url = item.url || "";
    if (!url) return;

    if (isYoutube(url) && $userdata.get(KEYS.OPTIONS.YOUTUBE_ACTION, "video") === "video") {
      const embedUrl = buildEmbedUrl(url);
      if (embedUrl) {
        $media.openYouTube(embedUrl, item.item || "");
        return;
      }
    }

    openUrl(url);
  }

  function executeOnlineVideo(item: LiturgyItem): void {
    const url = item.url || "";
    if (!url) return;

    const embedUrl = buildEmbedUrl(url);
    if (!embedUrl) {
      $alert.error({ text: "modules.custom_online_videos.invalid_url" });
      return;
    }
    $media.openYouTube(embedUrl, item.item || item.subitem || url);
  }

  /**
   * Item da Biblioteca de Mídia: re-resolve o registro por ref_id (o path
   * pode ser blob e morrer entre sessões) e reaproveita a execução de
   * ARQUIVO (imagem/vídeo/pdf → projeção; pdf paginado).
   */
  async function executeMediaLibraryItem(item: LiturgyItem): Promise<void> {
    let target = item.dir;
    let typeHint = item.subtipo || undefined;
    if (item.ref_id) {
      const rec = await $idb.get<{ path?: string; type?: string }>(
        DB_TABLE.MEDIA_LIBRARY,
        item.ref_id
      );
      if (rec?.path) target = rec.path;
      if (rec?.type) typeHint = rec.type;
    }
    if (!target) {
      $alert.error({ text: t("alerts.media_not_found") });
      return;
    }
    // Blob URLs só valem no documento de origem — a projeção re-resolve
    // via IDB usando a referência da biblioteca.
    const extraPayload =
      target.startsWith("blob:") && item.ref_id
        ? { libRef: { table: DB_TABLE.MEDIA_LIBRARY, id: item.ref_id } }
        : undefined;
    await openFile({ ...item, dir: target }, typeHint, extraPayload);
  }

  /** Anúncios: envia os slides selecionados (na ordem) para a projeção. */
  async function executeAnnouncements(item: LiturgyItem): Promise<void> {
    const all = (
      await $idb.getAll<{
        id: string;
        nome: string;
        ordem: number;
        texto?: string;
        imageData?: ArrayBuffer;
        imageMime?: string;
        videoData?: ArrayBuffer;
        videoMime?: string;
        style?: Record<string, unknown>;
      }>(DB_TABLE.ANNOUNCEMENTS)
    ).sort((a, b) => a.ordem - b.ordem);

    const ids = item.anuncios_ids || [];
    const selected = ids.length ? all.filter((a) => ids.includes(String(a.id))) : all;
    if (!selected.length) {
      $alert.error({ text: t("alerts.media_not_found") });
      return;
    }

    const payload = {
      slides: selected.map((a) => ({
        id: String(a.id),
        nome: a.nome,
        ordem: a.ordem,
        texto: a.texto,
        imageData: a.imageData,
        imageMime: a.imageMime,
        videoData: a.videoData,
        videoMime: a.videoMime,
        style: a.style,
      })),
      index: 0,
    };
    // Salva no IDB (cache) — padrão do módulo announcements para fallback da projection.
    // ArrayBuffer é preservado nativamente pelo IDB (diferente de localStorage/JSON).
    await $idb.put(DB_TABLE.CACHE, {
      id: "announcements_projection_state",
      data: payload,
      ts: Date.now(),
    });
    $appdata.set(KEYS.MODULES.MEDIA.IS_PLAYING, true);
    // Ativa a barra de controles global.
    const fp = useFileProjection();
    fp.start("announcements", selected[0]?.nome || "", selected.length, 0);
    await openAnnouncementsWindow();
    // Espera a janela de projeção montar antes de enviar o broadcast.
    await new Promise((r) => setTimeout(r, 300));
    $broadcast.send(BROADCAST_TYPE.ANNOUNCEMENTS_STATE, payload);
  }

  /* ============== Overlay ============== */
  async function toggleOverlay(item: LiturgyItem): Promise<void> {
    if (!item.overlay_id) return;
    const slots = await readAllOverlaySlots();
    const slot = slots.find((s) => s.id === item.overlay_id);
    if (!slot) return;

    slot.enabled = item.overlay_action === "activate";
    await writeOverlaySlot(slot);

    if (slot.enabled) $userdata.set(KEYS.MODULES.OVERLAY.ENABLED, true);

    $broadcast.send(BROADCAST_TYPE.OVERLAY_CONFIG_CHANGED, {
      enabled: slot.enabled,
      slot,
    });
  }

  async function activateLinkedOverlay(item: LiturgyItem): Promise<void> {
    if (!item.linked_overlay_id) return;
    const slots = await readAllOverlaySlots();
    const slot = slots.find((s) => s.id === item.linked_overlay_id);
    if (!slot) return;

    slot.enabled = true;
    await writeOverlaySlot(slot);

    $userdata.set(KEYS.MODULES.OVERLAY.ENABLED, true);

    $broadcast.send(BROADCAST_TYPE.OVERLAY_CONFIG_CHANGED, {
      enabled: true,
      slot,
    });
  }


  let lastLiturgicalSoundUrl: string | null = null;

  /** Converte o registro em uma URL tocável na janela atual. */
  function resolvePlayableSoundUrl(rec: {
    path: string;
    data?: ArrayBuffer;
    mime?: string;
  }): string {
    const p = rec.path || "";
    // Blob morto de sessão anterior + bytes no IDB → recria localmente.
    if (rec.data && rec.mime && (!p || p.startsWith("blob:") || !/^(https?|louvorja):/i.test(p))) {
      if (lastLiturgicalSoundUrl) URL.revokeObjectURL(lastLiturgicalSoundUrl);
      lastLiturgicalSoundUrl = URL.createObjectURL(
        new Blob([rec.data], { type: rec.mime })
      );
      return lastLiturgicalSoundUrl;
    }
    // URLs completas passam direto.
    if (/^(https?|blob|data|louvorja):/i.test(p)) return p;
    // Caminho absoluto no desktop → protocolo local.
    if (Platform.isDesktop) return $path.local(p);
    return p;
  }

  /** Som de fundo: reproduz no PLAYER do módulo Som de Fundo (fade/volume). */
  async function executeBgSoundItem(item: LiturgyItem): Promise<void> {
    if (!item.ref_id) {
      $alert.error({ text: t("alerts.media_not_found") });
      return;
    }
    // Mesmo arquivo tocando? Alterna stop/play.
    if ($bgSound.currentFile.value?.id === item.ref_id) {
      $bgSound.togglePlay();
      return;
    }
    const rec = await $idb.get<{
      id: string;
      name: string;
      fileName?: string;
      path: string;
      data?: ArrayBuffer;
      mime?: string;
    }>(DB_TABLE.BACKGROUND_SOUND_LIBRARY, item.ref_id);
    if (!rec) {
      $alert.error({ text: t("alerts.media_not_found") });
      return;
    }
    const displayName = rec.fileName || rec.name;
    $bgSound.playFile({
      id: rec.id,
      name: displayName,
      fileName: displayName,
      path: resolvePlayableSoundUrl(rec),
      data: rec.data,
      mime: rec.mime,
    });
  }

  function _persistFileProjection(payload: Record<string, unknown>): void {
    try {
      localStorage.setItem("lj_file_projection", JSON.stringify(payload));
    } catch (e) {
      console.error(e);
    }
  }

  function _resolveFileUrl(dir: string): string {
    if (!dir) return "";
    // blob:/data: usam UM único barra após o esquema — passam direto.
    if (/^(blob|data):/i.test(dir)) return dir;
    if (/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(dir)) return dir;
    if (Platform.isDesktop) return $path.local(dir);
    return $path.file(dir);
  }

  /** Cache de objectURLs para HEIC→JPEG (evita reconverter a cada projeção). */
  const _heicProjectionCache = new Map<string, string>();

  /** Se o arquivo for HEIC/HEIF, converte para JPEG e devolve um objectURL. */
  async function _resolveRenderableUrl(dir: string): Promise<string> {
    const ext = dir.split(".").pop()?.toLowerCase() || "";
    if (ext !== "heic" && ext !== "heif") return _resolveFileUrl(dir);
    const raw = _resolveFileUrl(dir);
    const cached = _heicProjectionCache.get(dir);
    if (cached) return cached;
    try {
      const blob = await fetchWithTimeout(raw, {
        timeout: NET_TIMEOUT.MEDIA,
        source: "file",
      }).then((r) => r.blob());
      const jpeg = await heicToJpeg(blob);
      const url = URL.createObjectURL(jpeg);
      _heicProjectionCache.set(dir, url);
      return url;
    } catch {
      return raw;
    }
  }

  async function openFile(
    item: LiturgyItem,
    typeHint?: string,
    extraPayload?: Record<string, unknown>
  ): Promise<void> {
    const dir = item.dir || "";
    const ext = dir.split(".").pop()?.toLowerCase() || "";
    // HEIC/HEIF: converte para JPEG antes de enviar à projeção.
    const url = await _resolveRenderableUrl(dir);

    if (
      !url ||
      (!dir.includes("/") &&
        !dir.includes("\\") &&
        !/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(dir) &&
        !dir.startsWith("/"))
    ) {
      $alert.error({ text: url, title: "modules.media.alerts.file_not_found" });
      return;
    }

    // Tipo efetivo: extensão do caminho; sem extensão (ex.: blob URLs),
    // usa o hint informado pelo chamador (subtipo do item).
    let kind = "";
    if (IMAGE_EXT.includes(ext)) kind = "image";
    else if (VIDEO_EXT.includes(ext)) kind = "video";
    else if (AUDIO_EXT.includes(ext)) kind = "audio";
    else if (ext === "pdf") kind = "pdf";
    else if (typeHint) kind = typeHint;

    if (kind === "image" || kind === "pdf") {
      const fadeDur =
        ($userdata.get(KEYS.OPTIONS.FILE_PROJECTION.FADE, true) as boolean) !== false
          ? ($userdata.get(KEYS.OPTIONS.FILE_PROJECTION.FADE_DURATION, 500) as number) || 500
          : 0;
      const payload = {
        url,
        type: kind,
        title: item.item || "",
        fadeDuration: fadeDur,
        ...extraPayload,
      };
      _persistFileProjection(payload);

      await openFileProjectionWindows().catch((e: unknown) => {
        $alert.error(e as string);
        console.error(e);
      });
      $broadcast.send(BROADCAST_TYPE.FILE_PROJECTION, payload);
    } else if (kind === "video") {
      const fadeDur =
        ($userdata.get(KEYS.OPTIONS.FILE_PROJECTION.FADE, true) as boolean) !== false
          ? ($userdata.get(KEYS.OPTIONS.FILE_PROJECTION.FADE_DURATION, 500) as number) || 500
          : 0;
      const payload = {
        url,
        type: "video",
        title: item.item || "",
        fadeDuration: fadeDur,
        ...extraPayload,
      };
      _persistFileProjection(payload);
      await openFileProjectionWindows().catch((e: unknown) => {
        $alert.error(e as string);
        console.error(e);
      });
      $broadcast.send(BROADCAST_TYPE.FILE_PROJECTION, payload);
      $media.openAudio({ url, title: item.item || "" });
      $appdata.set(KEYS.MODULES.MEDIA.CONFIG.VIDEO_FILE, true);
    } else if (kind === "audio") {
      $media.openAudio({ url, title: item.item || "" });
    } else if (!kind && !typeHint) {
      // Tipo desconhecido sem hint: comportamento legado (abrir com SO).
      if (Platform.isDesktop && (Platform.api as unknown as Record<string, unknown>)?.openPath) {
        ((Platform.api as unknown as Record<string, unknown>).openPath as (path: string) => void)(dir);
      } else {
        openUrl(dir);
      }
    } else {
      $alert.error({ text: url, title: "modules.media.alerts.file_not_found" });
    }
  }

  return {
    executeItem,
    playMusic,
    openLyric,
    openUrl,
    openFile,
    isYoutube,
  };
}
