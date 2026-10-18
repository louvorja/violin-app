// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import fs from "fs-extra";

const require = createRequire(import.meta.url);
const { rebaseJsonFiles } = require("../privatePathMigration.js");
let dir;
const mappings = [{ from: "/legacy/files/library/media", to: "/profile/attachments/media" }, { from: "/legacy/canva", to: "/profile/canva" }];
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "lj-private-json-")); });
afterEach(() => fs.removeSync(dir));

describe("referências privadas dos documentos e preferências", () => {
  it("reescreve só paths reconhecidos em user_data e library, usando destinos finais", () => {
    const prefs = path.join(dir, "storage", "user_data.json");
    const library = path.join(dir, "library", "slides", "1.json");
    fs.outputJsonSync(prefs, { options: { slides: { bg_image: "louvorja://local/legacy/files/library/media/image%20%231.jpg" } }, title: "/legacy/files/library/media/image.jpg", "modules.media.config.audio": "/legacy/files/library/media/music.mp3" });
    fs.outputJsonSync(library, { id: "1", path: "/legacy/canva/slides.pdf", url: "file:///legacy/files/library/media/image.jpg", children: [{ path: "/legacy/files/library/media-other/no.pdf" }, { path: "/other/private.pdf" }] });
    expect(rebaseJsonFiles(dir, mappings)).toBe(2);
    const updatedPrefs = fs.readJsonSync(prefs);
    expect(updatedPrefs.options.slides.bg_image).toBe("louvorja://local/profile/attachments/media/image%20%231.jpg");
    expect(updatedPrefs["modules.media.config.audio"]).toBe("/profile/attachments/media/music.mp3");
    expect(updatedPrefs.title).toBe("/legacy/files/library/media/image.jpg");
    expect(fs.readJsonSync(library)).toEqual({ id: "1", path: "/profile/canva/slides.pdf", url: "file:///profile/attachments/media/image.jpg", children: [{ path: "/legacy/files/library/media-other/no.pdf" }, { path: "/other/private.pdf" }] });
    expect(rebaseJsonFiles(dir, mappings)).toBe(0);
  });

  it("preserva bytes de JSON sem paths alterados, arquivos cifrados e itens fora das duas pastas", () => {
    const secret = path.join(dir, "storage", "canva_secrets.json");
    const original = '{  "encrypted": "opaque:abc==", "value": "/legacy/canva/not-a-path-field" }\n';
    fs.outputFileSync(secret, original);
    fs.outputJsonSync(path.join(dir, "json_db", "catalog.json"), { path: "/legacy/canva/catalog" });
    fs.outputFileSync(path.join(dir, "storage", "attachment.bin"), Buffer.from([0, 255, 128]));
    expect(rebaseJsonFiles(dir, mappings)).toBe(0);
    expect(fs.readFileSync(secret, "utf8")).toBe(original);
    expect(fs.readJsonSync(path.join(dir, "json_db", "catalog.json")).path).toBe("/legacy/canva/catalog");
    expect([...fs.readFileSync(path.join(dir, "storage", "attachment.bin"))]).toEqual([0, 255, 128]);
  });

  it("trata caminhos Windows com caixa distinta e mantém campos fora do prefixo", () => {
    const file = path.join(dir, "storage", "user_data.json");
    fs.outputJsonSync(file, { path: "d:\\old\\media\\a.pdf", dir: "D:\\old\\media-extra" });
    rebaseJsonFiles(dir, [{ from: "D:\\Old\\media", to: "C:\\User\\private" }]);
    expect(fs.readJsonSync(file)).toEqual({ path: "C:\\User\\private\\a.pdf", dir: "D:\\old\\media-extra" });
  });

  it("aborta ao encontrar JSON corrompido sem modificar seu conteúdo", () => {
    const file = path.join(dir, "library", "broken.json");
    fs.outputFileSync(file, '{"id":');
    expect(() => rebaseJsonFiles(dir, mappings)).toThrow();
    expect(fs.readFileSync(file, "utf8")).toBe('{"id":');
    expect(fs.readdirSync(path.dirname(file))).toEqual(["broken.json"]);
  });

  it.skipIf(process.platform === "win32")("recusa links para não alterar documentos fora da cópia privada", () => {
    const outside = path.join(dir, "outside.json");
    fs.outputJsonSync(outside, { path: "/legacy/canva/personal.pdf" });
    fs.ensureDirSync(path.join(dir, "library"));
    fs.symlinkSync(outside, path.join(dir, "library", "linked.json"));
    expect(() => rebaseJsonFiles(dir, mappings)).toThrow(/link/);
    expect(fs.readJsonSync(outside).path).toBe("/legacy/canva/personal.pdf");
  });
});
