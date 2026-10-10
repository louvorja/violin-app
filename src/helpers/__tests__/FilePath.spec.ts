import { afterEach, describe, expect, it, vi } from "vitest";

const webUtils = { getPathForFile: vi.fn() };
vi.mock("@/helpers/Platform", () => ({
  default: {
    get webUtils() {
      return webUtils.getPathForFile.getMockImplementation() ? webUtils : null;
    },
  },
}));

import { localPathOf } from "@/helpers/FilePath";

describe("localPathOf", () => {
  afterEach(() => webUtils.getPathForFile.mockReset());

  it("usa webUtils no Electron 32+", () => {
    webUtils.getPathForFile.mockImplementation(() => "C:\\Sons\\a.mp3");
    expect(localPathOf(new File([""], "a.mp3"))).toBe("C:\\Sons\\a.mp3");
  });

  it("cai no File.path legado e, na web, devolve vazio", () => {
    webUtils.getPathForFile.mockImplementation(() => "");
    const legacy = Object.assign(new File([""], "a.mp3"), { path: "/x/a.mp3" });
    expect(localPathOf(legacy)).toBe("/x/a.mp3");
    expect(localPathOf(new File([""], "b.mp3"))).toBe("");
  });
});
