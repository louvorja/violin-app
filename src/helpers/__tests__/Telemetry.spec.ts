import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state: Record<string, unknown> = {};
const posthog = {
  LIB_VERSION: "1.433.7",
  init: vi.fn(),
  capture: vi.fn(),
  captureException: vi.fn(),
  register: vi.fn(),
  logger: {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  },
  captureLog: vi.fn(),
  metrics: { histogram: vi.fn() },
  sessionRecordingStarted: vi.fn(() => true),
  startSessionRecording: vi.fn(),
  stopSessionRecording: vi.fn(),
  addExceptionStep: vi.fn(),
  startExceptionAutocapture: vi.fn(),
  opt_in_capturing: vi.fn(),
  opt_out_capturing: vi.fn(),
  reset: vi.fn(),
  is_capturing: vi.fn(() => true),
};

const databaseReporters: Array<(timing: unknown) => void> = [];

vi.mock("posthog-js", () => ({ default: posthog }));
vi.mock("@/helpers/Database", () => ({
  setDatabaseTimingReporter: (fn: (timing: unknown) => void) => {
    databaseReporters.push(fn);
  },
}));
vi.mock("@/helpers/UserData", () => ({
  default: {
    get: (key: string, fallback: unknown) => (key in state ? state[key] : fallback),
    set: (key: string, value: unknown) => {
      state[key] = value;
    },
  },
}));
vi.mock("@/helpers/Platform", () => ({
  default: { isDesktop: false, isDev: false },
}));
vi.mock("@/helpers/Http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/helpers/Http")>();
  return {
    ...actual,
    fetchWithTimeout: vi.fn(async () => ({ ok: true, status: 200 } as Response)),
  };
});

async function loadTelemetry() {
  vi.resetModules();
  vi.stubEnv("VITE_POSTHOG_KEY", "test-key");
  vi.stubEnv("VITE_URL_API", "https://api.example.test/v1");
  vi.stubEnv("VITE_APP_VERSION", "2.0.0-beta.8");
  vi.stubEnv("VITE_POSTHOG_SDK_VERSION", "1.433.7");
  window.history.replaceState({}, "", "/");
  return import("@/helpers/Telemetry");
}

