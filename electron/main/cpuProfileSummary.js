"use strict";

const path = require("node:path");
const MAX_NODES = 4096;
const MAX_SAMPLES = 10000;
const MAX_BYTES = 8192;
const SUMMARY_KEYS = ["sample_count", "sampled_duration_ms", "idle_ms", "gc_ms", "program_ms", "unattributed_ms", "top_frames", "top_stacks"];
const FRAME_KEYS = ["function", "source", "line", "column"];
const CONSTANT_SOURCES = new Set(["external", "unknown", "native"]);
const SPECIAL = new Map([["(idle)", "idle"], ["(program)", "program"], ["(garbage collector)", "gc"]]);

function object(value) { return !!value && typeof value === "object" && !Array.isArray(value); }
function closed(value, keys) {
  return object(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
function numeric(value) { return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER; }
function count(value, max) { return Number.isSafeInteger(value) && value >= 1 && value <= max; }
function ascii(value, max) {
  return typeof value === "string" && value.length >= 1 && value.length <= max && Array.from(value).every((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) <= 126);
}
function evalLabel(value) { return /\beval(?:\s|$|@|\()/i.test(value); }
function sourceValid(value) {
  if (CONSTANT_SOURCES.has(value)) return true;
  return ascii(value, 160) && /^(?:electron|src|assets)\/[a-z\d_./-]+$/i.test(value) &&
    value.split("/").every((segment) => segment && segment !== "." && segment !== "..");
}
function readFrame(frame) {
  if (!closed(frame, FRAME_KEYS) || !ascii(frame.function, 120) || evalLabel(frame.function) || !sourceValid(frame.source)) return null;
  if (CONSTANT_SOURCES.has(frame.source)) {
    if (frame.function !== frame.source || frame.line !== null || frame.column !== null) return null;
  } else if (!(frame.line === null || count(frame.line, Number.MAX_SAFE_INTEGER)) ||
      !(frame.column === null || count(frame.column, Number.MAX_SAFE_INTEGER))) return null;
  return { function: frame.function, source: frame.source, line: frame.line, column: frame.column };
}

/** Closed boundary for worker messages, persisted incidents and renderer IPC. */
function sanitizeCpuProfileSummary(value) {
  try {
    if (!closed(value, SUMMARY_KEYS) || !count(value.sample_count, MAX_SAMPLES) || !numeric(value.sampled_duration_ms) || value.sampled_duration_ms <= 0) return null;
    for (const key of ["idle_ms", "gc_ms", "program_ms", "unattributed_ms"]) {
      if (!numeric(value[key]) || value[key] > value.sampled_duration_ms) return null;
    }
    if (value.idle_ms + value.gc_ms + value.program_ms + value.unattributed_ms > value.sampled_duration_ms + 0.001) return null;
    if (!Array.isArray(value.top_frames) || value.top_frames.length > 8 || !Array.isArray(value.top_stacks) || value.top_stacks.length > 5) return null;
    const topFrames = [];
    for (const frame of value.top_frames) {
      if (!closed(frame, [...FRAME_KEYS, "sample_count", "self_sample_ms"]) || !count(frame.sample_count, value.sample_count) ||
          !numeric(frame.self_sample_ms) || frame.self_sample_ms <= 0 || frame.self_sample_ms > value.sampled_duration_ms) return null;
      const safe = readFrame(Object.fromEntries(FRAME_KEYS.map((key) => [key, frame[key]])));
      if (!safe) return null;
      topFrames.push({ ...safe, sample_count: frame.sample_count, self_sample_ms: frame.self_sample_ms });
    }
    const topStacks = [];
    for (const stack of value.top_stacks) {
      if (!closed(stack, ["sample_count", "sampled_ms", "frames"]) || !count(stack.sample_count, value.sample_count) ||
          !numeric(stack.sampled_ms) || stack.sampled_ms <= 0 || stack.sampled_ms > value.sampled_duration_ms || !Array.isArray(stack.frames) || stack.frames.length < 1 || stack.frames.length > 6) return null;
      const frames = stack.frames.map(readFrame);
      if (frames.some((frame) => !frame)) return null;
      topStacks.push({ sample_count: stack.sample_count, sampled_ms: stack.sampled_ms, frames });
    }
    const hotDuration = value.sampled_duration_ms - value.idle_ms - value.gc_ms - value.program_ms;
    if (topFrames.reduce((sum, frame) => sum + frame.sample_count, 0) > value.sample_count ||
        topStacks.reduce((sum, stack) => sum + stack.sample_count, 0) > value.sample_count ||
        topFrames.reduce((sum, frame) => sum + frame.self_sample_ms, 0) > hotDuration + 0.001 ||
        topStacks.reduce((sum, stack) => sum + stack.sampled_ms, 0) > hotDuration + 0.001) return null;
    const result = { sample_count: value.sample_count, sampled_duration_ms: value.sampled_duration_ms,
      idle_ms: value.idle_ms, gc_ms: value.gc_ms, program_ms: value.program_ms, unattributed_ms: value.unattributed_ms,
      top_frames: topFrames, top_stacks: topStacks };
    return Buffer.byteLength(JSON.stringify(result), "utf8") <= MAX_BYTES ? result : null;
  } catch { return null; }
}

function constantFrame(source) { return { function: source, source, line: null, column: null }; }
function localSource(url, appRoot, processType) {
  try {
    if (!url || url.length > 8192) return null;
    if (processType === "renderer") {
      // Renderer script origins are fixed. Encoded paths, credentials and parameters are not trusted.
      if (url.includes("%")) return null;
      const parsed = new URL(url);
      if (parsed.username || parsed.password || parsed.search || parsed.hash) return null;
      const pathname = parsed.pathname;
      if (url.includes("/../") || url.includes("/./")) return null;
      const packaged = parsed.protocol === "louvorja:" && parsed.hostname === "app" && !parsed.port && /^\/assets\/[a-z\d_.-]+\.js$/i.test(pathname);
      const dev = ["http:", "https:"].includes(parsed.protocol) && parsed.hostname === "localhost" && parsed.port === "5002" && /^\/(?:src|assets)\/[a-z\d_./-]+$/i.test(pathname);
      const relative = pathname.slice(1);
      return (packaged || dev) && sourceValid(relative) ? relative : null;
    }
    const windows = /^[a-z]:[\\/]/i.test(appRoot) || appRoot.startsWith("\\\\");
    const paths = windows ? path.win32 : path.posix;
    if (!paths.isAbsolute(appRoot)) return null;
    let filename = url;
    if (/^file:/i.test(url)) {
      const parsed = new URL(url);
      if (parsed.username || parsed.password || parsed.search || parsed.hash || (parsed.hostname && parsed.hostname !== "localhost")) return null;
      filename = decodeURIComponent(parsed.pathname);
      if (windows && /^\/[a-z]:\//i.test(filename)) filename = filename.slice(1);
    } else if (url.includes("?") || url.includes("#")) return null;
    if (!paths.isAbsolute(filename)) return null;
    const relative = paths.relative(paths.resolve(appRoot), paths.resolve(filename)).replace(/\\/g, "/");
    return sourceValid(relative) && !CONSTANT_SOURCES.has(relative) ? relative : null;
  } catch { return null; }
}
function frameFor(callFrame, options) {
  const name = callFrame.functionName;
  if (!callFrame.url && SPECIAL.has(name)) return { category: SPECIAL.get(name), frame: null };
  if (!callFrame.url && name === "(root)") return { category: "root", frame: null };
  if (evalLabel(name)) return { category: "unattributed", frame: constantFrame("unknown") };
  const source = localSource(callFrame.url, options.appRoot, options.processType);
  if (!source) return { category: "unattributed", frame: constantFrame(callFrame.url ? "external" : name ? "native" : "unknown") };
  const label = Array.from(name).filter((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) <= 126).join("").slice(0, 120).trim() || "(anonymous)";
  return { category: "app", frame: { function: label, source,
    line: callFrame.lineNumber < 0 ? null : callFrame.lineNumber + 1,
    column: callFrame.columnNumber < 0 ? null : callFrame.columnNumber + 1 } };
}
function toMilliseconds(microseconds) { return microseconds / 1000; }
function hottest(a, b) { return b.time - a.time || b.count - a.count || a.key.localeCompare(b.key); }

/** CDP timeDeltas measure sampled elapsed time in microseconds, not real CPU usage. */
function summarizeCpuProfile(profile, options = {}) {
  try {
    if (!object(profile) || !object(options) || !["main", "renderer"].includes(options.processType) || typeof options.appRoot !== "string" || !options.appRoot || options.appRoot.length > 8192) return null;
    if (!Array.isArray(profile.nodes) || profile.nodes.length < 1 || profile.nodes.length > MAX_NODES || !Array.isArray(profile.samples) ||
        !Array.isArray(profile.timeDeltas) || !count(profile.samples.length, MAX_SAMPLES) || profile.samples.length !== profile.timeDeltas.length ||
        !numeric(profile.startTime) || !numeric(profile.endTime) || profile.endTime <= profile.startTime) return null;
    const nodes = new Map(), parents = new Map();
    for (const node of profile.nodes) {
      const call = node?.callFrame;
      if (!object(node) || !count(node.id, Number.MAX_SAFE_INTEGER) || nodes.has(node.id) || !object(call) || typeof call.functionName !== "string" ||
          call.functionName.length > 8192 || typeof call.url !== "string" || call.url.length > 8192 || !Number.isSafeInteger(call.lineNumber) || call.lineNumber < -1 ||
          !Number.isSafeInteger(call.columnNumber) || call.columnNumber < -1 || (node.children !== undefined && (!Array.isArray(node.children) || node.children.length > MAX_NODES))) return null;
      nodes.set(node.id, { ...frameFor(call, options), children: node.children || [] });
    }
    for (const [id, node] of nodes) {
      for (const child of node.children) {
        if (!count(child, Number.MAX_SAFE_INTEGER) || !nodes.has(child) || parents.has(child)) return null;
        parents.set(child, id);
      }
    }
    // Validate cycles independently of sample coverage. Iterative, bounded by the node cap.
    const done = new Set();
    for (const id of nodes.keys()) {
      const chain = new Set();
      let current = id;
      while (current !== undefined && !done.has(current)) {
        if (chain.has(current)) return null;
        chain.add(current); current = parents.get(current);
      }
      for (const ancestor of chain) done.add(ancestor);
    }
    let total = 0;
    const times = { idle: 0, gc: 0, program: 0, unattributed: 0 };
    const frames = new Map(), stacks = new Map();
    for (let index = 0; index < profile.samples.length; index++) {
      const id = profile.samples[index], delta = profile.timeDeltas[index];
      if (!count(id, Number.MAX_SAFE_INTEGER) || !nodes.has(id) || !numeric(delta) || delta <= 0) return null;
      total += delta;
      if (!numeric(total) || total > profile.endTime - profile.startTime) return null;
      const node = nodes.get(id);
      if (node.category !== "app") times[node.category === "root" ? "unattributed" : node.category] += delta;
      if (!node.frame) continue;
      const key = JSON.stringify(node.frame);
      const frame = frames.get(key) || { key, frame: node.frame, count: 0, time: 0 };
      frame.count++; frame.time += delta; frames.set(key, frame);
      const callerFrames = [];
      let current = id;
      for (let depth = 0; current !== undefined && depth < 64; depth++, current = parents.get(current)) {
        const caller = nodes.get(current);
        if (!caller.frame || callerFrames.length >= 6) continue;
        // Nativos seguidos viram um quadro só. Um spawn do Node tem cinco deles e, sem
        // isso, ocupava os seis lugares e escondia a função do app que o chamou.
        const inner = callerFrames.at(-1);
        if (inner && CONSTANT_SOURCES.has(inner.source) && CONSTANT_SOURCES.has(caller.frame.source)) continue;
        callerFrames.push(caller.frame);
      }
      callerFrames.reverse();
      const stackKey = JSON.stringify(callerFrames);
      const stack = stacks.get(stackKey) || { key: stackKey, frames: callerFrames, count: 0, time: 0 };
      stack.count++; stack.time += delta; stacks.set(stackKey, stack);
    }
    const result = { sample_count: profile.samples.length, sampled_duration_ms: toMilliseconds(total),
      idle_ms: toMilliseconds(times.idle), gc_ms: toMilliseconds(times.gc), program_ms: toMilliseconds(times.program), unattributed_ms: toMilliseconds(times.unattributed),
      top_frames: [...frames.values()].sort(hottest).slice(0, 8).map((entry) => ({ ...entry.frame, sample_count: entry.count, self_sample_ms: toMilliseconds(entry.time) })),
      top_stacks: [...stacks.values()].sort(hottest).slice(0, 5).map((entry) => ({ sample_count: entry.count, sampled_ms: toMilliseconds(entry.time), frames: entry.frames })) };
    // Retain hottest leaves. Drop outer callers first when maximum labels exceed the byte budget.
    while (Buffer.byteLength(JSON.stringify(result), "utf8") > MAX_BYTES) {
      const longest = result.top_stacks.reduce((best, stack) => stack.frames.length > (best?.frames.length || 1) ? stack : best, null);
      if (longest) longest.frames.shift();
      else if (result.top_stacks.length) result.top_stacks.pop();
      else result.top_frames.pop();
    }
    return sanitizeCpuProfileSummary(result);
  } catch { return null; }
}

module.exports = { summarizeCpuProfile, sanitizeCpuProfileSummary };
