import { describe, expect, it } from "vitest";
import { useMediaMeta } from "../useMediaMeta";

describe("useMediaMeta", () => {
  // Os componentes desestruturam: um PDF num momento derrubava a lista do programa.
  it("thumbOf funciona desestruturado, também para arquivo sem miniatura", () => {
    const { thumbOf } = useMediaMeta();
    expect(thumbOf("/igreja/Anúncios/Sermão.pdf")).toBeUndefined();
    expect(thumbOf("/igreja/Anúncios/Sermão.pptx")).toBeUndefined();
  });
});
