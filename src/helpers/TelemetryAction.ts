export type ActionSource = "control" | "keyboard" | "remote";
let current: ActionSource = "control";
export const telemetryActionSource = (): ActionSource => current;

/** Synchronous command dispatch only; never retain global context across an await. */
export function withTelemetryActionSource<T>(source: ActionSource, action: () => T): T {
  const previous = current;
  current = source;
  try {
    return action();
  } finally {
    current = previous;
  }
}
