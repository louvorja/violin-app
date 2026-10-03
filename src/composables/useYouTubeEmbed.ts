import { onBeforeUnmount, ref, watch, type Ref } from "vue";
import Broadcast from "@/helpers/Broadcast";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import { useBroadcastListener } from "@/composables/useBroadcastListener";
import { loadYtApi } from "@/composables/useYouTubeApi";
import { videoIdFromUrl } from "@/helpers/OnlineVideo";
import type { VideoMediaState, YouTubeControlPayload, YTPlayer } from "@/types/Media";

export interface YouTubeEmbedSource {
  url: string;
  playbackId: string;
}

export type YouTubeEmbedRole = NonNullable<VideoMediaState["role"]>;

interface Options {
  container: Ref<HTMLElement | null>;
  /** O vídeo que este player deve mostrar agora; null desmonta o player. */
  source: () => YouTubeEmbedSource | null;
  role: YouTubeEmbedRole;
  /** true: é daqui que sai o som, e é este o relógio que os outros seguem. */
  audible?: () => boolean;
  volume?: () => number;
}

const PUBLISH_INTERVAL_MS = 500;
const DRIFT_TOLERANCE_S = 1;
const YT_PLAYING = 1;
const YT_PAUSED = 2;

/**
 * Quem manda no relógio: a janela de projeção (publica sem `role`), e na falta dela a
 * janela principal. Retorno e operador nunca mandam — só acompanham.
 */
export function outranks(sender: VideoMediaState["role"], mine: YouTubeEmbedRole): boolean {
  if (sender === undefined) return true;
  return sender === "main" && mine !== "main";
}

/**
 * Player embutido do YouTube fora da janela de projeção. Sem controles e sem clique: quem
 * avança, volta e pausa é a barra do player, pelos mesmos comandos que a projeção escuta.
 */
