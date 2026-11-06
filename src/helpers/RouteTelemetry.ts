import type { RouteLocationNormalized, Router } from "vue-router";
import Telemetry from "@/helpers/Telemetry";

/** Mede as navegações da janela principal, inclusive falhas de lazy import. */
export function installRouteTelemetry(router: Router): void {
  // Duas tentativas para a mesma URL são navegações diferentes. O fim de uma
  // tentativa cancelada não pode encerrar a medição da que a substituiu.
  const pending = new WeakMap<
    RouteLocationNormalized,
    { startedAt: number; timeout: ReturnType<typeof setTimeout> }
  >();
  const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
  const finish = (to: RouteLocationNormalized) => {
    const entry = pending.get(to);
    if (entry) {
      clearTimeout(entry.timeout);
      pending.delete(to);
    }
    return entry;
  };
  router.beforeEach((to) => {
    const startedAt = now();
    const timeout = setTimeout(() => {
      if (!pending.has(to)) return;
      Telemetry.log("warn", "route transition timeout", {
        to: to.name || to.path,
        timeout_ms: 10000,
      });
      Telemetry.track("route_transition_timeout", { to: to.name || to.path, timeout_ms: 10000 });
    }, 10000);
    pending.set(to, { startedAt, timeout });
    Telemetry.track("route_transition_started", { to: to.name || to.path });
  });
  router.afterEach((to, from, failure) => {
    const entry = finish(to);
    if (failure) return;
    Telemetry.track("route_changed", { to: to.name || to.path, from: from.name || from.path });
    if (!entry) return;
    const durationMs = Math.max(0, Math.round(now() - entry.startedAt));
    Telemetry.track("route_transition_completed", {
      to: to.name || to.path,
      from: from.name || from.path,
      duration_ms: durationMs,
    });
    Telemetry.histogram("louvorja.route.transition.duration", durationMs, {
      route: String(to.name || to.path),
    });
  });
  router.onError((error, to, from) => {
    finish(to);
    Telemetry.captureException(error, {
      source: "router",
      to: to?.fullPath || to?.path,
      from: from?.fullPath || from?.path,
    });
  });
}
