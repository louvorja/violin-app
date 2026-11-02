// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import path from "node:path";
import os from "node:os";
const require = createRequire(import.meta.url);
const fs = require("fs-extra");
const { assertProfileIdle } = require("../profileActivity.js");
let root, profile, bootstrap;
const local = { hostname: "church-computer", platform: "linux", currentPid: 1234 };
const errno = (code) => Object.assign(new Error(code), { code });

beforeEach(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "profile-activity-")));
  profile = path.join(root, "profile"); bootstrap = path.join(root, "bootstrap");
  await fs.ensureDir(profile); await fs.ensureDir(bootstrap);
});
afterEach(async () => { await fs.remove(root); });

async function lock(directory, text) { await fs.symlink(text, path.join(directory, "SingletonLock")); }

function expectBlocked(callback, code, reason) {
  try { callback(); throw new Error("Expected the guard to refuse migration"); }
  catch (error) { expect(error).toMatchObject({ code, reason }); }
}

describe("legacy Chromium profile activity guard", () => {
  it("reports absent markers without claiming the source is exclusively locked", () => {
    expect(assertProfileIdle(profile, local)).toEqual([{ directory: profile, state: "no-marker" }]);
  });

  it("blocks a live POSIX process using only signal 0", async () => {
    await lock(profile, "church-computer-5432");
    const probePid = vi.fn(() => true);
    expectBlocked(() => assertProfileIdle(profile, { ...local, probePid }), "PROFILE_IN_USE", "process-running");
    expect(probePid).toHaveBeenCalledExactlyOnceWith(5432, 0);
    expect(await fs.readlink(path.join(profile, "SingletonLock"))).toBe("church-computer-5432");
  });

  it("blocks EPERM instead of treating another user's process as missing", async () => {
    await lock(profile, "church-computer-5432");
    expectBlocked(() => assertProfileIdle(profile, { ...local, probePid: () => { throw errno("EPERM"); } }), "PROFILE_IN_USE", "process-inaccessible");
  });

  it("accepts only an ESRCH marker on the local host as stale and leaves it intact", async () => {
    await lock(profile, "church-computer-5432");
    expect(assertProfileIdle(profile, { ...local, probePid: () => { throw errno("ESRCH"); } })).toEqual([
      { directory: profile, state: "stale-marker", pid: 5432 },
    ]);
    expect(await fs.readlink(path.join(profile, "SingletonLock"))).toBe("church-computer-5432");
  });

  it("does not probe another host's PID locally", async () => {
    await lock(profile, "other-computer-5432");
    const probePid = vi.fn();
    expectBlocked(() => assertProfileIdle(profile, { ...local, probePid }), "PROFILE_STATE_UNKNOWN", "different-host");
    expect(probePid).not.toHaveBeenCalled();
  });

  it("accepts this process only in its already-owned bootstrap", async () => {
    await lock(bootstrap, "church-computer-1234");
    expect(assertProfileIdle(profile, { ...local, ownedBootstrapDir: bootstrap })).toEqual([
      { directory: profile, state: "no-marker" }, { directory: bootstrap, state: "owned-bootstrap" },
    ]);
    await lock(profile, "church-computer-1234");
    expectBlocked(() => assertProfileIdle(profile, { ...local, ownedBootstrapDir: bootstrap, probePid: () => true }), "PROFILE_IN_USE", "process-running");
  });

  it("inspects the bootstrap instead of trusting a caller-supplied path alone", async () => {
    await lock(bootstrap, "church-computer-5432");
    expectBlocked(() => assertProfileIdle(profile, { ...local, ownedBootstrapDir: bootstrap, probePid: () => true }), "PROFILE_IN_USE", "process-running");
  });

  it("blocks old regular macOS locks and partial singleton markers", async () => {
    await fs.outputFile(path.join(profile, "SingletonLock"), "");
    expectBlocked(() => assertProfileIdle(profile, { ...local, platform: "darwin" }), "PROFILE_STATE_UNKNOWN", "unsupported-singleton-marker");
    await fs.remove(path.join(profile, "SingletonLock"));
    await fs.symlink("/missing/socket", path.join(profile, "SingletonSocket"));
    expectBlocked(() => assertProfileIdle(profile, local), "PROFILE_STATE_UNKNOWN", "incomplete-singleton");
  });

  it("blocks malformed markers without sending any signal", async () => {
    await lock(profile, "church-computer-0");
    const probePid = vi.fn();
    expectBlocked(() => assertProfileIdle(profile, { ...local, probePid }), "PROFILE_STATE_UNKNOWN", "invalid-singleton-marker");
    expect(probePid).not.toHaveBeenCalled();
  });

  it("detects a singleton replacement while checking a stale PID", async () => {
    await lock(profile, "church-computer-5432");
    const probePid = () => {
      fs.unlinkSync(path.join(profile, "SingletonLock"));
      fs.symlinkSync("church-computer-5433", path.join(profile, "SingletonLock"));
      throw errno("ESRCH");
    };
    expectBlocked(() => assertProfileIdle(profile, { ...local, probePid }), "PROFILE_STATE_UNKNOWN", "marker-changed");
  });

  it("on Windows treats lowercase lockfile conservatively, without mistaking LevelDB LOCK for it", async () => {
    await fs.outputFile(path.join(profile, "IndexedDB", "origin", "LOCK"), "");
    expect(assertProfileIdle(profile, { platform: "win32" })[0].state).toBe("no-marker");
    await fs.outputFile(path.join(profile, "lockfile"), "");
    expectBlocked(() => assertProfileIdle(profile, { platform: "win32" }), "PROFILE_STATE_UNKNOWN", "windows-singleton-marker");
    await fs.remove(path.join(profile, "lockfile"));
    await fs.outputFile(path.join(bootstrap, "lockfile"), "");
    expect(assertProfileIdle(profile, { platform: "win32", ownedBootstrapDir: bootstrap })[1].state).toBe("owned-bootstrap");
  });
});
