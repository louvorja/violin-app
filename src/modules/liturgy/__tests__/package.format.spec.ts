import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import {
  buildPackage,
  isZip,
  readPackage,
  safeFileName,
  safeZipPath,
  PACKAGE_FORMAT,
  type PackageFile,
} from "../package/format";
import type { LiturgyItem } from "@/types/Liturgy";

const file = (p: Partial<PackageFile> & Pick<PackageFile, "source" | "sourceId">): PackageFile => ({
  name: "foto.jpg",
  mime: "image/jpeg",
  data: new Blob(["IMG"], { type: "image/jpeg" }),
  ...p,
});

const items = [{ id: "a", tipo: "anotacao", item: "Boas-vindas" }] as unknown as LiturgyItem[];

describe("safeFileName", () => {
  it("mantém acentos e troca só o que o Windows não aceita", () => {
    expect(safeFileName("Culto de Sábado — Missão")).toBe("Culto de Sábado — Missão");
    expect(safeFileName('Culto 13/12: "Natal"?')).toBe("Culto 13_12_ _Natal__");
    expect(safeFileName("  Fim.  ")).toBe("Fim");
    expect(safeFileName("", "Liturgia")).toBe("Liturgia");
  });
});

describe("safeZipPath", () => {
  it("só aceita caminho relativo dentro da raiz", () => {
    expect(safeZipPath("files\\media\\a\\x.jpg", "files/")).toBe("files/media/a/x.jpg");
    expect(safeZipPath("files/../x", "files/")).toBeNull();
    expect(safeZipPath("/etc/passwd", "files/")).toBeNull();
    expect(safeZipPath("C:/x", "files/")).toBeNull();
    expect(safeZipPath("outra/x", "files/")).toBeNull();
  });
});

describe("pacote da liturgia", () => {
  it("ida e volta: manifesto, liturgia e um arquivo por origem", async () => {
    const blob = await buildPackage({
      liturgy: { name: "Culto de Sábado", color: "#AA0000", items },
      files: [
        file({ source: "media", sourceId: "file_1" }),
        // Mesma origem duas vezes: entra uma só.
        file({ source: "media", sourceId: "file_1" }),
        file({ source: "liturgy", sourceId: "ref-9", name: "hino.slja", mime: "" }),
        file({
          source: "background-sound",
          sourceId: "s1",
          name: "chuva.mp3",
          mime: "audio/mpeg",
          data: new Blob(["MP3"]),
        }),
      ],
      appVersion: "2.0.0",
    });
    expect(await isZip(blob)).toBe(true);

    const zip = await JSZip.loadAsync(blob);
    expect(Object.keys(zip.files).sort()).toEqual([
      "files/",
      "files/background-sound/",
      "files/background-sound/s1/",
      "files/background-sound/s1/chuva.mp3",
      "files/liturgy/",
      "files/liturgy/ref-9/",
      "files/liturgy/ref-9/hino.slja",
      "files/media/",
      "files/media/file_1/",
      "files/media/file_1/foto.jpg",
      "liturgy.json",
      "manifest.json",
    ]);

    const read = await readPackage(blob);
    expect(read?.ok).toBe(true);
    if (!read?.ok) return;
    expect(read.manifest).toMatchObject({
      format: PACKAGE_FORMAT,
      version: 1,
      appVersion: "2.0.0",
      liturgy: "liturgy.json",
    });
    expect(read.manifest.files).toEqual([
      {
        zipPath: "files/media/file_1/foto.jpg",
        source: "media",
        sourceId: "file_1",
        name: "foto.jpg",
        mime: "image/jpeg",
        size: 3,
      },
      expect.objectContaining({
        source: "liturgy",
        sourceId: "ref-9",
        mime: "application/octet-stream",
      }),
      expect.objectContaining({ source: "background-sound", sourceId: "s1", size: 3 }),
    ]);
    expect(JSON.parse(read.liturgyJson)).toEqual({
      name: "Culto de Sábado",
      color: "#AA0000",
      items,
    });
    expect(read.files.map((f) => `${f.source}:${f.sourceId}:${f.name}`)).toEqual([
      "media:file_1:foto.jpg",
      "liturgy:ref-9:hino.slja",
      "background-sound:s1:chuva.mp3",
    ]);
    expect(await read.files[0].data.text()).toBe("IMG");
  });

  it("ZIP sem manifest.json não é do Violin (pode ser do Classic)", async () => {
    const zip = new JSZip();
    zip.file("liturgia.json", "{}");
    expect(await readPackage(await zip.generateAsync({ type: "blob" }))).toBeNull();
  });

  it("não é ZIP", async () => {
    expect(await readPackage(new Blob(["{}"]))).toEqual({ ok: false, error: "not_zip" });
  });

  it("manifesto de outro formato (backup do banco, por exemplo) é recusado", async () => {
    const zip = new JSZip();
    zip.file("manifest.json", JSON.stringify({ format: "louvorja-backup", version: 1 }));
    expect(await readPackage(await zip.generateAsync({ type: "blob" }))).toEqual({
      ok: false,
      error: "not_liturgy",
    });
  });

  it("versão mais nova é recusada com motivo próprio", async () => {
    const zip = new JSZip();
    zip.file("manifest.json", JSON.stringify({ format: PACKAGE_FORMAT, version: 2 }));
    zip.file("liturgy.json", JSON.stringify({ name: "x", items: [] }));
    expect(await readPackage(await zip.generateAsync({ type: "blob" }))).toEqual({
      ok: false,
      error: "unsupported_version",
    });
  });

  it("só lê arquivos listados, de origem conhecida e dentro de files/", async () => {
    const zip = new JSZip();
    zip.file("segredo.txt", "x");
    zip.file("files/media/a/ok.jpg", "OK");
    zip.file("liturgy.json", JSON.stringify({ name: "x", items: [] }));
    zip.file(
      "manifest.json",
      JSON.stringify({
        format: PACKAGE_FORMAT,
        version: 1,
        liturgy: "liturgy.json",
        files: [
          { zipPath: "segredo.txt", source: "media", sourceId: "s", name: "s.txt" },
          { zipPath: "files/../segredo.txt", source: "media", sourceId: "t", name: "t.txt" },
          { zipPath: "files/media/a/ok.jpg", source: "outra", sourceId: "o", name: "o.jpg" },
          { zipPath: "files/media/a/ok.jpg", source: "media", sourceId: "a", name: "ok.jpg" },
        ],
      })
    );
    const read = await readPackage(await zip.generateAsync({ type: "blob" }));
    expect(read?.ok && read.files.map((f) => f.sourceId)).toEqual(["a"]);
  });

  it("liturgy.json fora do pacote (caminho que sobe de pasta) é inválido", async () => {
    const zip = new JSZip();
    zip.file(
      "manifest.json",
      JSON.stringify({ format: PACKAGE_FORMAT, version: 1, liturgy: "../liturgy.json", files: [] })
    );
    expect(await readPackage(await zip.generateAsync({ type: "blob" }))).toEqual({
      ok: false,
      error: "invalid",
    });
  });
});
