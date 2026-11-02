import { beforeEach, describe, expect, it, vi } from "vitest";

type Button = { text: string; value: string };
type Shown = { title: string; text: string; error?: string | null; buttons: Button[] };

const h = vi.hoisted(() => ({
  storage: {
    dataDirIssue: vi.fn(),
    restart: vi.fn(),
    recover: vi.fn(),
    olderVersion: vi.fn(),
    keepCurrentVersion: vi.fn(),
  },
  shown: [] as Array<{ data: Shown; answer: (_value: string) => Promise<void> }>,
  confirm: vi.fn(),
  warning: vi.fn(),
  track: vi.fn(),
}));

vi.mock("@/helpers/Platform", () => ({ default: { storage: h.storage } }));
vi.mock("@/helpers/Alert", () => ({
  default: {
    show: (data: Shown, callback: (_value: string) => Promise<void>) => h.shown.push({ data, answer: callback }),
    confirm: h.confirm,
  },
  escapeHtml: (text: string) => String(text).replace(/</g, "&lt;"),
}));
vi.mock("@/helpers/Snackbar", () => ({ default: { warning: h.warning } }));
vi.mock("@/helpers/Telemetry", () => ({ default: { track: h.track } }));

import { explainDataDirIssue, offerOlderVersionData, warnDataDirFallback } from "@/helpers/StorageRecovery";

const t = (key: string, values?: Record<string, unknown>) => (values ? `${key} ${JSON.stringify(values)}` : key);
const buttons = () => h.shown.at(-1)!.data.buttons.map((button) => button.value);

beforeEach(() => {
  vi.clearAllMocks();
  h.shown.length = 0;
});

describe("aviso do perfil provisório", () => {
  it("fica na tela e, ao clicar, explica o problema com o detalhe técnico", async () => {
    h.storage.dataDirIssue.mockResolvedValue({ reason: "failed", message: "Os dados <antigos> mudaram", attempts: 1, canReset: false });
    await warnDataDirFallback(t);
    const [text, config] = h.warning.mock.calls[0];
    expect(text).toMatch(/prepare_failed_notice/);
    expect(config).toMatchObject({ timeout: 0, key: "data-dir-fallback" });
    config.action();
    expect(h.shown[0].data.text).toMatch(/recovery\.failed/);
    expect(h.shown[0].data.error).toBe("Os dados &lt;antigos> mudaram");
  });

  it("sem problema, não mostra nada", async () => {
    h.storage.dataDirIssue.mockResolvedValue(null);
    await warnDataDirFallback(t);
    expect(h.warning).not.toHaveBeenCalled();
  });
});

describe("o que dá para fazer", () => {
  it("na primeira falha só oferece tentar de novo, que reinicia o app", async () => {
    explainDataDirIssue({ reason: "unavailable", wanted: "D:\\LouvorJA", attempts: 1, canReset: false }, t);
    expect(buttons()).toEqual(["close", "retry"]);
    await h.shown[0].answer("retry");
    expect(h.storage.restart).toHaveBeenCalled();
  });

  it("depois de falhar de novo oferece começar do zero, mas só com confirmação", async () => {
    explainDataDirIssue({ reason: "failed", message: "x", attempts: 2, canReset: true }, t);
    expect(buttons()).toEqual(["close", "reset", "retry"]);
    h.confirm.mockResolvedValueOnce(false);
    await h.shown[0].answer("reset");
    expect(h.storage.recover).not.toHaveBeenCalled();
    h.confirm.mockResolvedValueOnce(true);
    await h.shown[0].answer("reset");
    expect(h.storage.recover).toHaveBeenCalledWith("reset");
  });
});

describe("versão anterior usada depois da atualização", () => {
  it("trazer de volta pede confirmação e reinicia copiando a pasta antiga", async () => {
    h.storage.olderVersion.mockResolvedValue({ since: "2026-11-01T22:00:00.000Z", legacyRoot: "/docs" });
    await offerOlderVersionData(t);
    expect(buttons()).toEqual(["keep", "reimport"]);
    h.confirm.mockResolvedValueOnce(true);
    await h.shown[0].answer("reimport");
    expect(h.storage.recover).toHaveBeenCalledWith("reimport");
    expect(h.storage.keepCurrentVersion).not.toHaveBeenCalled();
  });

  it("qualquer outra resposta mantém como está e não pergunta de novo", async () => {
    h.storage.olderVersion.mockResolvedValue({ since: "2026-11-01T22:00:00.000Z", legacyRoot: "/docs" });
    await offerOlderVersionData(t);
    h.confirm.mockResolvedValueOnce(false);
    await h.shown[0].answer("reimport");
    await h.shown[0].answer("");
    expect(h.storage.recover).not.toHaveBeenCalled();
    expect(h.storage.keepCurrentVersion).toHaveBeenCalledTimes(2);
  });
});
