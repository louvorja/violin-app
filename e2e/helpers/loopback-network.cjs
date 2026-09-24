"use strict";
/* global require */

// Opt-in Electron test preload. Fail closed before Node creates an external
// HTTP socket, including requests made during application bootstrap.
for (const protocol of ["http", "https"]) {
  const client = require(`node:${protocol}`);
  for (const method of ["request", "get"]) {
    const original = client[method];
    client[method] = function (input, ...args) {
      const hostname = typeof input === "string" || input instanceof URL
        ? new URL(input).hostname
        : String(input?.hostname || input?.host || "localhost").replace(/:\d+$/, "");
      if (!["localhost", "127.0.0.1", "[::1]", "::1"].includes(hostname)) {
        throw new Error("External HTTP disabled by isolated download E2E");
      }
      return original.call(this, input, ...args);
    };
  }
}