beforeEach(() => {
  for (const key of Object.keys(state)) delete state[key];
  vi.clearAllMocks();
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "debug").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Telemetry", () => {
  it("não inicializa nem envia dados quando a telemetria já está desativada", async () => {
    state["options.telemetry"] = false;
    const Telemetry = await loadTelemetry();

    await Telemetry.init();
    Telemetry.track("must_not_be_sent", { name: "Teste" });

    expect(posthog.init).not.toHaveBeenCalled();
    expect(posthog.capture).not.toHaveBeenCalled();
  });

  it("inicializa os recursos de observabilidade do PostHog", async () => {
    const Telemetry = await loadTelemetry();

    await Telemetry.init();

    expect(posthog.init).toHaveBeenCalledWith(
      "test-key",
      expect.objectContaining({
        autocapture: true,
        api_transport: "fetch",
        capture_pageview: "history_change",
        capture_exceptions: true,
        disable_session_recording: false,
        capture_heatmaps: true,
        capture_dead_clicks: true,
        rageclick: true,
        enable_recording_console_log: true,
        session_recording: expect.objectContaining({
          recordHeaders: false,
          recordBody: false,
          collectFonts: true,
          captureCanvas: { recordCanvas: true, canvasFps: 2, canvasQuality: "0.2" },
        }),
        metrics: expect.objectContaining({
          serviceName: "louvorja-violin",
          network: expect.objectContaining({ name: "louvorja.http.client.duration" }),
        }),
        tracing_headers: [],
      }),
    );
    expect(posthog.startExceptionAutocapture).toHaveBeenCalledWith({
      capture_unhandled_errors: true,
      capture_unhandled_rejections: true,
      capture_console_errors: false,
    });
    expect(posthog.register).toHaveBeenCalledWith(
      expect.objectContaining({ app_version: "2.0.0-beta.8", sdk_version: "1.433.7" }),
    );
    expect(posthog.capture).toHaveBeenCalledWith(
      "app_opened",
      expect.objectContaining({ app_version: "2.0.0-beta.8", sdk_version: "1.433.7", replay_ready: true }),
      { send_instantly: true, transport: "fetch" },
    );
  });

  it("usa a versão embutida quando o singleton não expõe LIB_VERSION", async () => {
    const previous = posthog.LIB_VERSION;
    delete (posthog as { LIB_VERSION?: string }).LIB_VERSION;
    try {
      const Telemetry = await loadTelemetry();
      await Telemetry.init();

      expect(posthog.register).toHaveBeenCalledWith(
        expect.objectContaining({ app_version: "2.0.0-beta.8", sdk_version: "1.433.7" }),
      );
      expect(posthog.capture).toHaveBeenCalledWith(
        "app_opened",
        expect.objectContaining({ sdk_version: "1.433.7" }),
        { send_instantly: true, transport: "fetch" },
      );
    } finally {
      posthog.LIB_VERSION = previous;
    }
  });

  it("emite app_opened com replay_ready=false quando o recorder não inicia a tempo", async () => {
    vi.useFakeTimers();
    posthog.sessionRecordingStarted.mockReturnValue(false);
    try {
      const Telemetry = await loadTelemetry();
      const initPromise = Telemetry.init();
      await vi.advanceTimersByTimeAsync(6_000);
      await initPromise;

      expect(posthog.capture).toHaveBeenCalledWith(
        "app_opened",
        expect.objectContaining({ replay_ready: false }),
        { send_instantly: true, transport: "fetch" },
      );
    } finally {
      posthog.sessionRecordingStarted.mockReturnValue(true);
      vi.useRealTimers();
    }
  });

  it("inicializa também janelas auxiliares para não perder seus erros", async () => {
    const Telemetry = await loadTelemetry();
    window.location.hash = "#/projection";

    await Telemetry.init();

    expect(posthog.init).toHaveBeenCalledOnce();
    expect(posthog.init.mock.calls[0][1]).toEqual(expect.objectContaining({
      autocapture: false,
      disable_session_recording: true,
      capture_heatmaps: false,
      capture_dead_clicks: false,
      rageclick: false,
    }));
    expect(posthog.capture).toHaveBeenCalledWith(
      "app_opened",
      expect.objectContaining({ window_role: "auxiliary" }),
      { send_instantly: true, transport: "fetch" },
    );
  });

  it("não trava silenciosamente quando o SDK falha ao inicializar, e loga o erro", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    posthog.init.mockImplementationOnce(() => {
      throw new Error("quota database bloqueada");
    });
    const Telemetry = await loadTelemetry();

    await expect(Telemetry.init()).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalledWith(
      "[Telemetry] falha ao inicializar:",
      expect.objectContaining({ message: "quota database bloqueada" }),
    );

    // `_started` volta ao estado inicial: uma nova tentativa (ex.: religar a
    // opção manualmente) não fica travada permanentemente pela falha anterior.
    await Telemetry.init();
    expect(posthog.init).toHaveBeenCalledTimes(2);

    consoleError.mockRestore();
  });

  it("enfileira eventos disparados antes do init() terminar e os envia depois", async () => {
    const Telemetry = await loadTelemetry();
    const initPromise = Telemetry.init();
    // init() ainda está no primeiro `await` (import dinâmico do SDK) — `_ph`
    // não existe neste ponto, exatamente como a navegação inicial do router.
    Telemetry.track("route_changed", { to: "home" });
    expect(posthog.capture).not.toHaveBeenCalledWith("route_changed", expect.anything());

    await initPromise;

    expect(posthog.capture).toHaveBeenCalledWith("route_changed", expect.objectContaining({ to: "home" }));
  });

  it("não duplica a captura de erros globais depois que o autocapture nativo do SDK assume", async () => {
    const Telemetry = await loadTelemetry();

    // Antes do init(): nenhum autocapture nativo ainda existe — o listener
    // manual é a única rede de segurança para um crash no boot.
    window.dispatchEvent(new ErrorEvent("error", { error: new Error("crash no boot"), message: "crash no boot" }));
    await Telemetry.init();
    expect(posthog.captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: "crash no boot" }),
      expect.anything(),
    );

    posthog.captureException.mockClear();

    // Depois do init(): startExceptionAutocapture já assumiu os mesmos
    // eventos globais — reportar de novo pelo listener manual duplicaria.
    window.dispatchEvent(new ErrorEvent("error", { error: new Error("crash depois"), message: "crash depois" }));
    expect(posthog.captureException).not.toHaveBeenCalled();
  });

  it("encaminha console.error tratado para Error Tracking com stack e fonte", async () => {
    const Telemetry = await loadTelemetry();
    await Telemetry.init();
    const bridge = (
      console as typeof console & {
        __louvorjaTelemetryConsoleBridge?: { originalError: (...args: unknown[]) => void };
      }
    ).__louvorjaTelemetryConsoleBridge;
    expect(bridge).toBeDefined();
    const originalError = bridge?.originalError;
    if (bridge) bridge.originalError = vi.fn();

    try {
      console.error("[Liturgia] import falhou", new Error("arquivo inválido"));
      expect(posthog.captureException).toHaveBeenCalledWith(
        expect.objectContaining({ message: "arquivo inválido" }),
        expect.objectContaining({ source: "console.error", console_message: expect.stringContaining("import falhou") }),
      );
    } finally {
      if (bridge && originalError) bridge.originalError = originalError;
      Telemetry.setEnabled(false);
    }
  });

  it("captura uma única vez o mesmo Error que passa por mais de um canal", async () => {
    const Telemetry = await loadTelemetry();
    await Telemetry.init();
    posthog.captureException.mockClear();
    const bridge = (
      console as typeof console & {
        __louvorjaTelemetryConsoleBridge?: { originalError: (...args: unknown[]) => void };
      }
    ).__louvorjaTelemetryConsoleBridge;
    const originalError = bridge?.originalError;
    if (bridge) bridge.originalError = vi.fn();

    try {
      const error = new Error("Failed to fetch dynamically imported module");
      // Ordem do carregador de módulos: captura explícita, console e errorHandler do Vue.
      Telemetry.captureException(error, { source: "module_async_load", module_id: "hymnal" });
      console.error('[Modules] erro ao carregar "hymnal":', error);
      Telemetry.captureException(error, { source: "vue" });

      expect(posthog.captureException).toHaveBeenCalledOnce();
      expect(posthog.captureException).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ source: "module_async_load", module_id: "hymnal" }),
      );
    } finally {
      if (bridge && originalError) bridge.originalError = originalError;
      Telemetry.setEnabled(false);
    }
  });

  it("descarta o aviso benigno de ResizeObserver e mantém os demais erros", async () => {
    const Telemetry = await loadTelemetry();
    await Telemetry.init();
    const config = posthog.init.mock.calls[0][1] as {
      before_send: (capture: { event: string; properties: Record<string, unknown> }) => unknown;
    };
    const exception = (...values: string[]) => ({
      event: "$exception",
      properties: { $exception_list: values.map((value) => ({ type: "Error", value })) },
    });

    expect(
      config.before_send(exception("ResizeObserver loop completed with undelivered notifications.")),
    ).toBeNull();
    expect(config.before_send(exception("ResizeObserver loop limit exceeded"))).toBeNull();
    expect(config.before_send(exception("fetchWithTimeoutm is not defined"))).not.toBeNull();
    expect(
      config.before_send(
        exception("ResizeObserver loop limit exceeded", "Cannot read properties of null"),
      ),
    ).not.toBeNull();
    expect(Telemetry.isBenignException(undefined)).toBe(false);
  });

  it("não repete em performance_slow o que ui_thread_stall e ui_long_task já registram", async () => {
    const Telemetry = await loadTelemetry();
    await Telemetry.init();
    posthog.capture.mockClear();

    Telemetry.histogram("louvorja.ui.stall.duration", 1_400, { window_role: "main" });
    Telemetry.histogram("louvorja.ui.long_task.duration", 600, { window_role: "main" });

    expect(posthog.capture).not.toHaveBeenCalledWith("performance_slow", expect.anything());
    expect(posthog.metrics.histogram).toHaveBeenCalledWith(
      "louvorja.ui.stall.duration",
      1_400,
      expect.anything(),
    );

    Telemetry.histogram("louvorja.data_table.load.duration", 1_400);

    expect(posthog.capture).toHaveBeenCalledWith(
      "performance_slow",
      expect.objectContaining({
        metric_name: "louvorja.data_table.load.duration",
        severity: "slow",
      }),
    );
  });

  it("só registra em evento o primeiro, o último e o slide sem conteúdo de uma troca", async () => {
    const { isProjectionMilestone } = await loadTelemetry();

    expect(isProjectionMilestone(0, 12, true)).toBe(true);
    expect(isProjectionMilestone(11, 12, true)).toBe(true);
    expect(isProjectionMilestone(5, 12, false)).toBe(true);
    expect(isProjectionMilestone(5, 12, true)).toBe(false);
    expect(isProjectionMilestone(1, 12, true)).toBe(false);
    expect(isProjectionMilestone(10, 12, true)).toBe(false);
    // Sem posição ou total legíveis, a leitura fica registrada em vez de sumir.
    expect(isProjectionMilestone(undefined, 12, true)).toBe(true);
    expect(isProjectionMilestone(3, undefined, true)).toBe(true);
    // Uma faixa de um slide só é ao mesmo tempo primeiro e último.
    expect(isProjectionMilestone(0, 1, true)).toBe(true);
  });

  it("agrega leituras normais do banco e só cria evento individual para degradações", async () => {
    const Telemetry = await loadTelemetry();
    await Telemetry.init();
    posthog.capture.mockClear();
    const report = databaseReporters.at(-1);
    expect(report).toBeDefined();

    report?.({ file: "music_123", source: "memory", duration_ms: 0, fresh: false });
    report?.({ file: "music_123", source: "network", duration_ms: 320, fresh: false });
    report?.({ file: "music_123", source: "indexeddb", duration_ms: 24, fresh: false });

    expect(posthog.capture).not.toHaveBeenCalledWith("database_read", expect.anything());
    expect(posthog.metrics.histogram).toHaveBeenCalledWith(
      "louvorja.database.read.duration",
      0,
      expect.anything(),
    );
    expect(posthog.metrics.histogram).toHaveBeenCalledWith(
      "louvorja.database.read.duration",
      320,
      expect.objectContaining({ attributes: expect.objectContaining({ dataset: "music_:id" }) }),
    );

    report?.({ file: "music_123", source: "stale-indexeddb", duration_ms: 320, fresh: false });

    expect(posthog.capture).toHaveBeenCalledWith(
      "database_read",
      expect.objectContaining({ source: "stale-indexeddb", dataset: "music_:id" }),
    );
  });

  it("resetId() gera o distinct_id via bootstrap e reforça o consentimento atual", async () => {
    const Telemetry = await loadTelemetry();
    await Telemetry.init();
    posthog.opt_in_capturing.mockClear();

    Telemetry.resetId();

    expect(posthog.reset).toHaveBeenLastCalledWith(
      expect.objectContaining({ bootstrap: expect.objectContaining({ isIdentifiedID: false }) }),
    );
    expect(posthog.opt_in_capturing).toHaveBeenCalled();
    expect(posthog.opt_out_capturing).not.toHaveBeenCalled();

    Telemetry.setEnabled(false);
    posthog.reset.mockClear();
    posthog.opt_in_capturing.mockClear();
    posthog.opt_out_capturing.mockClear();

    // `reset()` sozinho devolveria o SDK ao consentimento padrão da config
    // (capturando); reforçar o opt-out evita religar quem desligou.
    Telemetry.resetId();

    expect(posthog.reset).toHaveBeenCalledOnce();
    expect(posthog.opt_out_capturing).toHaveBeenCalledOnce();
    expect(posthog.opt_in_capturing).not.toHaveBeenCalled();
  });

  it("mantém músicas e remove segredos inclusive em propriedades aninhadas", async () => {
    const Telemetry = await loadTelemetry();
    await Telemetry.init();

    Telemetry.track("music_opened", {
      name: "Santo, Santo, Santo",
      lyric: "Santo, Santo, Santo",
      nested: { api_token: "never-send", album: "Hinário" },
    });

    expect(posthog.capture).toHaveBeenLastCalledWith(
      "music_opened",
      expect.objectContaining({
        name: "Santo, Santo, Santo",
        lyric: "Santo, Santo, Santo",
        nested: { album: "Hinário" },
      }),
    );
    expect(posthog.addExceptionStep).toHaveBeenLastCalledWith(
      "music_opened",
      expect.objectContaining({ nested: { album: "Hinário" } }),
    );
  });

  it("preserva o token de ingestão exigido pelo PostHog sem liberar tokens do produto", async () => {
    const Telemetry = await loadTelemetry();
    await Telemetry.init();

    const config = posthog.init.mock.calls[0][1] as {
      before_send: (capture: {
        event: string;
        properties: Record<string, unknown>;
      }) => { properties: Record<string, unknown> };
    };
    const sanitized = config.before_send({
      event: "test_event",
      properties: {
        token: "phc_public_project_key",
        api_token: "nao-enviar",
        nested: { token: "nao-enviar-tambem", name: "ok" },
      },
    });

    expect(sanitized.properties.token).toBe("phc_public_project_key");
    expect(sanitized.properties.api_token).toBeUndefined();
    expect(sanitized.properties.nested).toEqual({ name: "ok" });
  });

  it("interrompe captura e descarta o contexto pendente quando a opção é desligada", async () => {
    const Telemetry = await loadTelemetry();
    await Telemetry.init();
    Telemetry.breadcrumb("music_opened", { name: "Teste" });
    Telemetry.setEnabled(false);

    Telemetry.track("must_not_be_sent", { name: "Teste" });
    Telemetry.log("error", "must_not_be_sent", { name: "Teste" });
    Telemetry.captureException(new Error("must_not_be_sent"));

    expect(posthog.opt_out_capturing).toHaveBeenCalledOnce();
    expect(posthog.capture).not.toHaveBeenCalledWith("must_not_be_sent", expect.anything());
    expect(posthog.captureException).not.toHaveBeenCalled();
    expect(posthog.logger.error).not.toHaveBeenCalled();
  });

  it("envia transições detalhadas como log estruturado e remove credenciais", async () => {
    const Telemetry = await loadTelemetry();
    await Telemetry.init();

    Telemetry.log("warn", "music media buffering", {
      playback_id: "p-1",
      token: "não enviar",
      nested: { authorization: "não enviar", stage: "waiting" },
    });

    expect(posthog.logger.warn).toHaveBeenCalledWith(
      "music media buffering",
      expect.objectContaining({ playback_id: "p-1", nested: { stage: "waiting" } }),
    );
  });

  it("envia histogramas de performance com dimensões de baixa cardinalidade", async () => {
    const Telemetry = await loadTelemetry();
    await Telemetry.init();

    Telemetry.histogram("louvorja.test.duration", 123, { window_role: "main" });

    expect(posthog.metrics.histogram).toHaveBeenCalledWith(
      "louvorja.test.duration",
      123,
      { unit: "ms", attributes: { window_role: "main" } },
    );
  });

  it("mascara tokens na mensagem de logs", async () => {
    const Telemetry = await loadTelemetry();
    await Telemetry.init();

    Telemetry.log("error", "GET /audio?token=segredo");

    expect(posthog.logger.error).toHaveBeenCalledWith(
      "GET /audio?token=[REDACTED]",
      expect.any(Object),
    );
  });

  it("mascara tokens de URLs capturadas pelo replay", async () => {
    const Telemetry = await loadTelemetry();
    await Telemetry.init();
    const config = posthog.init.mock.calls[0][1] as {
      session_recording: { maskCapturedNetworkRequestFn: (_request: { name: string }) => { name: string } };
    };

    const masked = config.session_recording.maskCapturedNetworkRequestFn({
      name: "https://remote.test/api/open-song?id=10&token=segredo&tag=1",
    });
    expect(masked.name).toContain("token=[REDACTED]");
    expect(masked.name).not.toContain("segredo");
  });

  it("mascara tokens que apareçam na mensagem de uma exceção", async () => {
    const Telemetry = await loadTelemetry();
    await Telemetry.init();

    Telemetry.captureException(new Error("GET https://api.example.test/audio?token=segredo"));

    expect(posthog.captureException).toHaveBeenLastCalledWith(
      expect.any(Error),
      expect.objectContaining({ message: expect.stringContaining("token=[REDACTED]") }),
    );
    expect(posthog.captureException.mock.lastCall?.[1]?.message).not.toContain("segredo");
    const capturedError = posthog.captureException.mock.lastCall?.[0];
    expect(capturedError).toBeInstanceOf(Error);
    expect((capturedError as Error).message).not.toContain("segredo");
    expect((capturedError as Error).stack).not.toContain("segredo");
  });
});
