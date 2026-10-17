import { describe, expect, it } from "vitest";
import { classifyLocalEnvironmentError } from "@/helpers/LocalEnvironmentErrors";

const named = (name: string, message: string) => Object.assign(new Error(message), { name });

describe("classifyLocalEnvironmentError", () => {
  it.each([
    [new DOMException("could not be read", "NotReadableError"), "file_unreadable"],
    [new DOMException("quota", "QuotaExceededError"), "storage_full"],
    [
      named("UnknownError", "Internal error opening backing store for indexedDB.open."),
      "storage_unavailable",
    ],
    [named("UnknownError", "Internal error committing transaction."), "storage_unavailable"],
    [
      named("AbortError", "The transaction was aborted, so the request cannot be fulfilled."),
      "storage_unavailable",
    ],
  ])("reconhece %#", (error, kind) => {
    expect(classifyLocalEnvironmentError(error)).toBe(kind);
  });

  it.each([
    new TypeError("Cannot read properties of undefined"),
    named("NotFoundError", "object store not found"),
    named("AbortError", "The user aborted a request."),
    "texto solto",
    null,
  ])("não confunde defeito do código com ambiente: %#", (error) => {
    expect(classifyLocalEnvironmentError(error)).toBeNull();
  });
});
