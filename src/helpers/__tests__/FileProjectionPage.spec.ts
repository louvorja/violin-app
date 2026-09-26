import { describe, expect, it } from "vitest";
import { fileProjectionPageFor } from "@/helpers/FileProjectionPage";

describe("fileProjectionPageFor", () => {
  it("rejects a delayed page from a previous PDF", () => {
    expect(fileProjectionPageFor({ playback_id: "old", page: 8 }, "new")).toBeNull();
    expect(fileProjectionPageFor({ page: 8 }, "new")).toBeNull();
    expect(fileProjectionPageFor({ playback_id: "new", page: 2 }, "new")).toEqual({ page: 2 });
    expect(fileProjectionPageFor({ playback_id: "new", page: 2, source: "operator" }, "new"))
      .toEqual({ page: 2, source: "operator" });
  });

  it("rejects malformed page metadata", () => {
    expect(fileProjectionPageFor({ playback_id: "pdf", page: 0 }, "pdf")).toBeNull();
    expect(fileProjectionPageFor({ playback_id: "pdf", page: 2.5 }, "pdf")).toBeNull();
    expect(fileProjectionPageFor({ playback_id: "pdf", page: 2, totalPages: -1 }, "pdf")).toBeNull();
    expect(fileProjectionPageFor({ playback_id: "pdf", page: 2, source: "unknown" }, "pdf")).toBeNull();
  });
});
