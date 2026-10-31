import { reactive } from "vue";
import $appdata from "@/helpers/AppData";
import Broadcast from "@/helpers/Broadcast";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import Telemetry from "@/helpers/Telemetry";
import { KEYS } from "@/constants/UserDataKeys";
import type { ScreenRole, ScreenVideoReport } from "@/composables/useScreenVideoReport";

/**
 * As miniaturas não podem mentir. Cada tela real conta, uma vez por segundo,
 * o que o vídeo dela está fazendo; aqui isso é comparado com o player do
 * operador. Se divergirem por mais de um relato seguido — tela rodando com o
 * player pausado, tela parada com ele tocando, tempos longe um do outro, ou
 * um vídeo na tela que o player nem controla —, a miniatura daquela tela
 * avisa, e um clique tenta pôr a tela de volta no lugar.
 */

export type Divergence = "playing" | "paused" | "drift" | "orphan";

/** Diferença de tempo (s) a partir da qual a tela está fora de sincronia. */
const DRIFT_S = 2;
/** Relatos seguidos diferentes do player antes de avisar: um só pode ser a pausa a caminho. */
const STREAK = 2;
/** Sem relato há mais que isso, a tela não tem vídeo (ou fechou). */
const STALE_MS = 3500;

const status = reactive<Record<ScreenRole, Divergence | null>>({ main: null, return: null });
const last = { main: null as ScreenVideoReport | null, return: null as ScreenVideoReport | null };
const streak = { main: 0, return: 0 };
const staleTimers: Partial<Record<ScreenRole, ReturnType<typeof setTimeout>>> = {};

function player(): { video: boolean; paused: boolean; time: number } {
  const el = document.getElementById("__audio") as HTMLMediaElement | null;
  const video = !!el && !!$appdata.get<boolean>(KEYS.MODULES.MEDIA.CONFIG.VIDEO_FILE, false) && !!el.currentSrc;
  return { video, paused: !el || el.paused, time: el && Number.isFinite(el.currentTime) ? el.currentTime : 0 };
}

/** Puro: o que esta tela está fazendo de diferente do player (ou nada). */
export function divergenceOf(
  report: Pick<ScreenVideoReport, "isPaused" | "currentTime">,
  p: { video: boolean; paused: boolean; time: number }
): Divergence | null {
  if (!p.video) return report.isPaused ? null : "orphan";
  if (report.isPaused !== p.paused) return p.paused ? "playing" : "paused";
  if (!p.paused && Math.abs(report.currentTime - p.time) > DRIFT_S) return "drift";
  return null;
}

function onReport(report: ScreenVideoReport): void {
  const role = report.screen;
  if (role !== "main" && role !== "return") return;
  last[role] = report;
  const found = divergenceOf(report, player());
  streak[role] = found ? streak[role] + 1 : 0;
  const next = found && streak[role] >= STREAK ? found : null;
  if (next && next !== status[role]) {
    Telemetry.track("presentation_screen_desync", { screen: role, kind: next });
  }
  status[role] = next;
  if (staleTimers[role]) clearTimeout(staleTimers[role]);
  staleTimers[role] = setTimeout(() => {
    status[role] = null;
    streak[role] = 0;
    last[role] = null;
  }, STALE_MS);
}

let installed = false;
function install(): void {
  if (installed) return;
  installed = true;
  Broadcast.listen((msg) => {
    if (msg.type === BROADCAST_TYPE.SCREEN_VIDEO_REPORT) onReport(msg.payload as ScreenVideoReport);
  });
}

/** Põe a tela de volta no lugar: pede o estado ao player, ou tira o vídeo que ninguém controla. */
function repair(role: ScreenRole): void {
  const report = last[role];
  if (status[role] === "orphan") {
    Broadcast.send(BROADCAST_TYPE.FILE_PROJECTION, { action: "clear" });
  } else if (report?.playback_id) {
    Broadcast.send(BROADCAST_TYPE.REQUEST_VIDEO_STATE, { playback_id: report.playback_id });
  }
  Telemetry.track("presentation_screen_desync_repair", { screen: role, kind: status[role] });
}

export function useScreenTruth() {
  install();
  return { status, repair };
}
