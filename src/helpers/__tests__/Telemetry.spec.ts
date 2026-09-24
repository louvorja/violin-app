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
  startSessionRecording: vi.fn(),
  stopSessionRecording: vi.fn(),
  get_session_id: vi.fn(() => "sessao-principal"),
  get_session_replay_url: vi.fn(() => ""),
  onSessionId: vi.fn((callback: (sessionId: string) => void) => {
    callback("sessao-principal");
    return () => {};
  }),
  addExceptionStep: vi.fn(),
  startExceptionAutocapture: vi.fn(),
  opt_in_capturing: vi.fn(),
  opt_out_capturing: vi.fn(),
  reset: vi.fn(),
  is_capturing: vi.fn(() => true),
};

const databaseReporters: Array<(timing: unknown) => void> = [];

vi.mock("posthog-js", () => ({ default: posthog }));
// Barramento em memória: o BroadcastChannel real entrega mensagens a instâncias
// de testes anteriores. O mock persiste entre `vi.resetModules()`, então os
// listeners são limpos a cada teste.
const bus = vi.hoisted(() => ({
  listeners: new Set<(message: { type: string; payload: unknown }) => void>(),
}));
vi.mock("@/helpers/Broadcast", () => ({
  default: {
    send: (type: string, payload: unknown = {}) => {
      for (const listener of [...bus.listeners]) listener({ type, payload });
    },
    listen: (listener: (message: { type: string; payload: unknown }) => void) => {
      bus.listeners.add(listener);
      return () => bus.listeners.delete(listener);
    },
  },
}));
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
    fetchWithTimeout: vi.fn(async () => ({ ok: true, status: 200 }) as Response),
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
  bus.listeners.clear();
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
        autocapture: false,
        api_transport: "fetch",
        capture_pageview: false,
        capture_pageleave: false,
        capture_exceptions: true,
        disable_session_recording: true,
        capture_heatmaps: false,
        capture_dead_clicks: false,
        rageclick: false,
        capture_performance: false,
        enable_recording_console_log: false,
        session_recording: expect.objectContaining({
          recordHeaders: false,
          recordBody: false,
          collectFonts: false,
          captureCanvas: { recordCanvas: false },
        }),
        metrics: expect.objectContaining({
          serviceName: "louvorja-violin",
        }),
        tracing_headers: [],
      })
    );
    expect(posthog.startExceptionAutocapture).toHaveBeenCalledWith({
      capture_unhandled_errors: true,
      capture_unhandled_rejections: true,
      capture_console_errors: false,
    });
    expect(posthog.register).toHaveBeenCalledWith(
      expect.objectContaining({ app_version: "2.0.0-beta.8", sdk_version: "1.433.7" })
    );
    expect(posthog.capture).toHaveBeenCalledWith(
      "app_opened",
      expect.objectContaining({ app_version: "2.0.0-beta.8", sdk_version: "1.433.7" }),
      { send_instantly: true, transport: "fetch" }
    );
  });

  it("não sonda o endpoint de ingestão com GET: o PostHog só aceita POST e responderia 400 a cada boot", async () => {
    const Telemetry = await loadTelemetry();
    const { fetchWithTimeout } = await import("@/helpers/Http");
    const rawFetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));

    await Telemetry.init();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const requested = [
      ...vi.mocked(fetchWithTimeout).mock.calls.map(([url]) => String(url)),
      ...rawFetch.mock.calls.map(([url]) => String(url)),
    ];
    expect(requested.filter((url) => /\/e\/?$/.test(url))).toEqual([]);
  });

  it("usa a versão embutida quando o singleton não expõe LIB_VERSION", async () => {
    const previous = posthog.LIB_VERSION;
    delete (posthog as { LIB_VERSION?: string }).LIB_VERSION;
    try {
      const Telemetry = await loadTelemetry();
      await Telemetry.init();

      expect(posthog.register).toHaveBeenCalledWith(
        expect.objectContaining({ app_version: "2.0.0-beta.8", sdk_version: "1.433.7" })
      );
      expect(posthog.capture).toHaveBeenCalledWith(
        "app_opened",
        expect.objectContaining({ sdk_version: "1.433.7" }),
        { send_instantly: true, transport: "fetch" }
      );
    } finally {
      posthog.LIB_VERSION = previous;
    }
  });

  describe("Replay só em erros", () => {
    type BeforeSend = (capture: {
      event: string;
      properties: Record<string, unknown>;
    }) => { properties: Record<string, unknown> } | null;

    const exception = (...values: string[]) => ({
      event: "$exception",
      properties: { $exception_list: values.map((value) => ({ type: "Error", value })) },
    });
    const beforeSend = () =>
      (posthog.init.mock.calls[0][1] as { before_send: BeforeSend }).before_send;

    it("não grava no boot nem ao religar a telemetria", async () => {
      const Telemetry = await loadTelemetry();
      await Telemetry.init();
      Telemetry.setEnabled(false);
      Telemetry.setEnabled(true);

      expect(posthog.startSessionRecording).not.toHaveBeenCalled();
    });

    it("começa no primeiro erro real, renova a cada erro e para 5 minutos depois do último", async () => {
      const Telemetry = await loadTelemetry();
      await Telemetry.init();
      const config = posthog.init.mock.calls[0][1] as {
        session_recording: { collectFonts: boolean; captureCanvas: { recordCanvas: boolean } };
      };
      expect(config.session_recording).toEqual(
        expect.objectContaining({ collectFonts: false, captureCanvas: { recordCanvas: false } })
      );
      vi.useFakeTimers();
      try {
        beforeSend()(exception("Cannot read properties of null"));
        await vi.advanceTimersByTimeAsync(0);
        expect(posthog.startSessionRecording).toHaveBeenCalledExactlyOnceWith(true);

        await vi.advanceTimersByTimeAsync(4 * 60_000);
        beforeSend()(exception("outro erro"));
        await vi.advanceTimersByTimeAsync(4 * 60_000 + 59_000);
        expect(posthog.stopSessionRecording).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(1_000);
        expect(posthog.stopSessionRecording).toHaveBeenCalledOnce();
        expect(posthog.startSessionRecording).toHaveBeenCalledOnce();
      } finally {
        vi.useRealTimers();
      }
    });

    it("erros em sequência não estendem a gravação além de 15 minutos", async () => {
      const Telemetry = await loadTelemetry();
      await Telemetry.init();
      vi.useFakeTimers();
      try {
        for (let minute = 0; minute <= 16; minute += 4) {
          beforeSend()(exception(`erro aos ${minute} min`));
          await vi.advanceTimersByTimeAsync(4 * 60_000);
        }
        expect(posthog.startSessionRecording).toHaveBeenCalledTimes(2);
        expect(posthog.stopSessionRecording).toHaveBeenCalledOnce();
      } finally {
        vi.useRealTimers();
      }
    });

    it("um erro depois do teto reinicia a gravação mesmo que o timer de parada tenha atrasado", async () => {
      const Telemetry = await loadTelemetry();
      await Telemetry.init();
      vi.useFakeTimers();
      try {
        beforeSend()(exception("primeiro"));
        await vi.advanceTimersByTimeAsync(0);
        // Janela em segundo plano: o relógio anda, o timer de parada ainda não disparou.
        vi.setSystemTime(Date.now() + 16 * 60_000);

        beforeSend()(exception("depois do teto"));
        await vi.advanceTimersByTimeAsync(0);

        expect(posthog.stopSessionRecording).toHaveBeenCalledOnce();
        expect(posthog.startSessionRecording).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it("não grava por causa do aviso benigno de ResizeObserver", async () => {
      const Telemetry = await loadTelemetry();
      await Telemetry.init();
      vi.useFakeTimers();
      try {
        expect(
          beforeSend()(exception("ResizeObserver loop completed with undelivered notifications."))
        ).toBeNull();
        await vi.advanceTimersByTimeAsync(10);
        expect(posthog.startSessionRecording).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it("com a telemetria desligada, um erro não inicia a gravação e a que corre é encerrada", async () => {
      const Telemetry = await loadTelemetry();
      await Telemetry.init();
      vi.useFakeTimers();
      try {
        beforeSend()(exception("erro"));
        await vi.advanceTimersByTimeAsync(0);
        Telemetry.setEnabled(false);
        expect(posthog.stopSessionRecording).toHaveBeenCalledOnce();

        beforeSend()(exception("erro depois de desligar"));
        await vi.advanceTimersByTimeAsync(0);
        expect(posthog.startSessionRecording).toHaveBeenCalledOnce();
      } finally {
        vi.useRealTimers();
      }
    });

    it("só a janela principal leva o link do replay nos erros", async () => {
      posthog.get_session_replay_url.mockReturnValue("https://us.posthog.com/project/1/replay/abc");
      const Telemetry = await loadTelemetry();
      await Telemetry.init();

      Telemetry.captureException(new Error("na principal"));

      expect(posthog.get_session_replay_url).toHaveBeenCalledWith();
      expect(posthog.captureException).toHaveBeenLastCalledWith(
        expect.any(Error),
        expect.objectContaining({ replay_url: "https://us.posthog.com/project/1/replay/abc" })
      );

      const auxiliary = await loadTelemetry();
      window.location.hash = "#/projection";
      await auxiliary.init();
      posthog.captureException.mockClear();

      auxiliary.captureException(new Error("na projeção"));

      expect(posthog.captureException.mock.lastCall?.[1]).not.toHaveProperty("replay_url");
      posthog.get_session_replay_url.mockReturnValue("");
    });

    it("a principal anuncia a própria sessão, responde a quem pergunta e grava a pedido da auxiliar", async () => {
      const Telemetry = await loadTelemetry();
      const { default: Broadcast } = await import("@/helpers/Broadcast");
      const { BROADCAST_TYPE } = await import("@/helpers/BroadcastTypes");
      const received: Array<{ type: string; payload: unknown }> = [];
      Broadcast.listen((message) => received.push(message), { replay: false });

      await Telemetry.init();
      expect(received).toContainEqual({
        type: BROADCAST_TYPE.TELEMETRY_SESSION,
        payload: { session_id: "sessao-principal" },
      });

      received.length = 0;
      Broadcast.send(BROADCAST_TYPE.TELEMETRY_SESSION_REQUEST, {});
      expect(received).toContainEqual({
        type: BROADCAST_TYPE.TELEMETRY_SESSION,
        payload: { session_id: "sessao-principal" },
      });

      expect(posthog.startSessionRecording).not.toHaveBeenCalled();
      Broadcast.send(BROADCAST_TYPE.TELEMETRY_ERROR_SEEN, {});
      expect(posthog.startSessionRecording).toHaveBeenCalledExactlyOnceWith(true);
      Telemetry.setEnabled(false);
    });

    it("o erro de uma janela auxiliar leva a sessão da principal e pede que ela grave", async () => {
      const Telemetry = await loadTelemetry();
      window.location.hash = "#/projection";
      const { default: Broadcast } = await import("@/helpers/Broadcast");
      const { BROADCAST_TYPE } = await import("@/helpers/BroadcastTypes");
      const sent: string[] = [];
      Broadcast.listen((message) => sent.push(message.type), { replay: false });

      await Telemetry.init();
      expect(sent).toContain(BROADCAST_TYPE.TELEMETRY_SESSION_REQUEST);
      expect(posthog.startSessionRecording).not.toHaveBeenCalled();

      const withoutAnswer = beforeSend()({
        ...exception("antes de a principal responder"),
        properties: { ...exception("x").properties, $session_id: "sessao-da-auxiliar" },
      });
      expect(withoutAnswer?.properties.$session_id).toBe("sessao-da-auxiliar");
      expect(sent).not.toContain(BROADCAST_TYPE.TELEMETRY_ERROR_SEEN);

      Broadcast.send(BROADCAST_TYPE.TELEMETRY_SESSION, { session_id: "sessao-da-principal" });

      const routine = beforeSend()({
        event: "route_changed",
        properties: { $session_id: "sessao-da-auxiliar" },
      });
      expect(routine?.properties.$session_id).toBe("sessao-da-auxiliar");
      expect(sent).not.toContain(BROADCAST_TYPE.TELEMETRY_ERROR_SEEN);

      const linked = beforeSend()({
        ...exception("Falha no vídeo da projeção"),
        properties: { ...exception("x").properties, $session_id: "sessao-da-auxiliar" },
      });
      expect(linked?.properties.$session_id).toBe("sessao-da-principal");
      expect(sent).toContain(BROADCAST_TYPE.TELEMETRY_ERROR_SEEN);
      expect(posthog.startSessionRecording).not.toHaveBeenCalled();
    });
  });

  it("inicializa também janelas auxiliares para não perder seus erros", async () => {
    const Telemetry = await loadTelemetry();
    window.location.hash = "#/projection";

    await Telemetry.init();

    expect(posthog.init).toHaveBeenCalledOnce();
    expect(posthog.init.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        autocapture: false,
        disable_session_recording: true,
        capture_heatmaps: false,
        capture_dead_clicks: false,
        rageclick: false,
        capture_performance: false,
        enable_recording_console_log: false,
      })
    );
    expect(posthog.capture).toHaveBeenCalledWith(
      "app_opened",
      expect.objectContaining({ window_role: "auxiliary" }),
      { send_instantly: true, transport: "fetch" }
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
      expect.objectContaining({ message: "quota database bloqueada" })
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

    expect(posthog.capture).toHaveBeenCalledWith(
      "route_changed",
      expect.objectContaining({ to: "home" })
    );
  });

  it("não duplica a captura de erros globais depois que o autocapture nativo do SDK assume", async () => {
    const Telemetry = await loadTelemetry();

    // Antes do init(): nenhum autocapture nativo ainda existe — o listener
    // manual é a única rede de segurança para um crash no boot.
    window.dispatchEvent(
      new ErrorEvent("error", { error: new Error("crash no boot"), message: "crash no boot" })
    );
    await Telemetry.init();
    expect(posthog.captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: "crash no boot" }),
      expect.anything()
    );

    posthog.captureException.mockClear();

    // Depois do init(): startExceptionAutocapture já assumiu os mesmos
    // eventos globais — reportar de novo pelo listener manual duplicaria.
    window.dispatchEvent(
      new ErrorEvent("error", { error: new Error("crash depois"), message: "crash depois" })
    );
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
        expect.objectContaining({
          source: "console.error",
          console_message: expect.stringContaining("import falhou"),
        })
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
        expect.objectContaining({ source: "module_async_load", module_id: "hymnal" })
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
      config.before_send(exception("ResizeObserver loop completed with undelivered notifications."))
    ).toBeNull();
    expect(config.before_send(exception("ResizeObserver loop limit exceeded"))).toBeNull();
    expect(config.before_send(exception("fetchWithTimeoutm is not defined"))).not.toBeNull();
    expect(
      config.before_send(
        exception("ResizeObserver loop limit exceeded", "Cannot read properties of null")
      )
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
      expect.anything()
    );

    Telemetry.histogram("louvorja.data_table.load.duration", 1_400);

    expect(posthog.capture).toHaveBeenCalledWith(
      "performance_slow",
      expect.objectContaining({
        metric_name: "louvorja.data_table.load.duration",
        severity: "slow",
      })
    );
  });

  it("agrega avisos de performance repetidos por métrica sem perder o histograma", async () => {
    const Telemetry = await loadTelemetry();
    await Telemetry.init();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-24T12:00:00.000Z"));
    try {
      posthog.capture.mockClear();
      posthog.logger.error.mockClear();
      posthog.metrics.histogram.mockClear();

      Telemetry.histogram("louvorja.ui.long_task.duration", 1_200, { window_role: "main" });
      Telemetry.histogram("louvorja.ui.long_task.duration", 1_400, { window_role: "main" });

      expect(posthog.capture).not.toHaveBeenCalledWith("performance_slow", expect.anything());
      expect(posthog.logger.error).toHaveBeenCalledOnce();
      expect(posthog.metrics.histogram).toHaveBeenCalledTimes(2);

      vi.advanceTimersByTime(60_000);
      Telemetry.histogram("louvorja.ui.long_task.duration", 1_500, { window_role: "main" });

      expect(posthog.logger.error).toHaveBeenCalledTimes(2);
      expect(posthog.logger.error).toHaveBeenLastCalledWith(
        "performance budget exceeded",
        expect.objectContaining({ suppressed_count: 1, duration_ms: 1_500 })
      );
      expect(posthog.metrics.histogram).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
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
      expect.anything()
    );
    expect(posthog.metrics.histogram).toHaveBeenCalledWith(
      "louvorja.database.read.duration",
      320,
      expect.objectContaining({ attributes: expect.objectContaining({ dataset: "music_:id" }) })
    );

    report?.({ file: "music_123", source: "stale-indexeddb", duration_ms: 320, fresh: false });

    expect(posthog.capture).toHaveBeenCalledWith(
      "database_read",
      expect.objectContaining({ source: "stale-indexeddb", dataset: "music_:id" })
    );
  });

  it("resetId() gera o distinct_id via bootstrap e reforça o consentimento atual", async () => {
    const Telemetry = await loadTelemetry();
    await Telemetry.init();
    posthog.opt_in_capturing.mockClear();

    Telemetry.resetId();

    expect(posthog.reset).toHaveBeenLastCalledWith(
      expect.objectContaining({ bootstrap: expect.objectContaining({ isIdentifiedID: false }) })
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
      })
    );
    expect(posthog.addExceptionStep).toHaveBeenLastCalledWith(
      "music_opened",
      expect.objectContaining({ nested: { album: "Hinário" } })
    );
  });

  it("preserva o token de ingestão exigido pelo PostHog sem liberar tokens do produto", async () => {
    const Telemetry = await loadTelemetry();
    await Telemetry.init();

    const config = posthog.init.mock.calls[0][1] as {
      before_send: (capture: { event: string; properties: Record<string, unknown> }) => {
        properties: Record<string, unknown>;
      };
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
      expect.objectContaining({ playback_id: "p-1", nested: { stage: "waiting" } })
    );
  });

  it("registra incidente de runtime com schema limitado e sem campos arbitrários", async () => {
    const Telemetry = await loadTelemetry();
    await Telemetry.init();

    Telemetry.reportRuntimeIncident({
      diagnostic_schema_version: 1,
      incident_id: "incident-1",
      incident_type: "renderer_unresponsive",
      incident_status: "recovered",
      severity: "error",
      window_role: "auxiliary",
      feature: "projection",
      duration_ms: 2_400,
      playback_id: "playback-1",
      token: "não enviar",
      arbitrary_payload: "não enviar",
    });

    expect(posthog.logger.error).toHaveBeenCalledWith(
      "runtime incident",
      expect.objectContaining({
        source: "electron.runtime_health",
        incident_id: "incident-1",
        incident_type: "renderer_unresponsive",
        duration_ms: 2_400,
        playback_id: "playback-1",
      })
    );
    const attributes = posthog.logger.error.mock.lastCall?.[1] as Record<string, unknown>;
    expect(attributes.token).toBeUndefined();
    expect(attributes.arbitrary_payload).toBeUndefined();
  });

  it("envia histogramas de performance com dimensões de baixa cardinalidade", async () => {
    const Telemetry = await loadTelemetry();
    await Telemetry.init();

    Telemetry.histogram("louvorja.test.duration", 123, { window_role: "main" });

    expect(posthog.metrics.histogram).toHaveBeenCalledWith("louvorja.test.duration", 123, {
      unit: "ms",
      attributes: { window_role: "main" },
    });
  });

  it("mascara tokens na mensagem de logs", async () => {
    const Telemetry = await loadTelemetry();
    await Telemetry.init();

    Telemetry.log("error", "GET /audio?token=segredo");

    expect(posthog.logger.error).toHaveBeenCalledWith(
      "GET /audio?token=[REDACTED]",
      expect.any(Object)
    );
  });

  it("mascara tokens de URLs capturadas pelo replay", async () => {
    const Telemetry = await loadTelemetry();
    await Telemetry.init();
    const config = posthog.init.mock.calls[0][1] as {
      session_recording: {
        maskCapturedNetworkRequestFn: (_request: { name: string }) => { name: string };
      };
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
      expect.objectContaining({ message: expect.stringContaining("token=[REDACTED]") })
    );
    expect(posthog.captureException.mock.lastCall?.[1]?.message).not.toContain("segredo");
    const capturedError = posthog.captureException.mock.lastCall?.[0];
    expect(capturedError).toBeInstanceOf(Error);
    expect((capturedError as Error).message).not.toContain("segredo");
    expect((capturedError as Error).stack).not.toContain("segredo");
  });
});
