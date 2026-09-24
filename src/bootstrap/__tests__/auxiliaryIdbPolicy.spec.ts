import { describe, expect, it } from "vitest";
import { requiresAuxiliaryIndexedDbBeforeMount } from "../auxiliaryIdbPolicy";

function location(pathname = "/", hash = ""): Pick<Location, "hash" | "pathname"> {
  return { pathname, hash };
}

describe("auxiliary IndexedDB route policy", () => {
  it.each([
    ["/projection", "", false],
    ["/projection/return", "", false],
    ["/obs", "", false],
    ["/obs/bible", "", false],
    ["/clock", "", false],
    ["/projection/bible", "", false],
    ["/projection/module", "", false],
    ["/projection/file", "", true],
    ["/projection/file/return", "", true],
    ["/projection/background_projection", "", true],
    ["/projection/background_projection/return", "", true],
    ["/projection/announcements", "", true],
    ["/ignored", "#/projection/file/return?resume=1", true],
  ] as const)("classifica %s%s", (pathname, hash, expected) => {
    expect(requiresAuxiliaryIndexedDbBeforeMount(location(pathname, hash))).toBe(expected);
  });
});
