import { describe, expect, it, vi } from "vitest";
import { failureDetails, reportReliabilityFailure } from "../ReliabilityDiagnostics";

const { track, captureException } = vi.hoisted(() => ({
  track: vi.fn(),
  captureException: vi.fn(),
}));
vi.mock("@/helpers/Telemetry", () => ({ default: { track, captureException } }));

describe("diagnóstico de confiabilidade", () => {
  it("preserva nome e mensagem de DOMException e objetos de IPC", () => {
    expect(failureDetails({ name: "QuotaExceededError", message: "Quota reached" })).toEqual({
      error_name: "QuotaExceededError",
      error_message: "Quota reached",
      reason: "storage_full",
    });
  });

  it("envia a causa original e a etapa sem bloquear a operação", async () => {
    const error = new DOMException("Quota reached", "QuotaExceededError");
    reportReliabilityFailure("test_failure", error, { stage: "persist" });
    await vi.waitFor(() =>
      expect(track).toHaveBeenCalledWith(
        "test_failure",
        expect.objectContaining({
          stage: "persist",
          error_name: "QuotaExceededError",
          error_message: "Quota reached",
          reason: "storage_full",
        })
      )
    );
    expect(captureException).toHaveBeenCalledWith(
      error,
      expect.objectContaining({ source: "test_failure", stage: "persist" })
    );
  });
});
