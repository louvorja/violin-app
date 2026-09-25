/// <reference types="vite/client" />
declare global {
  interface UserDataIpcPatch {
    path: string;
    value: unknown;
    _src?: string;
  }

  interface LouvorjaAppInfo {
    isPackaged: boolean;
    isDev: boolean;
    version: string;
    electron: string;
    chromium: string;
    node: string;
    userData: string;
    appPath: string;
  }

  interface LouvorjaApi {
    platform: string;
    version: string;
    isDev: boolean;
    runtime?: {
      electron?: string;
      chrome?: string;
      node?: string;
    };
    app: {
      info: () => Promise<LouvorjaAppInfo>;
    };
    dev: {
      setLogForwarding: (enabled: boolean) => Promise<{ ok: boolean; enabled: boolean }>;
      reloadAll: () => Promise<{ ok: boolean; count: number }>;
      openDevTools: () => Promise<{ ok: boolean }>;
    };
    presentation?: {
      setMediaActive: (active: boolean) => void;
    };
    telemetry?: {
      log: (payload: {
        level: "trace" | "debug" | "info" | "warn" | "error" | "fatal";
        message: string;
        details?: Record<string, unknown>;
      }) => void;
      heartbeat?: (payload: {
        sampled_at_ms: number;
        window_role: "main" | "auxiliary" | "unknown";
        feature: string;
        route: string;
        visibility: DocumentVisibilityState;
        active_operations: string[];
        playback_id?: string;
        presentation_revision?: number;
        long_tasks: {
          count: number;
          warn_count: number;
          critical_count: number;
          total_ms: number;
          max_ms: number;
        };
      }) => void;
      getPendingMainErrors?: () => Promise<
        Array<{
          id: string;
          source: string;
          name?: string;
          message: string;
          stack?: string;
          at?: string;
        }>
      >;
      ackMainError?: (id: string) => Promise<{ ok: boolean }>;
      onMainError?: (cb: (payload: unknown) => void) => () => void;
      onRuntimeIncident?: (cb: (payload: unknown) => void) => () => void;
    };
    classic: {
      detect: () => Promise<
        Array<{
          dir: string;
          configDir: string;
          lang: string | null;
          folders: Record<string, boolean>;
        }>
      >;
      validate: (dir: string) => Promise<{
        ok: boolean;
        configDir?: string;
        folders?: Record<string, boolean>;
        error?: string;
      }>;
      getSource: () => Promise<{
        dir: string | null;
        lang: string | null;
        enabled: boolean;
        available: boolean;
      }>;
      setSource: (opts: {
        dir: string | null;
        lang?: string | null;
        enabled?: boolean;
      }) => Promise<{
        ok: boolean;
        dir?: string | null;
        lang?: string | null;
        enabled?: boolean;
        error?: string;
      }>;
      import: (opts: {
        dir: string;
        lang?: string;
        move?: boolean;
      }) => Promise<{ ok: boolean; copiadas?: string[]; error?: string }>;
    };
    net: {
      getStatus: () => Promise<{ online: boolean; since: number | null }>;
      onStatus: (cb: (s: { online: boolean; since: number | null }) => void) => () => void;
    };
    storage: {
      chooseFile: () => Promise<string | null>;
      chooseImage: () => Promise<string | null>;
      chooseDir: () => Promise<string | null>;
      setDataDir: (dir: string, opts?: { moveExisting?: boolean }) => Promise<void>;
      enforceQuota: (maxBytes: number) => Promise<void>;
      checkLocal: (paths: string[]) => Promise<Record<string, "own" | "classic" | false>>;
      removeFiles: (paths: string[]) => Promise<void>;
      sizeOfPaths: (
        paths: string[]
      ) => Promise<{ bytes: number; classicBytes: number; count: number; missing: number }>;
      openDir: () => Promise<void>;
      verify: (files: unknown) => Promise<unknown>;
      clearUnused: (files: unknown) => Promise<void>;
      stats: () => Promise<{
        dataDir?: string;
        dataDirIssue?: { wanted: string; reason: string } | null;
        filesDir?: string;
        files?: { bytes: number; count: number };
        json?: { bytes: number; count: number };
        total?: { bytes: number };
      }>;
      clearJson: () => Promise<void>;
      clearFiles: () => Promise<void>;
      setAutoCache: (enabled: boolean) => Promise<void>;
    };
    shell: {
      openPath: (filePath: string) => Promise<{
        ok: boolean;
        path?: string;
        error?: string;
      }>;
    };
    docs: {
      read: (colecao: string) => Promise<unknown[]>;
      write: (colecao: string, docs: unknown[]) => Promise<{ ok: boolean }>;
      list: () => Promise<string[]>;
    };
    userStore: {
      read: (key: string) => Promise<unknown>;
      write: (key: string, data: unknown) => Promise<void>;
      remove: (key: string) => Promise<void>;
      keys: () => Promise<string[]>;
      dir: string;
    };
    protocol: { setRemoteConfig: (config: unknown) => void };
    jsonCache: { clear: () => Promise<void>; dir: string };
    download: {
      onProgress: (
        cb: (d: { file?: string; total: number; downloaded?: number; failed?: number }) => void
      ) => void;
      onFileDone: (cb: () => void) => void;
      onFileError: (cb: () => void) => void;
      onQueueDone: (
        cb: (d: {
          queued?: number;
          message?: string;
          downloaded?: number;
          failed?: number;
          error?: string;
        }) => void
      ) => void;
      onQueueCancelled: (cb: () => void) => void;
      start: (
        files: unknown
      ) => Promise<
        { queued?: number; message?: string; downloaded?: number; failed?: number } | undefined
      >;
      checkConnection: () => Promise<{ ok: boolean; host?: string; msg?: string; error?: string }>;
      setApiConfig: (config: unknown) => void;
      getParams: () => Promise<unknown>;
      cancel: () => void;
      checkFiles: (files: unknown) => Promise<unknown>;
    };
    onlineVideo: {
      status: () => Promise<{
        count: number;
        size: number;
        supported: boolean;
        ready: boolean;
        last_stream_failure: null | {
          kind:
            | "age"
            | "bot"
            | "disk"
            | "forbidden"
            | "format"
            | "geo"
            | "live"
            | "network"
            | "private"
            | "tool"
            | "unavailable"
            | "unknown";
          track: "video" | "audio" | "unknown";
          phase: "opening" | "downloading" | "finalizing";
          elapsed_bucket: "lt_10s" | "10s_1m" | "1m_5m" | "gte_5m" | "unknown";
          age_bucket: "lt_10s" | "10s_1m" | "1m_5m" | "gte_5m" | "unknown";
        };
      }>;
      ensure: (
        id: string,
        opts?: { maxHeight?: number; priority?: "foreground" | "background"; keep?: boolean }
      ) => Promise<import("./helpers/OnlineVideo").OnlineVideoResult>;
      stream: (
        id: string,
        opts?: { maxHeight?: number; keep?: boolean }
      ) => Promise<import("./helpers/OnlineVideo").OnlineVideoStreamResult>;
      cancel: (id: string) => Promise<boolean>;
      has: (id: string) => Promise<boolean>;
      list: () => Promise<import("./helpers/OnlineVideo").OnlineVideoFile[]>;
      keep: (id: string) => Promise<boolean>;
      prepare: () => Promise<{ ok: boolean; ready?: boolean; error?: unknown }>;
      remove: (id: string) => Promise<boolean>;
      clear: () => Promise<number>;
      onProgress: (
        cb: (progress: import("./helpers/OnlineVideo").OnlineVideoProgress) => void
      ) => () => void;
    };
    displays: {
      list: () => Promise<unknown[]>;
      getPreferred: (feature: string) => Promise<{ id: number; bounds: unknown } | null>;
      setPreferred: (feature: string, displayId: number | string | null) => Promise<void>;
      getPrefs: () => Promise<Record<string, number | string | null>>;
      getRoles: () => Promise<
        {
          role: string;
          status: string;
          reason: string | null;
          displayId: number | null;
        }[]
      >;
      setRole: (role: string, displayId: number | null) => Promise<boolean>;
      getFeatureRole: (feature: string) => Promise<string | null>;
      setFeatureRole: (feature: string, role: string | null) => Promise<boolean>;
      identify: (durationMs?: number) => Promise<number>;
      /** Assina mudanças de monitor. Devolve a função de cleanup. */
      onChanged: (
        callback: (payload: {
          displays: unknown[];
          promoted: string[];
          hidden: string[];
          shown: string[];
        }) => void
      ) => () => void;
    };
    windows: Record<string, unknown>;
    httpServer: {
      start: (opts?: { port?: number }) => Promise<{ port: number; token: string }>;
      stop: () => Promise<void>;
      status: () => Promise<Record<string, unknown>>;
      setExternalRoutes: (enabled: boolean) => Promise<{ ok: boolean; error?: string }>;
      localIps: () => Promise<string[]>;
      hostname: () => Promise<string>;
      resetToken: () => Promise<string>;
      setToken: (token: string) => Promise<string>;
      getDeviceSettings: () => Promise<Record<string, unknown>>;
      setDeviceSettings: (settings: Record<string, unknown>) => Promise<Record<string, unknown>>;
      respond: (requestId: string, payload: unknown) => boolean;
    };
    shortcuts: Record<string, unknown>;
    updater: {
      check: () => Promise<{ ok: boolean; state?: unknown; error?: string }>;
      download: () => Promise<{ ok: boolean; error?: string }>;
      install: () => void;
      status: () => Promise<{
        status: string;
        version: string | null;
        newVersion: string | null;
        progress: number;
        error: string | null;
        packagePath?: string | null;
        installRequiresElevation?: boolean;
      }>;
      setOptions: (opts: {
        useBeta?: boolean;
        autoCheck?: boolean;
        autoDownload?: boolean;
      }) => Promise<{ ok: boolean }>;
      downloadPackage: () => Promise<{ ok: boolean; path?: string; error?: string }>;
      openPackage: () => Promise<{ ok: boolean; error?: string }>;
      openReleasePage: () => Promise<unknown>;
      getReleaseNotes: (version?: string) => Promise<{
        version: string;
        name: string;
        body: string;
        bodyHtml: string | null;
        url: string;
      } | null>;
      getInstallType: () => Promise<"appimage" | "deb" | "rpm">;
      onPackageProgress: (
        cb: (d: {
          percent: number;
          received: number;
          total: number;
          bytesPerSecond?: number;
        }) => void
      ) => () => void;
      onStateChange: (
        cb: (state: {
          status: string;
          version: string | null;
          newVersion: string | null;
          progress: number;
          error: string | null;
          bytesPerSecond?: number;
          transferred?: number;
          total?: number;
          packagePath?: string | null;
          installRequiresElevation?: boolean;
        }) => void
      ) => () => void;
    };
    powerBlocker: Record<string, unknown>;
    window: Record<string, unknown>;
    userdata: {
      fetch: () => Promise<Record<string, unknown>>;
      patch: (payload: UserDataIpcPatch) => Promise<{ ok: boolean }>;
      onPatch: (cb: (payload: UserDataIpcPatch) => void) => () => void;
    };
    transmission: Record<string, unknown>;
    appLogin: Record<string, unknown>;
    onHttpEvent: (cb: (eventType: string, data: unknown) => void) => () => void;
    openFiles: {
      subscribe: (cb: (paths: string[]) => void) => () => void;
      ready: () => Promise<string[]>;
    };
  }

  interface Window {
    louvorjaApi?: LouvorjaApi;
    vlibras?: VLibrasWidget;
    VLibras?: {
      Widget: new (rootPath: string) => void;
    };
    VLibrasWidget?: {
      open?: () => void;
      path?: string;
      avatar?: string;
      position?: string;
    };
  }
}

export {};
