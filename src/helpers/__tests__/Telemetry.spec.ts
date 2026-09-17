import { beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock("posthog-js", () => ({ default: posthog }));
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
        capture_pageview: "history_change",
        capture_exceptions: true,
        disable_session_recording: false,
        capture_heatmaps: true,
        capture_dead_clicks: true,
        rageclick: true,
        enable_recording_console_log: true,
        session_recording: expect.objectContaining({ recordHeaders: false, recordBody: false }),
        tracing_headers: [],
      }),
    );
    expect(posthog.startExceptionAutocapture).toHaveBeenCalledWith({
      capture_unhandled_errors: true,
      capture_unhandled_rejections: true,
      capture_console_errors: true,
    });
    expect(posthog.register).toHaveBeenCalledWith(
      expect.objectContaining({ app_version: "2.0.0-beta.8", sdk_version: "1.433.7" }),
    );
    expect(posthog.capture).toHaveBeenCalledWith(
      "app_opened",
      expect.objectContaining({ app_version: "2.0.0-beta.8", sdk_version: "1.433.7", replay_ready: true }),
      { send_instantly: true },
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
        { send_instantly: true },
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
        { send_instantly: true },
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
      { send_instantly: true },
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
