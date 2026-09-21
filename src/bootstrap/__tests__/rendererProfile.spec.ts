import { describe, expect, it } from "vitest";
import { getRendererProfile, normalizeRendererPath } from "../rendererProfile";

function location(pathname = "/", hash = ""): Pick<Location, "hash" | "pathname"> {
  return { pathname, hash };
}

describe("rendererProfile", () => {
  it.each([
    ["/", "", "shell"],
    ["/ui", "", "shell"],
    ["/projection", "", "projection"],
    ["/projection/return", "", "projection"],
    ["/obs/bible", "", "projection"],
    ["/clock", "", "projection"],
    ["/remote", "", "auxiliary"],
    ["/operator", "", "auxiliary"],
    ["/popup", "", "auxiliary"],
    ["/", "#/projection/file?return=true", "projection"],
    ["/", "#/remote", "auxiliary"],
  ] as const)("classifica %s%s como %s", (pathname, hash, profile) => {
    expect(getRendererProfile(location(pathname, hash))).toBe(profile);
  });

  it("prioriza a rota hash quando o renderer usa hash history", () => {
    expect(normalizeRendererPath(location("/ignored", "#/obs/bible?source=browser"))).toBe(
      "/obs/bible"
    );
  });
});
