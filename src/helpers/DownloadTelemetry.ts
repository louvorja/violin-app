/**
 * DownloadTelemetry.ts — eventos da verificação inicial e dos downloads de coletâneas.
 *
 * Responde, por versão do app, duas perguntas que os relatos de usuário não
 * respondem sozinhos: a janela de verificação inicial chega a fechar? E um
 * download de coletâneas termina, falha, para no meio ou é retomado à mão?
 *
 * Para não pesar: um evento por rodada (nunca por música), um aviso de travamento
 * no máximo por rodada e só contagens/códigos curtos nas propriedades. O estado
 * da rodada fica numa chave pequena do localStorage, gravada com intervalo, para
 * que uma rodada cortada pelo fechamento do app apareça no boot seguinte como
 * `interrupted` (ou `app_closed`, no caso da janela).
 *
 * @category helper-puro — relógio, armazenamento e envio são injetáveis nos testes.
 */
import { reportReliabilityEvent } from "@/helpers/ReliabilityDiagnostics";
import { normalizeAppVersion } from "@/helpers/AppVersion.js";
import packageJson from "@root/package.json";

export type CollectionDownloadSource = "startup_check" | "sync_menu" | "sync_continue" | "unknown";

export type CollectionDownloadOutcome =
  | "completed"
  | "failed"
  | "cancelled"
  | "nothing_to_do"
  | "start_failed"
  | "interrupted";

export type StartupCheckSource = "boot" | "menu";
export type StartupCheckView = "scanning" | "summary" | "details" | "downloading";
export type StartupCheckCloseVia = "close_button" | "dismiss" | "background" | "unmounted";
export type StartupCheckScanOutcome = "ok" | "catalog_unavailable" | "failed";

type Track = (event: string, properties: Record<string, unknown>) => void;
type KeyValueStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

interface Deps {
  now: () => number;
  storage: () => KeyValueStore | null;
  track: Track;
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (handle: unknown) => void;
  appVersion: string;
}

const DOWNLOAD_KEY = "louvorja.telemetry.collection_download";
const STARTUP_CHECK_KEY = "louvorja.telemetry.startup_check";

/** Sem arquivo concluído, com erro ou progresso por esse tempo, a rodada conta como travada. */
export const DOWNLOAD_STALL_MS = 120_000;
/** Verificação inicial parada em "Verificando…" por esse tempo conta como travada. */
export const STARTUP_CHECK_STUCK_MS = 90_000;
const WATCH_INTERVAL_MS = 15_000;
const PERSIST_INTERVAL_MS = 15_000;

function defaultStorage(): KeyValueStore | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

const defaults: Deps = {
  now: () => Date.now(),
  storage: defaultStorage,
  track: reportReliabilityEvent,
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
  appVersion: normalizeAppVersion(packageJson.version) || "unknown",
};
let deps: Deps = defaults;

/** Só para testes. */
export function setDownloadTelemetryDeps(overrides: Partial<Deps> | null): void {
  deps = overrides ? { ...defaults, ...overrides } : defaults;
  activeRun = null;
  activeStartupCheck = null;
}

