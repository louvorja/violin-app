import $liturgy from "@/helpers/Liturgy";
import $media from "@/composables/useMedia";
import { heicToJpeg } from "@/helpers/ImageConvert";
import { KEYS } from "@/constants/UserDataKeys";
import $alert from "@/helpers/Alert";
import $path from "@/helpers/Path";
import $broadcast from "@/helpers/Broadcast";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import { useFileProjection } from "@/composables/useFileProjection";
import { openAnnouncementsWindow } from "@/helpers/ProjectionWindows";
import { beginAnnouncementIntent } from "@/presentation/AnnouncementsPresentationState";
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
import { getSong as getCustomSong } from "@/helpers/CustomSongs";
import { openSlja, SLJA_EXT } from "@/helpers/SljaPlayer";
import { AUDIO_EXT, IMAGE_EXT, VIDEO_EXT } from "@constants/FileTypes";
import { fetchWithTimeout, NET_TIMEOUT } from "@/helpers/Http";
import Telemetry from "@/helpers/Telemetry";
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

  function reportExecutionError(
    error: unknown,
    operation: string,
    properties: Record<string, unknown> = {}
  ): void {
    Telemetry.captureException(error, { source: `liturgy.execution.${operation}`, ...properties });
    Telemetry.track("liturgy_execution_failed", { operation, ...properties });
  }

  function reportMissingResource(operation: string, resource: string): void {
    Telemetry.track("liturgy_resource_missing", { operation, resource });
  }

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
        void openFile(item).catch((error: unknown) => {
          reportExecutionError(error, "open_file", { has_path: !!item.dir });
        });
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
        } as LiturgyItem).catch((error: unknown) => {
            reportExecutionError(error, "open_scheduled_file", { has_path: true });
          });
        } else {
          reportMissingResource("execute_scheduled_item", "scheduled_file");
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
      reportMissingResource("play_music", "music_selection");
      $alert.info({ text: chaveLiturgia("dialog.music_choose_first") });
      return;
    }

    // Música personalizada (custom_collections) → executa via openCustomSong
    if (item.ref_id && item.id_music < 0) {
      try {
        const song = await getCustomSong(item.ref_id);
        if (song) {
          $media.openCustomSong(song);
          return;
        }
      } catch (error) {
        reportExecutionError(error, "play_custom_music", { ref_id: item.ref_id });
      }
      $alert.info({ text: chaveLiturgia("dialog.music_choose_first") });
      return;
    }

    if (mode === "audio" || mode === "audio_pb") {
      try {
        $media.stop();
        await $media.openAudio({
          id_music: item.id_music,
          mode: (mode === "audio_pb" ? "instrumental" : "audio") as MusicActionEnum,
        });
      } catch (error) {
        reportExecutionError(error, "play_music_audio", { mode });
      }
      return;
    }

    const map: Record<string, { id_music: number; mode: MusicActionEnum }> = {
      sung: { id_music: item.id_music, mode: MusicActionEnum.AUDIO },
      pb: { id_music: item.id_music, mode: MusicActionEnum.INSTRUMENTAL },
      lyric: { id_music: item.id_music, mode: MusicActionEnum.NO_AUDIO },
      no_audio: { id_music: item.id_music, mode: MusicActionEnum.NO_AUDIO },
    };
    try {
      $media.open(map[mode] || map.sung);
    } catch (error) {
      reportExecutionError(error, "play_music", { mode });
    }
  }

  function openLyric(musica: number): void {
    if (!musica || Number.isNaN(musica) || musica === -1) {
      reportMissingResource("open_lyric", "music_selection");
      $alert.info({ text: chaveLiturgia("dialog.music_choose_first") });
      return;
    }

    $media.openLyric({ id_music: musica }).catch((err: unknown) => {
      reportExecutionError(err, "open_lyric", { has_music_id: true });
      console.warn("[useLiturgyItems] openLyric falhou:", err);
    });
  }

  function openUrl(url: string): void {
    if (!url) return;
    const valid = $liturgy.validateUrl(url);
    window.open(valid, "_blank", "noopener,noreferrer");
  }

  /**
   * Abre o arquivo no reprodutor associado do sistema quando o operador
   * ativou essa preferência. O caminho original é necessário no Windows;
   * URLs `louvorja://` e `blob:` só existem dentro do app e seguem no player
   * embutido como fallback.
   */
  async function openWithSystemPlayer(dir: string, kind: string): Promise<boolean> {
    if (!Platform.isDesktop || !dir || /^(blob|data):/i.test(dir)) return false;
    const api = Platform.api as LouvorjaApi | null;
    if (!api?.shell?.openPath) return false;
    try {
      Telemetry.track("liturgy_media_external_open_requested", {
        kind,
        extension: dir.split(".").pop()?.toLowerCase() || "",
      });
      const result = await api.shell.openPath(dir);
      if (result?.ok) {
        Telemetry.track("liturgy_media_external_opened", {
          kind,
          path: result.path || "",
        });
        return true;
      }
      Telemetry.track("liturgy_media_external_open_failed", {
        kind,
        reason: result?.error || "unknown",
      });
      console.warn("[Liturgy] programa externo não abriu o arquivo:", result?.error || dir);
    } catch (error) {
      reportExecutionError(error, "open_external_media", { kind });
    }
    return false;
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
    try {
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
        reportMissingResource("execute_media_library", "media_library_item");
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
    } catch (error) {
      reportExecutionError(error, "execute_media_library", { has_ref_id: !!item.ref_id });
    }
  }

  /** Anúncios: envia os slides selecionados (na ordem) para a projeção. */
  async function executeAnnouncements(item: LiturgyItem): Promise<void> {
    const announcementToken = beginAnnouncementIntent();
    try {
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
        reportMissingResource("execute_announcements", "announcement");
        $alert.error({ text: t("alerts.media_not_found") });
        return;
      }

      const payload = {
        ...announcementToken,
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
      $broadcast.send(BROADCAST_TYPE.ANNOUNCEMENTS_INTENT, payload);
      if ($broadcast.getLastPayload(BROADCAST_TYPE.ANNOUNCEMENTS_STATE)?.announcement_session !== announcementToken.announcement_session) return;
      $appdata.set(KEYS.MODULES.MEDIA.IS_PLAYING, true);
      // Ativa a barra de controles global.
      const fp = useFileProjection();
      fp.start("announcements", selected[0]?.nome || "", selected.length, 0);
      await openAnnouncementsWindow();
    } catch (error) {
      reportExecutionError(error, "execute_announcements");
    }
  }

  /* ============== Overlay ============== */
  async function toggleOverlay(item: LiturgyItem): Promise<void> {
    if (!item.overlay_id) return;
    try {
      const slots = await readAllOverlaySlots();
      const slot = slots.find((s) => s.id === item.overlay_id);
      if (!slot) {
        reportMissingResource("toggle_overlay", "overlay_slot");
        return;
      }

      slot.enabled = item.overlay_action === "activate";
      await writeOverlaySlot(slot);

      if (slot.enabled) $userdata.set(KEYS.MODULES.OVERLAY.ENABLED, true);

      $broadcast.send(BROADCAST_TYPE.OVERLAY_CONFIG_CHANGED, {
        slot,
      });
    } catch (error) {
      reportExecutionError(error, "toggle_overlay");
    }
  }

  async function activateLinkedOverlay(item: LiturgyItem): Promise<void> {
    if (!item.linked_overlay_id) return;
    try {
      const slots = await readAllOverlaySlots();
      const slot = slots.find((s) => s.id === item.linked_overlay_id);
      if (!slot) {
        reportMissingResource("activate_linked_overlay", "overlay_slot");
        return;
      }

      slot.enabled = true;
      await writeOverlaySlot(slot);

      $userdata.set(KEYS.MODULES.OVERLAY.ENABLED, true);

      $broadcast.send(BROADCAST_TYPE.OVERLAY_CONFIG_CHANGED, {
        slot,
      });
    } catch (error) {
      reportExecutionError(error, "activate_linked_overlay");
    }
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
      reportMissingResource("execute_background_sound", "background_sound");
      $alert.error({ text: t("alerts.media_not_found") });
      return;
    }
    // Mesmo arquivo tocando? Alterna stop/play.
    if ($bgSound.currentFile.value?.id === item.ref_id) {
      $bgSound.togglePlay();
      return;
    }
    try {
      const rec = await $idb.get<{
        id: string;
        name: string;
        fileName?: string;
        path: string;
        data?: ArrayBuffer;
        mime?: string;
      }>(DB_TABLE.BACKGROUND_SOUND_LIBRARY, item.ref_id);
      if (!rec) {
        reportMissingResource("execute_background_sound", "background_sound");
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
    } catch (error) {
      reportExecutionError(error, "execute_background_sound", { has_ref_id: true });
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
    } catch (error) {
      reportExecutionError(error, "resolve_renderable_file", { extension: ext });
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
    // Tipo efetivo: extensão do caminho; sem extensão (ex.: blob URLs),
    // usa o hint informado pelo chamador (subtipo do item).
    let kind = "";
    if (IMAGE_EXT.includes(ext)) kind = "image";
    else if (VIDEO_EXT.includes(ext)) kind = "video";
    else if (AUDIO_EXT.includes(ext)) kind = "audio";
    else if (ext === "pdf") kind = "pdf";
    else if (ext === SLJA_EXT) kind = SLJA_EXT;
    else if (typeHint) kind = typeHint;

    if (
      (kind === "audio" || kind === "video") &&
      Boolean($userdata.get(KEYS.OPTIONS.USE_SYSTEM_MEDIA_PLAYER, false)) &&
      (await openWithSystemPlayer(dir, kind))
    ) {
      // Não deixe uma projeção anterior congelada enquanto o Windows assume
      // a reprodução deste arquivo.
      $media.close(true);
      return;
    }

    // HEIC/HEIF: converte para JPEG antes de enviar à projeção.
    const url = await _resolveRenderableUrl(dir);

    if (
      !url ||
      (!dir.includes("/") &&
        !dir.includes("\\") &&
        !/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(dir) &&
        !dir.startsWith("/"))
    ) {
      reportMissingResource("open_file", "file");
      $alert.error({ text: url, title: "modules.media.alerts.file_not_found" });
      return;
    }

    if (kind === "image" || kind === "pdf") {
      const fadeDur =
        ($userdata.get(KEYS.OPTIONS.FILE_PROJECTION.FADE, true) as boolean) !== false
          ? ($userdata.get(KEYS.OPTIONS.FILE_PROJECTION.FADE_DURATION, 500) as number) || 500
          : 0;
      const payload = {
        url,
        type: kind as "image" | "pdf",
        title: item.item || "",
        fadeDuration: fadeDur,
        ...extraPayload,
      };
      await $media.projectFile(payload).catch((e: unknown) => {
        reportExecutionError(e, "open_file_projection", { kind });
        $alert.error(e as string);
        console.error(e);
      });
    } else if (kind === "video") {
      const fadeDur =
        ($userdata.get(KEYS.OPTIONS.FILE_PROJECTION.FADE, true) as boolean) !== false
          ? ($userdata.get(KEYS.OPTIONS.FILE_PROJECTION.FADE_DURATION, 500) as number) || 500
          : 0;
      const payload = {
        url,
        type: "video" as const,
        title: item.item || "",
        fadeDuration: fadeDur,
        ...extraPayload,
      };
      await $media.projectFile(payload, url).catch((e: unknown) => {
        reportExecutionError(e, "open_file_projection", { kind });
        $alert.error(e as string);
        console.error(e);
      });
    } else if (kind === "audio") {
      void $media.openAudio({ url, title: item.item || "", mediaType: "audio" }).catch((error: unknown) => {
        reportExecutionError(error, "open_audio_file", { kind });
      });
    } else if (kind === SLJA_EXT) {
      // Apresentação .slja toca aqui dentro: entregar ao SO abriria o programa
      // associado (no Windows, o LouvorJA antigo) e tiraria o operador do app.
      await openSlja(url, { title: item.item, origin: "liturgy" });
    } else if (!kind && !typeHint) {
      // Tipo desconhecido sem hint: comportamento legado (abrir com SO).
      if (!(await openWithSystemPlayer(dir, "unknown"))) openUrl(dir);
    } else {
      reportMissingResource("open_file", "renderable_file");
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
