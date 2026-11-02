import { describe, expect, it, vi } from "vitest";

// O macOS devolve o nome com o acento separado (NFD); o programa guarda junto (NFC).
const listDir = vi.fn(async (_dir: string) => ({
  ok: true,
  entries: [{ name: "Minuto Saúde".normalize("NFD") }, { name: "relogio.mp4" }],
}));
vi.mock("@/helpers/Platform", () => ({ default: { isDesktop: true, listDir } }));

const { missingPaths } = await import("../useReadiness");

describe("missingPaths", () => {
  it("pasta com acento existe, seja qual for a forma do acento", async () => {
    const missing = await missingPaths([
      "/igreja/Culto/Minuto Saúde".normalize("NFC"),
      "/igreja/Culto/relogio.mp4",
      "/igreja/Culto/Sermão",
    ]);
    expect(missing).toEqual(["/igreja/Culto/Sermão"]);
  });
});
