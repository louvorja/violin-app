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

  /**
   * Resultado de toda operação Canva. NUNCA traz credencial nem token — só o
   * motivo da falha, porque o Electron repassa ao renderer apenas
   * `message`/`stack` de um Error e o `code` sumiria da tela.
   */
  interface CanvaResult {
    ok: boolean;
    code?: string;
    message?: string;
  }

  interface CanvaStatus extends CanvaResult {
    available?: boolean;
    /** Credenciais salvas no cofre (não diz se estão corretas). */
    hasCredentials?: boolean;
    /** Token emitido e ainda com refresh. */
    connected?: boolean;
    /** O cofre está cifrado com AES-256-GCM. */
    encrypted?: boolean;
    /** Arquivo de chave presente e o ciphertext decifra. */
    keyOk?: boolean;
    /**
     * O SITE do Canva tem sessão na partição da projeção (cookies)?
     * Separado de `connected`: esse é o token da API, aquele é o cookie que o
     * `view_url` exige. Ver `electron/main/canva/webSession.js`.
     */
    webSession?: boolean;
    /**
     * O token não tem o escopo `design:content:read`, que o export em PDF
     * exige — a tela avisa antes do clique. `false` só quando dá para saber
     * (token com campo `scope`); sem ele, quem decide é o Canva.
     */
    requiresReconnect?: boolean;
    profile?: string;
    redirectUri?: string;
    port?: number;
    keyFile?: string;
    error?: string;
  }

  interface CanvaItem {
    type: "folder" | "design" | "image";
    id: string;
    name: string;
    thumb: string | null;
    /** Só imagem: aberta direto pelo thumbnail, que é a única URL que ela tem. */
    url?: string;
    pageCount?: number;
    /**
     * `updated_at` do design (segundos). Ausente quando a API não devolve —
     * quem lê trata como "não dá para validar" e confia no arquivo.
     * Serve só para o selo de cache: o PDF guardado só é reusado se bater.
     */
    updatedAt?: number;
  }

  interface CanvaListResult extends CanvaResult {
    items?: CanvaItem[];
    continuation?: string | null;
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
      graphics?: () => Promise<{
        gpu_feature_status: Record<string, string>;
        gpu_devices: Array<{ active: boolean; vendor_id: number; device_id: number }>;
        displays: Array<{ width: number; height: number; scale: number; hz: number }>;
        cpu_model: string;
        cpu_cores: number;
        memory_gb: number;
      }>;
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
      chooseFile: (kind?: "media") => Promise<string | null>;
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
        restartRequired?: boolean;
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
    /**
     * Integração Canva. OAuth2+PKCE, listagem e `view_url` acontecem no main;
     * aqui só chega resultado já validado.
     */
    canva: {
      status: () => Promise<CanvaStatus>;
      /** Grava no cofre. O Client Secret nunca volta daqui. */
      setCredentials: (clientId: string, clientSecret: string) => Promise<CanvaStatus>;
      /** Fica pendente até o usuário autorizar no navegador (ou dar timeout). */
      connect: () => Promise<CanvaResult>;
      /** Revoga a linhagem no Canva e limpa o cofre local. */
      disconnect: () => Promise<CanvaResult>;
      /**
       * Login no site do Canva numa janela normal (fora da projeção), na mesma
       * sessão que a janela de URL e a tela de retorno usam. Pendente até o
       * operador concluir ou fechar a janela.
       */
      webLogin: () => Promise<CanvaResult>;
      /**
       * Sai do SITE do Canva (cookies da partição da projeção). Não revoga o
       * token da API — para isso existe `disconnect`.
       */
      webLogout: () => Promise<CanvaResult & { removidos?: number }>;
      /** `view: "designs"` lista designs; sem ele, itens da pasta (raiz = `root`). */
      items: (payload?: {
        folderId?: string;
        view?: string;
        ownership?: string;
        continuation?: string | null;
        limit?: number;
      }) => Promise<CanvaListResult>;
      /** `view_url` novo a cada clique — o do Canva expira. */
      designUrl: (designId: string) => Promise<CanvaResult & { url?: string }>;
      /**
       * Exporta o design como PDF no disco e devolve o caminho local.
       * "Projetar como: PDF": não usa sessão web do Canva, só o token da API.
       * Fica pendente enquanto o job roda (até ~1 minuto).
       */
      exportPdf: (
        designId: string
      ) => Promise<
        CanvaResult & {
          path?: string;
          cached?: boolean;
          title?: string;
          pageCount?: number;
          /** Qualidade com que o PDF saiu (`pro` pode cair para `regular`). */
          quality?: string;
          /** Pedi `pro`, o Canva recusou e refez em `regular`. */
          qualityFallback?: boolean;
        }
      >;
      /** PDFs já guardados: designId → `updated_at` (segundos). */
      cachedPdfs: () => Promise<Record<string, number>>;
      /** Apaga o PDF e o meta de um design, a pedido do operador. */
      clearCachedPdf: (designId: string) => Promise<CanvaResult>;
      /**
       * A projeção parou numa tela de login do Canva (a sessão do site caiu).
       * Devolve a função de cleanup — é um evento, não um invoke.
       */
      onLoginWall: (cb: (data: { url?: string }) => void) => () => void;
    };
    /**
     * Ciclo da tela de loading da projeção de Site.
     *
     * `pronto: false` abre o ciclo (a janela pode ter sido reutilizada ainda
     * com o fade aplicado); `pronto: true` começa o fade — as duas telas
     * (telão e retorno) recebem o mesmo aviso para sumirem juntas.
     */
    siteLoader: {
      /**
       * `pronto: false` abre o ciclo; `pronto: true` começa o fade.
       * `apresentou` é o resultado da apresentação do Canva (`null` quando não
       * há gesto a fazer — Site de liturgia, por exemplo).
       */
      onPronto: (
        cb: (data: { pronto: boolean; apresentou?: boolean | null }) => void
      ) => () => void;
      /**
       * O renderer já abriu TODAS as janelas deste ciclo; o main passa a
       * esperar cada uma delas estar pronta antes de avisar os loaders.
       */
      aguardar: () => Promise<{ ok: boolean }>;
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
