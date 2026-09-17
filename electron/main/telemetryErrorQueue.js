"use strict";

const fs = require("fs-extra");

const MAX_ITEMS = 20;
const MAX_FIELD_LENGTH = 20_000;

function _safeString(value, fallback = "") {
  return typeof value === "string" ? value.slice(0, MAX_FIELD_LENGTH) : fallback;
}

function read(queuePath) {
  try {
    const value = fs.readJsonSync(queuePath);
    if (!Array.isArray(value)) return [];
    return value.filter((item) => item && typeof item === "object").slice(-MAX_ITEMS);
  } catch (_) {
    return [];
  }
}

function write(queuePath, items) {
  try {
    fs.ensureFileSync(queuePath);
    fs.writeJsonSync(queuePath, items.slice(-MAX_ITEMS), { spaces: 2 });
    return true;
  } catch (_) {
    return false;
  }
}

function enqueue(queuePath, payload) {
  const item = {
    id: _safeString(payload?.id),
    source: _safeString(payload?.source, "electron.main"),
    name: _safeString(payload?.name, "Error"),
    message: _safeString(payload?.message, "Erro não identificado"),
    stack: _safeString(payload?.stack) || undefined,
    at: _safeString(payload?.at, new Date().toISOString()),
  };
  if (!item.id) return false;
  return write(queuePath, [...read(queuePath), item]);
}

function acknowledge(queuePath, id) {
  if (typeof id !== "string" || !id) return false;
  const current = read(queuePath);
  const next = current.filter((item) => item.id !== id);
  if (next.length === current.length) return true;
  return write(queuePath, next);
}

module.exports = { read, enqueue, acknowledge };