function readJson<T>(key: string): T | null {
  try {
    const raw = deps.storage()?.getItem(key);
    if (!raw) return null;
    const value = JSON.parse(raw);
    return value && typeof value === "object" ? (value as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    deps.storage()?.setItem(key, JSON.stringify(value));
  } catch {
    /* armazenamento cheio ou bloqueado: a telemetria nunca derruba o fluxo */
  }
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

// ─── Downloads de coletâneas ────────────────────────────────────

interface StoredDownloadRun {
  run_id: string;
  source: CollectionDownloadSource;
  started_at: number;
  last_activity_at: number;
  requested: number;
  queued: number;
  done: number;
  failed: number;
  started_app_version: string;
  /** Ausente enquanto a rodada está em andamento. */
  outcome?: CollectionDownloadOutcome;
  finished_at?: number;
}

export interface CollectionDownloadFinish {
  downloaded?: number;
  failed?: number;
  code?: string | null;
  firstError?: string | null;
}

export interface CollectionDownloadRun {
  readonly id: string;
  queued(total: number): void;
  activity(): void;
  fileDone(): void;
  fileError(): void;
  finish(
    outcome: Exclude<CollectionDownloadOutcome, "interrupted">,
    details?: CollectionDownloadFinish
  ): void;
}

let activeRun: CollectionDownloadRun | null = null;

function randomRunId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${deps.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

/**
 * Rodada que ficou sem desfecho gravado: o app fechou (ou caiu) com o download
 * no meio. Vira um `collection_download_finished` com `interrupted`, uma vez só.
 */
function reportInterruptedDownload(stored: StoredDownloadRun): void {
  if (stored.outcome) return;
  const finishedAt = stored.last_activity_at || stored.started_at;
  deps.track("collection_download_finished", {
    run_id: stored.run_id,
    source: stored.source,
    outcome: "interrupted",
    requested: count(stored.requested),
    queued: count(stored.queued),
    downloaded: count(stored.done),
    failed: count(stored.failed),
    remaining: Math.max(0, count(stored.queued) - count(stored.done) - count(stored.failed)),
    duration_ms: Math.max(0, finishedAt - stored.started_at),
    started_app_version: stored.started_app_version,
    reported_late: true,
  });
  writeJson(DOWNLOAD_KEY, { ...stored, outcome: "interrupted", finished_at: finishedAt });
}

/** Chamado uma vez no boot da janela principal, antes de qualquer download novo. */
export function reportUnfinishedRuns(): void {
  if (!activeRun) {
    const stored = readJson<StoredDownloadRun>(DOWNLOAD_KEY);
    if (stored) reportInterruptedDownload(stored);
  }
  const check = readJson<StoredStartupCheck>(STARTUP_CHECK_KEY);
  if (check && !activeStartupCheck) reportUnclosedStartupCheck(check);
}

export function startCollectionDownloadRun(
  source: CollectionDownloadSource,
  requested: number
): CollectionDownloadRun {
  const previous = readJson<StoredDownloadRun>(DOWNLOAD_KEY);
  if (previous && !previous.outcome && !activeRun) reportInterruptedDownload(previous);
  const prev = readJson<StoredDownloadRun>(DOWNLOAD_KEY);
  const previousOutcome = prev?.outcome ?? null;
  // Rodada anterior que não terminou bem: quem começou esta está retomando.
  const resumed =
    previousOutcome !== null &&
    previousOutcome !== "completed" &&
    previousOutcome !== "nothing_to_do";

  const startedAt = deps.now();
  const state: StoredDownloadRun = {
    run_id: randomRunId(),
    source,
    started_at: startedAt,
    last_activity_at: startedAt,
    requested: count(requested),
    queued: count(requested),
    done: 0,
    failed: 0,
    started_app_version: deps.appVersion,
  };
  let lastPersistAt = startedAt;
  let maxGapMs = 0;
  let stalled = false;
  let finished = false;
  writeJson(DOWNLOAD_KEY, state);

  deps.track("collection_download_started", {
    run_id: state.run_id,
    source,
    requested: state.requested,
    resumed,
    previous_outcome: previousOutcome,
    since_previous_ms: prev?.finished_at ? Math.max(0, startedAt - prev.finished_at) : null,
  });

  const persistSoon = (force = false): void => {
    const now = deps.now();
    if (!force && now - lastPersistAt < PERSIST_INTERVAL_MS) return;
    lastPersistAt = now;
    writeJson(DOWNLOAD_KEY, state);
  };

  const watcher = deps.setInterval(() => {
    if (finished) return;
    // Grava o andamento mesmo sem atividade nova, para o boot seguinte saber até onde foi.
    persistSoon();
    if (stalled) return;
    const waited = deps.now() - state.last_activity_at;
    if (waited < DOWNLOAD_STALL_MS) return;
    stalled = true;
    deps.track("collection_download_stalled", {
      run_id: state.run_id,
      source,
      queued: state.queued,
      downloaded: state.done,
      failed: state.failed,
      waited_ms: waited,
      elapsed_ms: deps.now() - state.started_at,
    });
    persistSoon(true);
  }, WATCH_INTERVAL_MS);

  const activity = (): void => {
    if (finished) return;
    const now = deps.now();
    maxGapMs = Math.max(maxGapMs, now - state.last_activity_at);
    state.last_activity_at = now;
    persistSoon();
  };

  const run: CollectionDownloadRun = {
    id: state.run_id,
    queued(total) {
      state.queued = count(total);
      persistSoon(true);
    },
    activity,
    fileDone() {
      state.done += 1;
      activity();
    },
    fileError() {
      state.failed += 1;
      activity();
    },
    finish(outcome, details = {}) {
      if (finished) return;
      finished = true;
      deps.clearInterval(watcher);
      if (activeRun === run) activeRun = null;
      const now = deps.now();
      maxGapMs = Math.max(maxGapMs, now - state.last_activity_at);
      const downloaded = Math.max(state.done, count(details.downloaded));
      const failed = Math.max(state.failed, count(details.failed));
      deps.track("collection_download_finished", {
        run_id: state.run_id,
        source,
        outcome,
        requested: state.requested,
        queued: state.queued,
        downloaded,
        failed,
        remaining: Math.max(0, state.queued - downloaded - failed),
        duration_ms: Math.max(0, now - state.started_at),
        max_gap_ms: maxGapMs,
        stalled,
        code: details.code ?? null,
        first_error: details.firstError ?? null,
      });
      writeJson(DOWNLOAD_KEY, {
        ...state,
        done: downloaded,
        failed,
        last_activity_at: now,
        outcome,
        finished_at: now,
      });
    },
  };
  activeRun = run;
  return run;
}

// ─── Verificação inicial ────────────────────────────────────────

interface StoredStartupCheck {
  session_id: string;
  source: StartupCheckSource;
  opened_at: number;
  seen_at: number;
  view: StartupCheckView;
  scan_outcome: StartupCheckScanOutcome | null;
  download_started: boolean;
  started_app_version: string;
}

export interface StartupCheckContext {
  bundleInstalling?: boolean;
  ftpChecking?: boolean;
  busy?: boolean;
}

export interface StartupCheckSession {
  view(view: StartupCheckView): void;
  scanFinished(
    outcome: StartupCheckScanOutcome,
    details: { durationMs: number; detailed: boolean; albumsTotal: number; cachedAlbums: number }
  ): void;
  downloadStarted(): void;
  closed(via: StartupCheckCloseVia): void;
}

let activeStartupCheck: StartupCheckSession | null = null;

function reportUnclosedStartupCheck(stored: StoredStartupCheck): void {
  deps.track("startup_check_closed", {
    session_id: stored.session_id,
    source: stored.source,
    via: "app_closed",
    view: stored.view,
    open_ms: Math.max(0, (stored.seen_at || stored.opened_at) - stored.opened_at),
    scan_outcome: stored.scan_outcome,
    download_started: !!stored.download_started,
    started_app_version: stored.started_app_version,
    reported_late: true,
  });
  try {
    deps.storage()?.removeItem(STARTUP_CHECK_KEY);
  } catch {
    /* noop */
  }
}

export function openStartupCheckSession(
  source: StartupCheckSource,
  context: () => StartupCheckContext = () => ({})
): StartupCheckSession {
  const previous = readJson<StoredStartupCheck>(STARTUP_CHECK_KEY);
  if (previous && !activeStartupCheck) reportUnclosedStartupCheck(previous);

  const openedAt = deps.now();
  const state: StoredStartupCheck = {
    session_id: randomRunId(),
    source,
    opened_at: openedAt,
    seen_at: openedAt,
    view: "scanning",
    scan_outcome: null,
    download_started: false,
    started_app_version: deps.appVersion,
  };
  let viewSince = openedAt;
  let scanMs: number | null = null;
  let stuckReported = false;
  let closed = false;
  writeJson(STARTUP_CHECK_KEY, state);
  deps.track("startup_check_opened", { session_id: state.session_id, source });

  const watcher = deps.setInterval(() => {
    if (closed) return;
    state.seen_at = deps.now();
    writeJson(STARTUP_CHECK_KEY, state);
    if (stuckReported || state.view !== "scanning") return;
    const waited = state.seen_at - viewSince;
    if (waited < STARTUP_CHECK_STUCK_MS) return;
    stuckReported = true;
    const ctx = context();
    deps.track("startup_check_stuck", {
      session_id: state.session_id,
      source,
      view: state.view,
      waited_ms: waited,
      bundle_installing: !!ctx.bundleInstalling,
      ftp_checking: !!ctx.ftpChecking,
      scan_outcome: state.scan_outcome,
    });
  }, WATCH_INTERVAL_MS);

  const session: StartupCheckSession = {
    view(view) {
      if (closed || view === state.view) return;
      state.view = view;
      viewSince = deps.now();
      state.seen_at = viewSince;
      writeJson(STARTUP_CHECK_KEY, state);
    },
    scanFinished(outcome, details) {
      if (closed) return;
      state.scan_outcome = outcome;
      scanMs = Math.max(0, Math.round(details.durationMs));
      writeJson(STARTUP_CHECK_KEY, state);
      deps.track("startup_check_scan_finished", {
        session_id: state.session_id,
        source,
        outcome,
        duration_ms: scanMs,
        detailed: details.detailed,
        albums_total: count(details.albumsTotal),
        cached_albums: count(details.cachedAlbums),
      });
    },
    downloadStarted() {
      if (closed) return;
      state.download_started = true;
      writeJson(STARTUP_CHECK_KEY, state);
    },
    closed(via) {
      if (closed) return;
      closed = true;
      deps.clearInterval(watcher);
      if (activeStartupCheck === session) activeStartupCheck = null;
      const ctx = context();
      deps.track("startup_check_closed", {
        session_id: state.session_id,
        source,
        via,
        view: state.view,
        open_ms: Math.max(0, deps.now() - state.opened_at),
        scan_ms: scanMs,
        scan_outcome: state.scan_outcome,
        download_started: state.download_started,
        busy: !!ctx.busy,
      });
      try {
        deps.storage()?.removeItem(STARTUP_CHECK_KEY);
      } catch {
        /* noop */
      }
    },
  };
  activeStartupCheck = session;
  return session;
}
