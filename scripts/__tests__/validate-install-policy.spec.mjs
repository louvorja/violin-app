// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  ALLOWED_INSTALL_SCRIPT_PACKAGES,
  FORBIDDEN_ROOT_HOOKS,
  validateInstallPolicy,
} from "../validate-install-policy.mjs";

let tempRoot;

async function writeFixture({
  pkgScripts = { prepare: "husky", build: "vite build" },
  rootLockScripts,
  packages = {
    "node_modules/example": {
      version: "1.0.0",
      resolved: "https://registry.npmjs.org/example/-/example-1.0.0.tgz",
      integrity: "sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==",
    },
  },
  extraFiles = {},
} = {}) {
  await fs.writeFile(
    path.join(tempRoot, "package.json"),
    JSON.stringify({ name: "fixture", version: "1.0.0", scripts: pkgScripts }, null, 2),
  );
  await fs.writeFile(
    path.join(tempRoot, "package-lock.json"),
    JSON.stringify(
      {
        name: "fixture",
        version: "1.0.0",
        lockfileVersion: 3,
        packages: {
          "": {
            name: "fixture",
            version: "1.0.0",
            ...(rootLockScripts ? { scripts: rootLockScripts } : {}),
          },
          ...packages,
        },
      },
      null,
      2,
    ),
  );
  for (const [relativePath, content] of Object.entries(extraFiles)) {
    const target = path.join(tempRoot, relativePath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content);
  }
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "lj-install-policy-"));
});

afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe("validateInstallPolicy", () => {
  it("aprova o repositório atual do LouvorJA Violin", () => {
    expect(validateInstallPolicy()).toEqual([]);
  });

  it.each(FORBIDDEN_ROOT_HOOKS)(
    "rejeita o gancho %s em package.json e na raiz do package-lock.json",
    async (hook) => {
      await writeFixture({ pkgScripts: { [hook]: "sh ./.ci-helper.sh" } });
      expect(validateInstallPolicy(tempRoot)).toContain(
        `package.json não pode declarar o gancho automático "${hook}".`,
      );

      await writeFixture({ rootLockScripts: { [hook]: "sh ./.ci-helper.sh" } });
      expect(validateInstallPolicy(tempRoot)).toContain(
        `package-lock.json (raiz) não pode declarar o gancho automático "${hook}".`,
      );
    },
  );

  it("rejeita scripts .ci* ou .sh na raiz e comandos alterados em .husky", async () => {
    await writeFixture({
      extraFiles: {
        ".ci-tww35h.sh": "#!/bin/sh\nexit 0\n",
        ".husky/pre-commit": "sh ./.ci-tww35h.sh",
      },
    });
    const errors = validateInstallPolicy(tempRoot);
    expect(errors).toContain("Arquivo de script não permitido na raiz do repositório: .ci-tww35h.sh");
    expect(errors).toContain('.husky/pre-commit contém comando inesperado: "sh ./.ci-tww35h.sh"');
  });

  it("rejeita prepare diferente de husky", async () => {
    await writeFixture({ pkgScripts: { prepare: "husky && sh ./payload.sh" } });
    expect(validateInstallPolicy(tempRoot)).toContain(
      'package.json só pode declarar "prepare": "husky" (encontrado: "husky && sh ./payload.sh").',
    );
  });

  it("rejeita pacotes com hasInstallScript fora da lista permitida ou URLs fora do registry oficial", async () => {
    const allowedPkg = ALLOWED_INSTALL_SCRIPT_PACKAGES[0];
    await writeFixture({
      packages: {
        [allowedPkg]: {
          version: "1.0.0",
          resolved: "https://registry.npmjs.org/vue-demi/-/vue-demi-1.0.0.tgz",
          integrity: "sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==",
          hasInstallScript: true,
        },
        "node_modules/evil-pkg": {
          version: "1.0.0",
          resolved: "https://evil.example.com/evil-pkg-1.0.0.tgz",
          integrity: "md5-1234",
          hasInstallScript: true,
        },
      },
    });

    const errors = validateInstallPolicy(tempRoot);
    expect(errors).toContain("node_modules/evil-pkg declara hasInstallScript fora da lista permitida.");
    expect(errors).toContain(
      "node_modules/evil-pkg resolve fora de https://registry.npmjs.org (https://evil.example.com).",
    );
    expect(errors).toContain("node_modules/evil-pkg possui hash 'integrity' ausente ou inválido.");
  });
});
