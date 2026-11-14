"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

// These markers belong to ProcessSingleton, not to individual LevelDB stores.
// https://chromium.googlesource.com/chromium/src/+/main/chrome/browser/process_singleton_posix.cc
// https://chromium.googlesource.com/chromium/src/+/main/chrome/browser/process_singleton_win.cc
// Electron captures userData when requestSingleInstanceLock() is called. Our
// previous versions took that lock in bootstrap, then changed userData to the
// data directory. A profile without these markers is NOT proof that it is idle.

function blocked(directory, reason, active = false, cause) {
  const error = new Error(
    `Não é seguro migrar o perfil antigo agora: ${directory}. Feche o LouvorJA nas outras contas e tente novamente. Os dados existentes foram preservados.`,
    cause ? { cause } : undefined
  );
  error.code = active ? "PROFILE_IN_USE" : "PROFILE_STATE_UNKNOWN";
  error.reason = reason;
  return error;
}

function statOptional(file) {
  try { return fs.lstatSync(file); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

function inspect(directory, { platform, hostname, currentPid, probePid, owned }) {
  let stat;
  try { stat = statOptional(directory); }
  catch (cause) { throw blocked(directory, "unreadable-directory", false, cause); }
  if (!stat) return { directory, state: "absent" };
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw blocked(directory, "invalid-directory");

  if (platform === "win32") {
    // Chromium opens this exact lowercase filename with DELETE_ON_CLOSE.
    // Its presence alone cannot distinguish an active handle from a copied
    // stale file; fail closed outside the bootstrap already held by the caller.
    // An ordinary IndexedDB/LevelDB `LOCK` file is intentionally not inspected.
    const marker = statOptional(path.join(directory, "lockfile"));
    if (marker) {
      if (!marker.isFile() || marker.isSymbolicLink()) throw blocked(directory, "invalid-singleton-marker");
      if (owned) return { directory, state: "owned-bootstrap" };
      throw blocked(directory, "windows-singleton-marker");
    }
    return { directory, state: "no-marker" };
  }

  const lockPath = path.join(directory, "SingletonLock");
  let lock;
  try { lock = statOptional(lockPath); }
  catch (cause) { throw blocked(directory, "unreadable-marker", false, cause); }
  if (!lock) {
    // A partial singleton can be another process starting or exiting. Do not
    // connect to its socket, send Chromium commands, remove it, or kill it.
    for (const name of ["SingletonSocket", "SingletonCookie"]) {
      if (statOptional(path.join(directory, name))) throw blocked(directory, "incomplete-singleton");
    }
    return { directory, state: "no-marker" };
  }
  // Older macOS versions used flock on a regular SingletonLock. Node does not
  // provide that native probe; its presence is inconclusive, never "stale".
  if (!lock.isSymbolicLink()) throw blocked(directory, "unsupported-singleton-marker");

  let target;
  try { target = fs.readlinkSync(lockPath); }
  catch (cause) { throw blocked(directory, "unreadable-marker", false, cause); }
  const parsed = /^([^/\\\r\n]+)-([1-9]\d*)$/.exec(target);
  const pid = parsed ? Number(parsed[2]) : NaN;
  if (!parsed || !Number.isSafeInteger(pid) || pid > 2147483647) throw blocked(directory, "invalid-singleton-marker");
  if (parsed[1] !== hostname) throw blocked(directory, "different-host");
  if (owned && pid === currentPid) return { directory, state: "owned-bootstrap" };

  try {
    probePid(pid, 0);
  } catch (cause) {
    if (cause.code === "ESRCH") {
      // Only a missing PID on this host is accepted as a stale POSIX marker.
      // Preserve it in the source; copying code may omit runtime lock files.
      if (fs.readlinkSync(lockPath) !== target) throw blocked(directory, "marker-changed");
      return { directory, state: "stale-marker", pid };
    }
    throw blocked(directory, cause.code === "EPERM" ? "process-inaccessible" : "probe-failed", cause.code === "EPERM", cause);
  }
  throw blocked(directory, "process-running", true);
}

/**
 * Refuse observed activity or ambiguous existing singleton markers before and
 * after a migration copy. This is a conservative guard, NOT an exclusive lock
 * on the source profile and NOT a transactional snapshot guarantee.
 *
 * ownedBootstrapDir must only be supplied after app.requestSingleInstanceLock()
 * returned true. The caller must still require other old instances to be closed
 * and detect source changes while copying before publishing the destination.
 */
function assertProfileIdle(profileDir, {
  ownedBootstrapDir = null,
  platform = process.platform,
  hostname = os.hostname(),
  currentPid = process.pid,
  probePid = process.kill.bind(process),
} = {}) {
  if (typeof profileDir !== "string" || !path.isAbsolute(profileDir) || profileDir.includes("\0")) {
    throw blocked(String(profileDir), "invalid-directory");
  }
  if (ownedBootstrapDir !== null && (typeof ownedBootstrapDir !== "string" || !path.isAbsolute(ownedBootstrapDir) || ownedBootstrapDir.includes("\0"))) {
    throw blocked(String(ownedBootstrapDir), "invalid-bootstrap");
  }
  const canonical = (directory) => {
    try { return fs.realpathSync(directory); }
    catch (error) { if (error.code === "ENOENT") return path.resolve(directory); throw error; }
  };
  const owned = ownedBootstrapDir ? canonical(ownedBootstrapDir) : null;
  const directories = new Set([profileDir, ...(ownedBootstrapDir ? [ownedBootstrapDir] : [])]);
  return [...directories].map((directory) => {
    try {
      return inspect(directory, {
        platform, hostname, currentPid, probePid, owned: owned !== null && canonical(directory) === owned,
      });
    } catch (cause) {
      if (cause.code === "PROFILE_IN_USE" || cause.code === "PROFILE_STATE_UNKNOWN") throw cause;
      throw blocked(directory, "unreadable-state", false, cause);
    }
  });
}

module.exports = { assertProfileIdle };
