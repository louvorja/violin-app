// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createRequire } from "module";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const require = createRequire(import.meta.url);

const base = mkdtempSync(join(tmpdir(), "louvorja-resolver-"));
const NOSSA = join(base, "dados", "files");
const CLASSICA = join(base, "LouvorJA", "config");

// `paths` fala com o Electron, que não existe aqui. Substituí-lo no cache do
// require é o que permite exercitar o resolvedor de verdade — inclusive a
// regra que mais importa, e que nenhum teste puro alcançaria: para onde vai a
// ESCRITA quando existe uma segunda origem de leitura configurada.
const caminhoPaths = require.resolve("../paths.js");
require.cache[caminhoPaths] = {
  id: caminhoPaths,
  filename: caminhoPaths,
  loaded: true,
  exports: { filesDir: () => NOSSA },
};

const resolver = require("../mediaResolver.js");

describe("mediaResolver", () => {
  beforeAll(() => {
    mkdirSync(join(CLASSICA, "musicas", "Album"), { recursive: true });
    mkdirSync(join(CLASSICA, "capas"), { recursive: true });
    mkdirSync(join(NOSSA, "musics", "pt", "Album"), { recursive: true });
    writeFileSync(join(CLASSICA, "musicas", "Album", "Faixa.mp3"), "antigo");
    writeFileSync(join(CLASSICA, "capas", "10.bmp"), "capa antiga");
    writeFileSync(join(NOSSA, "musics", "pt", "Album", "Outra.opus"), "novo");
    resolver.setClassicRoot({ dir: CLASSICA, lang: "pt" });
  });

  afterAll(() => {
    resolver.clearClassicRoot();
    rmSync(base, { recursive: true, force: true });
  });

  it("lê o acervo antigo quando o catálogo pede o formato novo", async () => {
    const achado = await resolver.resolveRead("musics/pt/Album/Faixa.opus");
    expect(achado.origin).toBe("classic");
    expect(achado.path).toBe(join(CLASSICA, "musicas", "Album", "Faixa.mp3"));
  });

  it("a versão síncrona, usada pelo protocolo, chega ao mesmo lugar", () => {
    const achado = resolver.resolveReadSync("covers/10.jpg");
    expect(achado.origin).toBe("classic");
    expect(achado.path).toBe(join(CLASSICA, "capas", "10.bmp"));
  });

  it("ESCREVER nunca alcança a pasta do programa antigo", () => {
    // A garantia central: apagar ou sobrescrever lá destruiria o acervo de
    // quem ainda usa a versão clássica em paralelo.
    for (const rel of [
      "musics/pt/Album/Faixa.opus",
      "covers/10.jpg",
      "images/1.jpg",
      "qualquer/coisa.bin",
    ]) {
      const destino = resolver.resolveWrite(rel);
      expect(destino.startsWith(NOSSA)).toBe(true);
      expect(destino.includes(CLASSICA)).toBe(false);
    }
  });

  it("escrita recusa caminho que escaparia da pasta de dados", () => {
    expect(resolver.resolveWrite("../../fora.mp3")).toBe(null);
    expect(resolver.resolveWrite("")).toBe(null);
  });

  it("desligar a origem extra volta a apontar só para a nossa pasta", async () => {
    resolver.clearClassicRoot();
    expect(await resolver.resolveRead("musics/pt/Album/Faixa.opus")).toBe(null);
    expect(resolver.roots()).toHaveLength(1);
    resolver.setClassicRoot({ dir: CLASSICA, lang: "pt" });
  });

  it("o que é nosso continua sendo lido como nosso", async () => {
    const achado = await resolver.resolveRead("musics/pt/Album/Outra.opus");
    expect(achado.origin).toBe("own");
  });
});
