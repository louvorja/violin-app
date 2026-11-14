import { describe, expect, it } from "vitest";
import { animationFrameDiagnostic, createResponsivenessContext } from "../ResponsivenessContext";

describe("responsiveness diagnostic evidence", () => {
  it("retains completed operations overlapping a delayed observer callback without calling them CPU culprits", () => {
    const history = createResponsivenessContext();
    history.record(
      { name: "module.open", startedAt: 100, properties: { module_id: "liturgy" } },
      1600
    );
    history.record({ name: "http.client", startedAt: 50 }, 80);
    history.record({ name: "later", startedAt: 1800 }, 2000);
    expect(history.overlapping(200, 1200, [])).toEqual([
      expect.objectContaining({
        operation: "module.open",
        module_id: "liturgy",
        status: "completed",
        timing_basis: "elapsed_wall_time",
        overlap_ms: 1200,
      }),
    ]);
  });

  it("keeps interrupted and pending operations distinct and clears them on opt-out", () => {
    const history = createResponsivenessContext();
    history.record({ name: "module.open", startedAt: 100 }, 500, "cancelled");
    const pending = [{ name: "projection.open", startedAt: 450 }];
    expect(history.overlapping(200, 1000, pending)).toEqual([
      expect.objectContaining({ operation: "projection.open", status: "pending", overlap_ms: 750 }),
      expect.objectContaining({ operation: "module.open", status: "cancelled", overlap_ms: 300 }),
    ]);
    history.clear();
    expect(history.overlapping(200, 1000, [])).toEqual([]);
  });

  it("exposes script entry point, position, CPU/layout duration with no DOM objects or URL credentials", () => {
    const result = animationFrameDiagnostic({
      entryType: "long-animation-frame",
      startTime: 100,
      duration: 1300,
      blockingDuration: 1200,
      styleAndLayoutStart: 1380,
      scripts: [
        {
          sourceURL: "https://user:password@app.test/assets/main.js?token=secret#private",
          sourceFunctionName: "renderProjection",
          sourceCharPosition: 4567,
          duration: 1100,
          forcedStyleAndLayoutDuration: 700,
          executionStart: 105,
          window: { title: "private" },
        },
      ],
    } as unknown as PerformanceEntry);
    expect(result).toMatchObject({
      attribution_scope: "script_entry_points",
      blocking_duration_ms: 1200,
      scripts: [
        {
          source_url: "https://app.test/assets/main.js",
          source_function: "renderProjection",
          source_char_position: 4567,
          duration_ms: 1100,
          forced_style_layout_ms: 700,
        },
      ],
    });
    expect(JSON.stringify(result)).not.toMatch(/password|secret|private|token|window"/);
  });

  it("identifies the invoking element and event without leaking media paths or URL secrets", () => {
    const scripts = (invoker: string) =>
      (
        animationFrameDiagnostic({
          entryType: "long-animation-frame",
          startTime: 0,
          duration: 1200,
          scripts: [{ invoker, invokerType: "event-listener", duration: 1100 }],
        } as unknown as PerformanceEntry) as { scripts: Array<{ invoker?: string }> }
      ).scripts[0].invoker;

    expect(scripts("INPUT#music-search.oninput")).toBe("INPUT#music-search.oninput");
    expect(scripts("Window.requestAnimationFrame")).toBe("Window.requestAnimationFrame");
    expect(scripts("IMG[src=louvorja://files/Users/maria/fundo.png].onload")).toBe(
      "IMG_src_.onload"
    );
    expect(scripts("https://user:pw@app.test/assets/a.js?token=x")).toBe(
      "https://app.test/assets/a.js"
    );
    expect(scripts("file:///C:/Users/maria/a.js")).toBeUndefined();
  });

  it("bounds script and span history and ignores malformed durations", () => {
    const history = createResponsivenessContext();
    for (let i = 0; i < 100; i++) history.record({ name: `op${i}`, startedAt: i }, i + 1000);
    expect(history.overlapping(0, 2000, [])).toHaveLength(8);
    history.record({ name: "recent", startedAt: 70000 }, 71000);
    expect(history.overlapping(0, 2000, [])).toEqual([]);
    expect(
      animationFrameDiagnostic({
        entryType: "long-animation-frame",
        startTime: 0,
        duration: NaN,
      } as PerformanceEntry)
    ).toBeNull();
    const frame = animationFrameDiagnostic({
      entryType: "long-animation-frame",
      startTime: 0,
      duration: 1000,
      scripts: Array.from({ length: 50 }, (_, i) => ({
        duration: i,
        sourceURL: "data:text/javascript,secret",
      })),
    } as unknown as PerformanceEntry);
    expect(frame?.scripts).toHaveLength(8);
    expect(JSON.stringify(frame)).not.toContain("secret");
  });
});