export function useYouTubeEmbed(options: Options) {
  const failed = ref(false);
  const audible = () => options.audible?.() === true;

  let player: YTPlayer | null = null;
  let ready = false;
  let generation = 0;
  let playbackId = "";
  let publishTimer: ReturnType<typeof setInterval> | null = null;
  let unmuteTimer: ReturnType<typeof setTimeout> | null = null;

  function stopPublishing(): void {
    if (publishTimer) clearInterval(publishTimer);
    publishTimer = null;
  }

  function destroy(): void {
    ++generation;
    ready = false;
    stopPublishing();
    if (unmuteTimer) clearTimeout(unmuteTimer);
    unmuteTimer = null;
    if (player) {
      try {
        player.destroy();
      } catch {
        /* o iframe já saiu do documento */
      }
      player = null;
    }
    options.container.value?.replaceChildren();
  }

  function publish(): void {
    if (!player || !ready || !audible()) return;
    try {
      const state = player.getPlayerState();
      Broadcast.send(BROADCAST_TYPE.YOUTUBE_STATE, {
        currentTime: player.getCurrentTime(),
        isPaused: state !== YT_PLAYING,
        duration: player.getDuration() || 0,
        state,
        playback_id: playbackId,
        sampledAt: Date.now(),
        role: options.role,
      } as VideoMediaState);
    } catch {
      /* player ainda sem os métodos da API */
    }
  }

  function applyAudibility(): void {
    if (!player || !ready) return;
    stopPublishing();
    if (!audible()) {
      player.mute?.();
      return;
    }
    const volume = options.volume?.();
    if (typeof volume === "number") player.setVolume(volume);
    player.unMute?.();
    publish();
    publishTimer = setInterval(publish, PUBLISH_INTERVAL_MS);
  }

  function follow(state: VideoMediaState): void {
    if (!player || !ready) return;
    try {
      const playing = state.state === undefined ? !state.isPaused : state.state === YT_PLAYING;
      const age = playing && typeof state.sampledAt === "number"
        ? Math.max(0, (Date.now() - state.sampledAt) / 1000)
        : 0;
      const target = state.currentTime + age;
      if (Math.abs(player.getCurrentTime() - target) > DRIFT_TOLERANCE_S) player.seekTo(target, true);
      const mine = player.getPlayerState();
      if (playing && mine === YT_PAUSED) player.playVideo();
      else if (!playing && state.isPaused && mine === YT_PLAYING &&
        (state.state === undefined || state.state === YT_PAUSED)) player.pauseVideo();
    } catch {
      /* player ainda sem os métodos da API */
    }
  }

  function create(): void {
    destroy();
    failed.value = false;
    const source = options.source();
    const host = options.container.value;
    if (!source || !host) return;
    const videoId = videoIdFromUrl(source.url);
    if (!videoId) {
      failed.value = true;
      return;
    }
    playbackId = source.playbackId;
    const mine = generation;
    // A API troca o elemento pelo iframe: ela recebe um filho, e o nó do template continua nosso.
    const mount = document.createElement("div");
    host.replaceChildren(mount);

    loadYtApi()
      .then((YT) => {
        if (mine !== generation) return;
        player = new YT.Player(mount, {
          height: "100%",
          width: "100%",
          videoId,
          origin: window.location.origin,
          playerVars: {
            autoplay: 1,
            mute: 1,
            rel: 0,
            controls: 0,
            modestbranding: 1,
            cc_load_policy: 0,
            disablekb: 1,
            playsinline: 1,
            fs: 0,
          },
          events: {
            onReady: () => {
              if (mine !== generation || !player) return;
              ready = true;
              player.playVideo();
              // Começa mudo porque é o único autoplay que todo navegador aceita; o som vem em seguida.
              unmuteTimer = setTimeout(() => {
                if (mine === generation) applyAudibility();
              }, 500);
              Broadcast.send(BROADCAST_TYPE.REQUEST_VIDEO_STATE, { playback_id: playbackId });
            },
            // `cc_load_policy` só deixa de forçar a legenda; quem a desliga é o módulo, já carregado.
            onApiChange: () => {
              if (mine !== generation) return;
              try {
                player?.setOption?.("captions", "track", {});
              } catch {
                /* módulo de legendas ausente */
              }
            },
            onStateChange: () => {
              if (mine === generation) publish();
            },
            onError: () => {
              if (mine === generation) failed.value = true;
            },
          },
        });
      })
      .catch(() => {
        if (mine === generation) failed.value = true;
      });
  }

  watch(
    () => [options.container.value, options.source()?.playbackId, options.source()?.url],
    create,
    { immediate: true, flush: "post" }
  );
  watch(audible, applyAudibility);

  // Resposta ao pedido feito no onReady: a posição de onde o vídeo já estava.
  useBroadcastListener(BROADCAST_TYPE.VIDEO_STATE, (payload: unknown) => {
    const state = payload as VideoMediaState;
    if (!state || state.playback_id !== playbackId) return;
    follow(state);
  });

  useBroadcastListener(BROADCAST_TYPE.YOUTUBE_STATE, (payload: unknown) => {
    const state = payload as VideoMediaState;
    if (!state || state.playback_id !== playbackId) return;
    if (audible() || !outranks(state.role, options.role)) return;
    follow(state);
  });

  useBroadcastListener(BROADCAST_TYPE.YOUTUBE_CONTROL, (payload: unknown) => {
    const command = payload as YouTubeControlPayload;
    if (!player || !ready || !command || command.playback_id !== playbackId) return;
    try {
      if (command.action === "play") player.playVideo();
      else if (command.action === "pause") player.pauseVideo();
      else if (command.action === "seekTo" && typeof command.value === "number")
        player.seekTo(command.value, true);
      else if (command.action === "setVolume" && typeof command.value === "number")
        player.setVolume(command.value);
    } catch {
      /* player ainda sem os métodos da API */
    }
    publish();
  });

  onBeforeUnmount(destroy);

  return { failed };
}
