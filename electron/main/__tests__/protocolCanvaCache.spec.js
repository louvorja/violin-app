// @vitest-environment node
/**
 * Arquivo pessoal no endereço antigo × protocolo `louvorja://local`.
 *
 * O cache de export do Canva morava na pasta de dados única (`files/canva` na
 * beta.18, `<dados>/canva` antes) e agora vive no perfil privado. URLs guardadas
 * antes disso continuam apontando para o endereço velho — o `LJ_FILE_PROJECTION`
 * do telão é a que importa, porque é ele que reabre a última projeção.
 *
 * O contrato: o endereço antigo serve o arquivo que agora mora no perfil, e o
 * que não existe em lugar nenhum continua 404 (o fallback não pode virar um
 * "serve qualquer coisa").
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import fs from "fs-extra";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Path from "@/helpers/Path";

const require = createRequire(import.meta.url);
const root = fs.mkdtempSync(join(tmpdir(), "louvorja-protocol-canva-"));
const legacyRoot = join(root, "Documents", "LouvorJA Violin");
const profile = join(root, "AppData", "LouvorJA Violin", "profile");
const canvaAntigo = join(legacyRoot, "files", "canva");
const canvaNovo = join(profile, "canva");
const PDF = "%PDF-1.7\n%%EOF";
let handleRequest;

function stub(modulePath, exports) {
  const resolved = require.resolve(modulePath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

stub("electron", {
  protocol: {
    handle: (_scheme, handler) => {
      handleRequest = handler;
    },
  },
  app: { getAppPath: () => root },
});
stub("../paths.js", {
  dataDir: () => profile,
  filesDir: () => join(root, "Acervo"),
  canvaDir: () => canvaNovo,
  privatePathMappings: () => [
    { from: canvaAntigo, to: canvaNovo },
    { from: join(legacyRoot, "canva"), to: canvaNovo },
  ],
});
stub("../onlineVideo/index.js", { fileFor: () => null });

const protocol = require("../protocol.js");

describe("louvorja://local e o cache do Canva no endereço da beta.18", () => {
  beforeAll(async () => {
    await fs.outputFile(join(canvaNovo, "D1.pdf"), PDF);
    protocol.handle();
  });

  afterAll(() => {
    fs.removeSync(root);
  });

  it("serve o arquivo migrado quando o endereço antigo não existe mais", async () => {
    const resposta = await handleRequest(new Request(Path.local(join(canvaAntigo, "D1.pdf"))));

    expect(resposta.status).toBe(200);
    expect(await resposta.text()).toBe(PDF);
  });

  it("o endereço anterior à beta.18 também é servido do perfil", async () => {
    const resposta = await handleRequest(new Request(Path.local(join(legacyRoot, "canva", "D1.pdf"))));

    expect(resposta.status).toBe(200);
  });

  it("arquivo que não existe em nenhum endereço continua 404", async () => {
    const resposta = await handleRequest(new Request(Path.local(join(canvaAntigo, "nao-existe.pdf"))));

    expect(resposta.status).toBe(404);
  });

  it("a pasta antiga em si continua 404 — o fallback é para arquivos", async () => {
    const resposta = await handleRequest(new Request(Path.local(canvaAntigo)));

    /* Servir diretório viraria erro de stream (500); 404 é a resposta certa. */
    expect(resposta.status).toBe(404);
  });

  it("o endereço novo é servido normalmente, sem passar pelo fallback", async () => {
    const resposta = await handleRequest(new Request(Path.local(join(canvaNovo, "D1.pdf"))));

    expect(resposta.status).toBe(200);
    expect(await resposta.text()).toBe(PDF);
  });
});
