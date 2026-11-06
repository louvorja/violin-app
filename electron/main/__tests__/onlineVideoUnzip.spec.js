// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRequire } from "module";
import os from "os";
import path from "path";
import fs from "fs";
import JSZip from "jszip";

const require = createRequire(import.meta.url);
const { extractZip } = require("../onlineVideo/unzip.js");

let dir;
let zipFile;
let out;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "lj-unzip-"));
  zipFile = path.join(dir, "a.zip");
  out = path.join(dir, "out");
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

async function writeZip(build, { compression = "DEFLATE" } = {}) {
  const zip = new JSZip();
  build(zip);
  const buffer = await zip.generateAsync({ type: "nodebuffer", platform: "UNIX", compression });
  fs.writeFileSync(zipFile, buffer);
  return buffer;
}

describe("extractZip", () => {
  it("extrai arquivos comprimidos e armazenados, com pastas e permissão de execução", async () => {
    const big = "yt-dlp ".repeat(50_000);
    for (const compression of ["DEFLATE", "STORE"]) {
      fs.rmSync(out, { recursive: true, force: true });
      await writeZip(
        (zip) => {
          zip.file("yt-dlp_linux", "#!/bin/sh\necho 2026.10.29\n", { unixPermissions: 0o100755 });
          zip.folder("_internal");
          zip.file("_internal/base_library.zip", big, { unixPermissions: 0o100644 });
          zip.file("_internal/vazio.txt", "");
        },
        { compression }
      );
      const result = await extractZip(zipFile, out);
      expect(result.files).toBe(3);
      expect(fs.readFileSync(path.join(out, "_internal/base_library.zip"), "utf8")).toBe(big);
      expect(fs.readFileSync(path.join(out, "_internal/vazio.txt"), "utf8")).toBe("");
      if (process.platform !== "win32") {
        expect(fs.statSync(path.join(out, "yt-dlp_linux")).mode & 0o111).not.toBe(0);
      }
    }
  });

  it("recusa caminho que sai da pasta de destino", async () => {
    await writeZip((zip) => zip.file("../fora.txt", "x"));
    await expect(extractZip(zipFile, out)).rejects.toThrow(/caminho/);
    expect(fs.existsSync(path.join(dir, "fora.txt"))).toBe(false);
  });

  it("recusa link simbólico", async () => {
    await writeZip((zip) => zip.file("link", "/etc/passwd", { unixPermissions: 0o120777 }));
    await expect(extractZip(zipFile, out)).rejects.toThrow(/link simbólico/);
  });

  it("recusa conteúdo corrompido (CRC não confere)", async () => {
    const buffer = await writeZip((zip) => zip.file("a.txt", "conteudo-original"), { compression: "STORE" });
    const at = buffer.indexOf("conteudo-original");
    buffer[at] = "X".charCodeAt(0);
    fs.writeFileSync(zipFile, buffer);
    await expect(extractZip(zipFile, out)).rejects.toThrow(/corrompido/);
  });

  it("recusa zip truncado ou que nem é zip", async () => {
    const buffer = await writeZip((zip) => zip.file("a.txt", "abc"));
    fs.writeFileSync(zipFile, buffer.subarray(0, buffer.length - 30));
    await expect(extractZip(zipFile, out)).rejects.toThrow();
    fs.writeFileSync(zipFile, "isto não é um zip");
    await expect(extractZip(zipFile, out)).rejects.toThrow(/diretório central/);
  });

  it("para quando cancelado", async () => {
    await writeZip((zip) => zip.file("a.txt", "abc"));
    const controller = new AbortController();
    controller.abort();
    await expect(extractZip(zipFile, out, { signal: controller.signal })).rejects.toThrow(/cancelado/);
  });
});
