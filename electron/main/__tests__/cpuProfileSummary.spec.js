// @vitest-environment node
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
const require = createRequire(import.meta.url);
const { summarizeCpuProfile, sanitizeCpuProfileSummary } = require("../cpuProfileSummary.js");

const options = { appRoot: "/Users/private/LouvorJA", processType: "main" };
function node(id, name = `function${id}`, url = `${options.appRoot}/electron/main.js`, children = []) {
  return { id, callFrame: { functionName: name, url, lineNumber: 9, columnNumber: 2 }, children };
}
function profile(nodes, samples, timeDeltas = samples.map(() => 1000)) {
  return { nodes, samples, timeDeltas, startTime: 100, endTime: 100 + timeDeltas.reduce((total, value) => total + value, 0) };
}
function summarize(value, opts = options) { return summarizeCpuProfile(value, opts); }

describe("bounded CPU sampling summaries", () => {
  it("ranks by sampled elapsed time rather than hit count and excludes profile wall time", () => {
    const input = profile([node(1, "frequent"), node(2, "controlledBurn")], [1, 1, 1, 2], [1000, 1000, 1000, 20000]);
    input.endTime += 50000;
    const result = summarize(input);
    expect(result).toMatchObject({ sample_count: 4, sampled_duration_ms: 23, idle_ms: 0, gc_ms: 0, program_ms: 0, unattributed_ms: 0 });
    expect(result.top_frames).toEqual([
      { function: "controlledBurn", source: "electron/main.js", line: 10, column: 3, sample_count: 1, self_sample_ms: 20 },
      { function: "frequent", source: "electron/main.js", line: 10, column: 3, sample_count: 3, self_sample_ms: 3 },
    ]);
    expect(result).not.toHaveProperty("cpu_percent");
    expect(sanitizeCpuProfileSummary(result)).toEqual(result);
    expect(summarize(profile([node(1)], [1], [0.25])).sampled_duration_ms).toBe(0.00025);
  });

  it("constructs caller chains from children and keeps leaf self time distinct from stack time", () => {
    const input = profile([node(1, "(root)", "", [2]), node(2, "dispatch", undefined, [3, 4]),
      node(3, "controlledBurn"), node(4, "render")], [3, 3, 4], [2000, 3000, 1000]);
    const result = summarize(input);
    expect(result.top_frames.map((frame) => frame.function)).toEqual(["controlledBurn", "render"]);
    expect(result.top_stacks.map((stack) => ({ count: stack.sample_count, ms: stack.sampled_ms, names: stack.frames.map((frame) => frame.function) })))
      .toEqual([{ count: 2, ms: 5, names: ["dispatch", "controlledBurn"] }, { count: 1, ms: 1, names: ["dispatch", "render"] }]);
  });

  it("collapses consecutive native frames so the app caller survives the six-frame budget", () => {
    const external = (id, children) => node(id, "", "node:internal/child_process", children);
    const input = profile([node(1, "(root)", "", [2]), node(2, "ffmpegWorks", undefined, [3]), node(3, "run", undefined, [4]),
      external(4, [5]), external(5, [6]), external(6, [7]), external(7, [8]), node(8, "spawn", "", [])], [8, 8]);
    const result = summarize(input);
    expect(result.top_stacks[0].frames.map((frame) => frame.function)).toEqual(["ffmpegWorks", "run", "native"]);
  });

  it("separates idle, GC and program while retaining only constant native/external labels", () => {
    const input = profile([node(1, "(idle)", ""), node(2, "(garbage collector)", ""), node(3, "(program)", ""),
      node(4, "nativeSecretFileName", ""), node(5, "", ""), node(6, "privateProviderFunction", "https://user:password@secret.example/a.js?token=secret"), node(7, "app")],
    [1, 2, 3, 4, 5, 6, 7], [1000, 2000, 3000, 4000, 5000, 6000, 7000]);
    const result = summarize(input);
    expect(result).toMatchObject({ idle_ms: 1, gc_ms: 2, program_ms: 3, unattributed_ms: 15, sampled_duration_ms: 28 });
    expect(result.top_frames.map((frame) => frame.function)).toEqual(["app", "external", "unknown", "native"]);
    expect(JSON.stringify(result)).not.toMatch(/private|Secret|Provider|secret|password|https:|\(idle\)|collector|\(program\)/);
  });

  it("allows only renderer bundle and development origins, suppressing all external function names", () => {
    const sources = ["louvorja://app/assets/index-Ab12.js", "http://localhost:5002/src/views/Projection.vue",
      "https://localhost:5002/assets/probe.js", "louvorja://app/assets/index.js?token=secret",
      "louvorja://user:password@app/assets/index.js", "http://localhost:5002.evil.test/src/private.js",
      "http://localhost:5002/src/%2e%2e/private.js", "http://localhost:5002/src/../src/probe.js",
      "http://localhost:5002/src/probe.js#secret", "file:///Users/private/LouvorJA/electron/main.js"];
    const result = summarize(profile(sources.map((source, i) => node(i + 1, `f${i}`, source)), sources.map((_source, i) => i + 1)), { ...options, processType: "renderer" });
    expect(result.top_frames.filter((frame) => frame.source !== "external").map((frame) => frame.source)).toEqual([
      "assets/index-Ab12.js", "src/views/Projection.vue", "assets/probe.js",
    ]);
    expect(result.unattributed_ms).toBe(7);
    expect(JSON.stringify(result)).not.toMatch(/private|password|secret|evil|file:|louvorja:|http/);
  });

  it("normalizes main file URLs, Windows paths and encoded app roots without exposing the root", () => {
    for (const [appRoot, source] of [["/Users/private/LouvorJA", "file:///Users/private/LouvorJA/src/helpers/run.ts"],
      ["/Users/private/App Name", "file:///Users/private/App%20Name/electron/main.js"],
      ["C:\\Users\\private\\LouvorJA", "C:\\Users\\private\\LouvorJA\\electron\\main.js"],
      ["C:\\Users\\private\\LouvorJA", "file:///C:/Users/private/LouvorJA/electron/main.js"]]) {
      const result = summarize(profile([node(1, "controlledBurn", source)], [1]), { appRoot, processType: "main" });
      expect(result.top_frames[0]).toMatchObject({ function: "controlledBurn" });
      expect(JSON.stringify(result)).not.toMatch(/private|Users|C:|file:/);
    }
    const result = summarize(profile([node(1, "outside", "/Users/private/LouvorJA-other/electron/private.js"),
      node(2, "credential", "file://user:password@localhost/electron/main.js"), node(3, "eval at secret(/Users/private)")], [1, 2, 3]));
    expect(result.top_frames.map((frame) => frame.function)).toEqual(["external", "unknown"]);
    expect(result.unattributed_ms).toBe(3);
    expect(JSON.stringify(result)).not.toMatch(/outside|credential|private|password|eval/);
  });

  it("handles the node/sample caps and a deep caller chain without recursion or unbounded output", () => {
    const nodes = Array.from({ length: 4096 }, (_value, i) => node(i + 1, `f${i}`, undefined, i < 4095 ? [i + 2] : []));
    const input = profile(nodes, Array(10000).fill(4096));
    const result = summarize(input);
    expect(result.sample_count).toBe(10000);
    expect(result.top_stacks[0].frames.map((frame) => frame.function)).toEqual(["f4090", "f4091", "f4092", "f4093", "f4094", "f4095"]);
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(8192);
    expect(summarize({ ...input, nodes: [...nodes, node(5000)] })).toBeNull();
    expect(summarize(profile([node(1)], Array(10001).fill(1)))).toBeNull();
  });

  it("enforces the byte budget while retaining the hottest leaves and six-frame maximum", () => {
    const nodes = [];
    const leaves = [];
    for (let branch = 0; branch < 5; branch++) {
      for (let depth = 0; depth < 6; depth++) {
        const id = branch * 6 + depth + 1;
        nodes.push(node(id, `b${branch}d${depth}${"F".repeat(116)}`, `${options.appRoot}/electron/${"x".repeat(130)}/${id}.js`, depth < 5 ? [id + 1] : []));
        if (depth === 5) leaves.push(id);
      }
    }
    const result = summarize(profile(nodes, leaves));
    expect(result.top_frames).toHaveLength(5);
    expect(result.top_stacks).toHaveLength(5);
    expect(result.top_stacks.some((stack) => stack.frames.length < 6)).toBe(true);
    expect(result.top_stacks.every((stack) => stack.frames.length <= 6 && stack.frames.at(-1).function.includes("d5"))).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(8192);
    expect(sanitizeCpuProfileSummary(result)).toEqual(result);
  });

  it("rejects cycles, ambiguous parents, missing nodes and malformed timings without throwing", () => {
    const valid = profile([node(1)], [1]);
    const invalid = [null, {}, { ...valid, samples: [] }, { ...valid, timeDeltas: [] }, { ...valid, timeDeltas: [0] },
      { ...valid, timeDeltas: [-1] }, { ...valid, timeDeltas: [NaN] }, { ...valid, timeDeltas: [Infinity] },
      { ...valid, samples: [2] }, { ...valid, startTime: 100, endTime: 100 }, { ...valid, endTime: -1 },
      { ...valid, endTime: 999 }, { ...valid, nodes: [node(1), node(1)] },
      profile([node(1, "a", undefined, [2]), node(2, "b", undefined, [1])], [1]),
      profile([node(1, "a", undefined, [3]), node(2, "b", undefined, [3]), node(3)], [3]),
      profile([node(1, "a", undefined, [2])], [1]),
      { ...valid, nodes: [{ ...node(1), callFrame: { functionName: "missing fields" } }] },
      Object.defineProperty({}, "nodes", { get() { throw new Error("untrusted getter"); } }),
    ];
    for (const input of invalid) { expect(() => summarize(input)).not.toThrow(); expect(summarize(input)).toBeNull(); }
    expect(summarize(valid, { ...options, processType: "utility" })).toBeNull();
  });

  it("revalidates the closed summary schema at worker, journal and IPC boundaries", () => {
    const valid = summarize(profile([node(1)], [1]));
    const frame = valid.top_frames[0];
    const malformed = [null, { ...valid, secret: "/Users/private" }, { ...valid, sample_count: 10001 },
      { ...valid, sampled_duration_ms: NaN }, { ...valid, gc_ms: 2 }, { ...valid, top_frames: Array(9).fill(frame) },
      { ...valid, top_stacks: Array(6).fill(valid.top_stacks[0]) },
      { ...valid, top_stacks: [{ ...valid.top_stacks[0], frames: Array(7).fill(valid.top_stacks[0].frames[0]) }] },
      ...["/Users/private/source.js", "electron/../../private.js", "assets/probe.js?secret", "https://provider/private.js"].map((source) => ({ ...valid, top_frames: [{ ...frame, source }] })),
      { ...valid, top_frames: [{ ...frame, function: "Unicodeé" }] }, { ...valid, top_frames: [{ ...frame, function: "eval at private" }] },
      { ...valid, top_frames: [{ ...frame, extra: "private" }] }, { ...valid, top_frames: [{ ...frame, source: "external", function: "private" }] },
      { ...valid, top_frames: [frame, frame] },
    ];
    for (const input of malformed) expect(sanitizeCpuProfileSummary(input)).toBeNull();
    const clone = sanitizeCpuProfileSummary(valid);
    expect(clone).toEqual(valid); expect(clone.top_frames[0]).not.toBe(frame);
  });
});
