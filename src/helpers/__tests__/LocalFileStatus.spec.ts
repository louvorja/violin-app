/**
 * O `<video>` diz "formato não suportado" também quando o arquivo sumiu. O
 * motivo real vem do status do `louvorja://local`, e dele sai a gravidade:
 * arquivo ausente é engano do operador (aviso), o resto vai para o error
 * tracking.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const http = vi.hoisted(() => ({ fetchWithTimeout: vi.fn() }));
const telemetry = vi.hoisted(() => ({ track: vi.fn(), captureException: vi.fn(), log: vi.fn() }));

vi.mock("@/helpers/Http", () => ({
  fetchWithTimeout: http.fetchWithTimeout,
  NET_TIMEOUT: { QUICK: 1 },
}));
vi.mock("@/helpers/Telemetry", () => ({ default: telemetry }));

import {
  localFileStatus,
  reportVideoFailure,
  videoFailureReason,
  VIDEO_FAILURE_HINT,
} from "@/helpers/LocalFileStatus";
import pt from "@/lang/pt.json";
import es from "@/lang/es.json";

const LOCAL = "louvorja://local/Users/ana/Informativo.mp4";

function responde(status: number) {
  http.fetchWithTimeout.mockResolvedValueOnce({
    ok: status < 300,
    status,
    body: { cancel: vi.fn(async () => {}) },
  });
}

function video(code: number) {
  return {
    error: { code, message: "MEDIA_ELEMENT_ERROR" },
    readyState: 0,
    networkState: 3,
  } as unknown as HTMLVideoElement;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("estado do arquivo pelo status do protocolo", () => {
  it.each([
    [206, "ok"],
    [404, "not_found"],
    [403, "permission"],
    [500, "unreadable"],
  ])("%i → %s", async (status, expected) => {
    responde(status);
    expect(await localFileStatus(LOCAL)).toBe(expected);
  });

  it("tempo esgotado e protocolo que não responde", async () => {
    http.fetchWithTimeout.mockRejectedValueOnce(
      Object.assign(new Error("Timeout"), { name: "TimeoutError" })
    );
    expect(await localFileStatus(LOCAL)).toBe("timeout");
    http.fetchWithTimeout.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    expect(await localFileStatus(LOCAL)).toBe("unreadable");
  });
});

describe("motivo de um vídeo que falhou", () => {
  it("arquivo que sumiu não é 'formato não suportado'", async () => {
    responde(404);
    expect(await videoFailureReason(LOCAL, 4)).toBe("not_found");
  });

  it("arquivo legível com código 4 é formato", async () => {
    responde(206);
    expect(await videoFailureReason(LOCAL, 4)).toBe("format");
  });

  it("decodificação não consulta o disco", async () => {
    expect(await videoFailureReason(LOCAL, 3)).toBe("decode");
    expect(http.fetchWithTimeout).not.toHaveBeenCalled();
  });

  it("origem remota continua sendo rede; blob é formato", async () => {
    expect(await videoFailureReason("https://files.louvorja.com.br/v.mp4", 4)).toBe("network");
    expect(await videoFailureReason("blob:louvorja://app/1", 4)).toBe("format");
    expect(http.fetchWithTimeout).not.toHaveBeenCalled();
  });

  it("cada motivo tem dica nos dois idiomas", () => {
    for (const key of Object.values(VIDEO_FAILURE_HINT)) {
      const [, name] = key.split(".");
      expect((pt as { projection: Record<string, string> }).projection[name]).toBeTruthy();
      expect((es as { projection: Record<string, string> }).projection[name]).toBeTruthy();
    }
  });
});

describe("gravidade do registro", () => {
  const options = {
    url: LOCAL,
    label: "File projection video",
    event: "file_projection_video_failed",
    operation: "file_projection_video",
    details: { playback_id: "p1" },
  };

  it("arquivo ausente vai como aviso, sem exceção", async () => {
    responde(404);
    expect(await reportVideoFailure({ ...options, el: video(4) })).toBe("not_found");
    expect(telemetry.captureException).not.toHaveBeenCalled();
    expect(telemetry.log).toHaveBeenCalledWith(
      "warn",
      "file projection video failed",
      expect.objectContaining({ failure: "not_found" })
    );
    expect(telemetry.track).toHaveBeenCalledWith(
      "file_projection_video_failed",
      expect.objectContaining({
        failure: "not_found",
        reason: "source_not_supported",
        code: 4,
        playback_id: "p1",
      })
    );
  });

  it("sem permissão vira exceção com o motivo no nome", async () => {
    responde(403);
    await reportVideoFailure({ ...options, el: video(4) });
    const [error, props] = telemetry.captureException.mock.calls[0];
    expect((error as Error).message).toBe("File projection video permission");
    expect(props).toMatchObject({ failure: "permission", operation: "file_projection_video" });
  });

  it("o estado do elemento é lido antes de consultar o disco", async () => {
    let release: () => void = () => {};
    http.fetchWithTimeout.mockReturnValueOnce(
      new Promise((resolve) => {
        release = () => resolve({ ok: false, status: 404, body: null });
      })
    );
    const el = video(4);
    const pending = reportVideoFailure({ ...options, el });
    // Outra mídia reaproveita o elemento enquanto o disco responde.
    (el as unknown as { error: null }).error = null;
    release();
    await pending;
    expect(telemetry.track).toHaveBeenCalledWith(
      "file_projection_video_failed",
      expect.objectContaining({ code: 4, failure: "not_found" })
    );
  });
});
