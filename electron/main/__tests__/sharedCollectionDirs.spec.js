// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
const require = createRequire(import.meta.url);
const fs = require("fs-extra");
const helper = require("../sharedCollectionDirs.js");
const roots = [];

async function fixture() {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "lj-shared-dirs-")));
  roots.push(root);
  return root;
}
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.remove(root))); });

describe("permissões somente dos novos itens compartilhados", () => {
  it.skipIf(process.platform === "win32")("supera umask077 somente nos novos diretórios/arquivos; preserva existentes e perfil", async () => {
    const root = await fixture();
    const script = `
      const fs = require('fs-extra'), path = require('node:path');
      const h = require(process.argv[1]), root = process.argv[2];
      process.umask(0o077);
      const existing = path.join(root,'existing'), profile = path.join(root,'profile');
      fs.mkdirSync(existing,{mode:0o700}); fs.mkdirSync(profile,{mode:0o700});
      fs.writeFileSync(path.join(existing,'old'), 'old', {mode:0o600});
      h.ensureCollectionDirectorySync(path.join(existing,'Acervo','musics'),{shared:true});
      h.ensureCollectionDirectorySync(existing,{shared:true});
      const file = path.join(existing,'Acervo','musics','new');
      fs.writeFileSync(file,'new',{mode:0o600}); h.setNewCollectionFileModeSync(file,{shared:true});
      (async()=>{
        await h.ensureCollectionDirectory(path.join(existing,'Acervo','images'),{shared:true});
        const image = path.join(existing,'Acervo','images','new');
        fs.writeFileSync(image,'new',{mode:0o600}); await h.setNewCollectionFileMode(image,{shared:true});
        const mode = p => fs.statSync(p).mode & 0o777;
        process.stdout.write(JSON.stringify({existing:mode(existing),profile:mode(profile),old:mode(path.join(existing,'old')),
          acervo:mode(path.join(existing,'Acervo')),musics:mode(path.join(existing,'Acervo','musics')),
          images:mode(path.join(existing,'Acervo','images')),file:mode(file),image:mode(image),umask:process.umask()}));
      })().catch(error=>{console.error(error);process.exitCode=1;});
    `;
    const result = JSON.parse(execFileSync(process.execPath, ["-e", script, require.resolve("../sharedCollectionDirs.js"), root], { cwd: process.cwd(), encoding: "utf8" }));
    expect(result).toEqual({ existing: 0o700, profile: 0o700, old: 0o600,
      acervo: 0o777, musics: 0o777, images: 0o777, file: 0o644, image: 0o644, umask: 0o077 });
  });

  it.skipIf(process.platform === "win32")("não amplia permissões por symlink ou hardlink", async () => {
    const root = await fixture();
    const file = path.join(root, "private");
    await fs.writeFile(file, "private", { mode: 0o600 });
    const linked = path.join(root, "linked");
    await fs.link(file, linked);
    await expect(helper.setNewCollectionFileMode(linked, { shared: true })).rejects.toThrow("regular");
    expect(() => helper.setNewCollectionFileModeSync(linked, { shared: true })).toThrow("regular");
    const symlink = path.join(root, "symbolic");
    await fs.symlink(file, symlink);
    await expect(helper.setNewCollectionFileMode(symlink, { shared: true })).rejects.toThrow();
    expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
  });

  it("recusa criar subdiretórios através de um link ou fora da raiz", async () => {
    const root = await fixture();
    const outside = await fixture();
    await fs.symlink(outside, path.join(root, "alias"), "junction");
    await expect(helper.ensureCollectionSubdirectory(root, path.join(root, "alias", "nested"), { shared: true })).rejects.toThrow("inválido");
    await expect(helper.ensureCollectionSubdirectory(root, path.join(root, "..", "escape"), { shared: true })).rejects.toThrow("fora");
    expect(await fs.readdir(outside)).toEqual([]);
  });
});
