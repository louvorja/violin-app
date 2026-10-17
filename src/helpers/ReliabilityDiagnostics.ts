/** @category helper-puro — Diagnóstico de atualização e armazenamento sem bloquear o app. */
import { classifyLocalEnvironmentError } from "@/helpers/LocalEnvironmentErrors";

/** DOMException e erros vindos de IPC nem sempre são instanceof Error. */
export function failureDetails(error: unknown) {
  let name = "Error";
  let message = "Erro não identificado";
  try {
    if (error && typeof error === "object") {
      const value = error as { name?: unknown; message?: unknown };
      if (typeof value.name === "string" && value.name) name = value.name;
      if (typeof value.message === "string" && value.message) message = value.message;
    } else if (typeof error === "string" && error) message = error;
  } catch {
    /* objeto externo ilegível */
  }
  return {
    error_name: name.slice(0, 100),
    error_message: message.slice(0, 1000),
    reason:
      classifyLocalEnvironmentError(error) ??
      (name === "TimeoutError" ? "timeout" : name === "TypeError" ? "network_or_type_error" : name),
  };
}

function withTelemetry(
  action: (_telemetry: typeof import("@/helpers/Telemetry").default) => void
): void {
  void import("@/helpers/Telemetry")
    .then(({ default: telemetry }) => action(telemetry))
    .catch(() => {});
}

export function reportReliabilityEvent(event: string, properties: Record<string, unknown>): void {
  withTelemetry((telemetry) => telemetry.track(event, properties));
}

export function reportReliabilityFailure(
  event: string,
  error: unknown,
  properties: Record<string, unknown> = {}
): void {
  const details = { ...properties, ...failureDetails(error) };
  withTelemetry((telemetry) => {
    telemetry.track(event, details);
    telemetry.captureException(error, { source: event, ...details });
  });
}
