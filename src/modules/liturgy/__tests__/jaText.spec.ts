// @vitest-environment node
import { describe, expect, it } from "vitest";
import { decodeJaText } from "../jaText";
import { parseJaImport } from "../composables/useLiturgyLibrary";

const bytes = (b: Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

describe("decodeJaText", () => {
  it("UTF-8 com BOM (clássico v26.7+): acentos certos e sem o BOM no texto", () => {
    const r = decodeJaText(bytes(Buffer.concat([BOM, Buffer.from("[Geral]\r\nitem=Oração", "utf8")])));
    expect(r.encoding).toBe("utf8-bom");
    expect(r.text.startsWith("[Geral]")).toBe(true);
    expect(r.text).toContain("Oração");
  });

  it("Windows-1252 sem BOM (clássico até v26.6)", () => {
    const r = decodeJaText(bytes(Buffer.from("item=Oração", "latin1")));
    expect(r).toEqual({ text: "item=Oração", encoding: "cp1252" });
  });

  it("só ASCII e UTF-8 sem BOM saem como UTF-8", () => {
    expect(decodeJaText(bytes(Buffer.from("[Geral]", "utf8"))).encoding).toBe("utf8");
    expect(decodeJaText(bytes(Buffer.from("item=Oração", "utf8")))).toEqual({
      text: "item=Oração",
      encoding: "utf8",
    });
  });
});

describe("parseJaImport com o BOM no texto", () => {
  it("acha a liturgia mesmo se o BOM não foi tirado antes", () => {
    const parsed = parseJaImport("\uFEFF[Geral]\r\n1=item_a;\r\n\r\n[item_a]\r\ntipo=anotacao\r\nitem=Oração\r\n");
    expect(parsed).toHaveLength(1);
    expect(parsed?.[0].items[0].item).toBe("Oração");
  });
});
