// @vitest-environment node
import { afterAll, describe, expect, it } from "vitest";
import { createRequire } from "module";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const require = createRequire(import.meta.url);

/*
 * `paths` fala com o Electron, que não existe aqui: aponta a pasta de dados
 * para um temporário ANTES de qualquer require de canva/* — é o mesmo truque
 * de jsonCache.spec.js.
 */
const base = mkdtempSync(join(tmpdir(), "louvorja-canva-store-"));
const storageDir = join(base, "storage");

const caminhoPaths = require.resolve("../paths.js");
require.cache[caminhoPaths] = {
  id: caminhoPaths,
  filename: caminhoPaths,
  loaded: true,
  exports: { dataDir: () => base },
};

const box = require("../canva/crypto.js");
const store = require("../canva/store.js");

const SEGREDO = "SEGREDO-CANVA-NAO-DEVE-APARECER";
const REFRESH = "REFRESH-CANVA-TAMBEM-NAO-DEVE-APARECER";

afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

describe("cofre AES-256-GCM", () => {
  it("devolve o objeto original", () => {
    const dado = {
      clientId: "OC-1234-AbCdEf",
      clientSecret: "cnvca_segredo",
      token: { refresh_token: "agALL", expires_at: 1742099403 },
    };
    expect(box.decrypt(box.encrypt(dado))).toEqual(dado);
  });

  it("nunca deixa o segredo em texto claro no payload", () => {
    const payload = box.encrypt({ clientSecret: SEGREDO });
    expect(payload).toMatch(/^v1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
    expect(payload).not.toContain(SEGREDO);
    expect(payload).not.toContain("SEGREDO");
  });

  it("payload alterado vira null — o GCM autentica", () => {
    const [version, iv, tag, data] = box.encrypt({ a: 1 }).split(":");
    const bytes = Buffer.from(data, "base64");
    bytes[0] ^= 0xff;
    const alterado = [version, iv, tag, bytes.toString("base64")].join(":");
    expect(box.decrypt(alterado)).toBeNull();
  });

  it.each(["qualquer coisa", "v9:aa:bb:cc", "", "v1:aa:bb", null, undefined, 42])(
    "fora do formato vira null: %p",
    (payload) => expect(box.decrypt(payload)).toBeNull()
  );

  it("cria a chave com 64 hex e permissão 0600", () => {
    box.encrypt({ x: 1 });
    const file = box.keyFile();
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, "utf8").trim()).toMatch(/^[0-9a-f]{64}$/);
    if (process.platform !== "win32") {
      expect(statSync(file).mode & 0o777).toBe(0o600);
    }
  });
});

describe("cofre do store", () => {
  it("credenciais e token voltam intactos e o arquivo não tem texto puro", async () => {
    await store.setCredentials("OC-1", SEGREDO);
    await store.setToken({ access_token: "ACESSO", refresh_token: REFRESH, expires_at: 1742099403 });

    expect(store.getCredentials()).toEqual({ clientId: "OC-1", clientSecret: SEGREDO });
    expect(store.getToken()?.access_token).toBe("ACESSO");
    expect(store.getToken()?.refresh_token).toBe(REFRESH);

    const bruto = readFileSync(join(storageDir, `${store.STORE_KEY}.json`), "utf8");
    expect(bruto).toContain("aes-256-gcm");
    expect(bruto).not.toContain(SEGREDO);
    expect(bruto).not.toContain(REFRESH);
    expect(bruto).not.toContain("ACESSO");
  });

  it("no store, setCredentials mexe só nas credenciais — quem zera o token é o index", async () => {
    await store.clear();
    await store.setCredentials("OC-velho", "cnvca_antigo");
    await store.setToken({ access_token: "A", refresh_token: "R", expires_at: 1 });
    await store.setCredentials("OC-novo", "cnvca_novo");

    expect(store.getCredentials()).toEqual({ clientId: "OC-novo", clientSecret: "cnvca_novo" });
    expect(store.getToken()?.refresh_token).toBe("R");
  });

  it("integrity distingue 'nunca conectou' de 'arquivo ilegível'", async () => {
    await store.clear();
    expect(store.integrity()).toEqual({ present: false, readable: true });

    await store.setCredentials("OC-2", "cnvca_x");
    expect(store.integrity()).toEqual({ present: true, readable: true });
  });

  it("apagar o cofre não deixa resíduo", async () => {
    await store.setCredentials("OC-3", "cnvca_y");
    await store.clear();

    expect(store.getCredentials()).toBeNull();
    expect(store.getToken()).toBeNull();
    expect(existsSync(join(storageDir, `${store.STORE_KEY}.json`))).toBe(false);
  });

  it("chave ilegível não prende o usuário: regenera e deixa gravar de novo", async () => {
    await store.clear();
    await store.setCredentials("OC-9", "cnvca_z");
    expect(store.integrity()).toEqual({ present: true, readable: true });

    /* Gravação truncada do arquivo de chave. */
    box._reset();
    writeFileSync(box.keyFile(), "lixo", "utf8");

    /* O ciphertext antigo não decifra mais — é o esperado, não um bug. */
    expect(store.integrity()).toEqual({ present: true, readable: false });

    /* Sem a regeneração, gravar falharia para sempre na mesma chave ruim. */
    await store.setCredentials("OC-10", "cnvca_y");
    expect(store.getCredentials()).toEqual({ clientId: "OC-10", clientSecret: "cnvca_y" });
    expect(store.integrity()).toEqual({ present: true, readable: true });
  });
});
