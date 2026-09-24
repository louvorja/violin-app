"use strict";

const fs = require("fs-extra");

/** Pastas modernas nunca são candidatas à migração de mídia legada. */
function listLegacyMediaEntries(dir) {
  try {
    if (!fs.statSync(dir).isDirectory()) return [];
    return fs.readdirSync(dir).filter((name) =>
      !["files", "storage", "library"].includes(name) && !name.startsWith(".")
    );
  } catch (_) {
    return [];
  }
}

module.exports = { listLegacyMediaEntries };
