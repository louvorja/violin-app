// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const project = fileURLToPath(new URL("../../", import.meta.url));
const hook = fs.readFileSync(path.join(project, "build/linux-after-install.sh"), "utf8");
const provisioning = hook.split("# BEGIN electron-builder default after-install")[0];
let temporary, base, media, bin, script, calls;

// Executa somente o provisionamento, em uma árvore temporária. Comandos Linux
// ausentes no macOS são simulados; estes testes não validam o kernel/ACL real.
const commandShim = `#!${process.execPath}
const fs = require('node:fs'), path = require('node:path');
const command = path.basename(process.argv[1]), args = process.argv.slice(2);
const file = args.at(-1);
if (command === 'id') console.log(process.env.LJ_TEST_UID || '0');
if (command === 'stat') {
  const stat = fs.statSync(file);
  console.log(args[1] === '%u' ? (file === process.env.LJ_TEST_UNTRUSTED ? '1000' : '0') : (stat.mode & 0o7777).toString(8));
}
if (command === 'setfacl') {
  fs.appendFileSync(process.env.LJ_TEST_CALLS, JSON.stringify(args) + '\\n');
  if (process.env.LJ_TEST_ACL_FAIL) process.exit(1);
  fs.chmodSync(file, 0o777);
}
if (command === 'mv') {
  const from = args.at(-2), to = args.at(-1);
  if (!fs.existsSync(to)) fs.renameSync(from, to);
}
`;

beforeEach(() => {
  temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lj-linux-package-")));
  base = path.join(temporary, "var/lib/louvorja-violin");
  media = path.join(base, "acervo");
  bin = path.join(temporary, "bin");
  calls = path.join(temporary, "acl-calls");
  fs.mkdirSync(path.join(temporary, "var/lib"), { recursive: true, mode: 0o755 });
  fs.mkdirSync(bin);
  for (const command of ["id", "stat", "setfacl", "mv"]) {
    fs.writeFileSync(path.join(bin, command), commandShim, { mode: 0o755 });
  }
  script = path.join(temporary, "provision.sh");
  fs.writeFileSync(script, provisioning.replaceAll("'/var", `'${temporary}/var`));
});
afterEach(() => fs.rmSync(temporary, { recursive: true, force: true }));

function run(env = {}) {
  return spawnSync("bash", [script], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, LJ_TEST_CALLS: calls, ...env },
  });
}

describe.skipIf(process.platform === "win32")("Linux package collection provisioning", () => {
  it("creates only the shared collection with inheritable write permissions", () => {
    expect(run().status).toBe(0);
    expect(fs.readdirSync(base)).toEqual(["acervo"]);
    expect(fs.statSync(base).mode & 0o777).toBe(0o755);
    expect(fs.statSync(media).mode & 0o777).toBe(0o777);
    const [args] = fs.readFileSync(calls, "utf8").trim().split("\n").map(JSON.parse);
    expect(args.slice(0, 3)).toEqual(["-m", "u::rwx,g::rwx,o::rwx,d:u::rwx,d:g::rwx,d:o::rwx", "--"]);
    expect(args[3]).toMatch(/\/\.acervo-install\.[^/]+\/acervo$/);
  });

  it("preserves an existing collection, contents and administrator permissions on reinstall", () => {
    fs.mkdirSync(media, { recursive: true });
    fs.chmodSync(base, 0o755);
    fs.chmodSync(media, 0o750);
    fs.writeFileSync(path.join(media, "existing-song.opus"), "original");
    expect(run().status).toBe(0);
    expect(fs.statSync(media).mode & 0o777).toBe(0o750);
    expect(fs.readFileSync(path.join(media, "existing-song.opus"), "utf8")).toBe("original");
    expect(fs.existsSync(calls)).toBe(false);
  });

  it.each(["base", "media"])("does not follow an existing %s symlink", (kind) => {
    const other = path.join(temporary, "private-profile");
    fs.mkdirSync(other);
    fs.mkdirSync(base, { recursive: true });
    if (kind === "base") fs.rmdirSync(base);
    fs.symlinkSync(other, kind === "base" ? base : media, "dir");
    expect(run().stderr).toContain("pastas existentes foram preservadas");
    expect(fs.readdirSync(other)).toEqual([]);
    expect(fs.existsSync(calls)).toBe(false);
  });

  it("refuses an ancestor writable by another user without changing it", () => {
    fs.mkdirSync(base, { mode: 0o777 });
    fs.chmodSync(base, 0o777);
    expect(run().stderr).toContain("pastas existentes foram preservadas");
    expect(fs.statSync(base).mode & 0o777).toBe(0o777);
    expect(fs.existsSync(media)).toBe(false);
  });

  it("refuses an ancestor owned by another account", () => {
    fs.mkdirSync(base, { mode: 0o755 });
    expect(run({ LJ_TEST_UNTRUSTED: base }).stderr).toContain("pastas existentes foram preservadas");
    expect(fs.existsSync(media)).toBe(false);
  });

  it("does not publish a half-configured collection when ACL creation fails", () => {
    expect(run({ LJ_TEST_ACL_FAIL: "1" }).stderr).toContain("pastas existentes foram preservadas");
    expect(fs.readdirSync(base)).toEqual([]);
    expect(run().status).toBe(0);
    expect(fs.existsSync(media)).toBe(true);
  });

  it("never provisions directories when invoked without root", () => {
    expect(run({ LJ_TEST_UID: "1000" }).status).toBe(1);
    expect(fs.existsSync(base)).toBe(false);
  });
});

describe("Linux package configuration", () => {
  it("retains upstream alternatives, sandbox and AppArmor installation behavior", () => {
    const upstream = fs.readFileSync(path.join(project, "node_modules/app-builder-lib/templates/linux/after-install.tpl"), "utf8");
    expect(hook.endsWith(upstream)).toBe(true);
  });

  it("adds ACL only to DEB/RPM and leaves uninstall and AppImage hooks untouched", () => {
    const config = yaml.load(fs.readFileSync(path.join(project, "electron-builder.yml"), "utf8"));
    for (const target of [config.deb, config.rpm]) {
      expect(target.afterInstall).toBe("build/linux-after-install.sh");
      expect(target.fpm).toContain("--depends=acl");
      expect(target.depends).toBeUndefined();
      expect(target.afterRemove).toBeUndefined();
    }
    expect(config.linux.afterRemove).toBeUndefined();
    expect(config.appImage.afterInstall).toBeUndefined();
  });
});
