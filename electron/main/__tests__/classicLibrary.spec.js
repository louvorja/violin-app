// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createRequire } from "module";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const require = createRequire(import.meta.url);
const { validate, detectLanguage } = require("../classicLibrary.js");

/**
 * O usuário aponta a pasta da versão clássica na mão, e ninguém sabe de cor a
 * estrutura dela: uns escolhem a pasta do programa, outros o `config` de
 * dentro. Aceitar as duas é o que evita um "pasta inválida" para quem escolheu
 * certo — e no Wine, onde o palpite automático não funciona, apontar na mão é
 * o único caminho.
 */
describe("validate", () => {
  let base;

  beforeAll(() => {
    base = mkdtempSync(join(tmpdir(), "louvorja-classico-"));
    mkdirSync(join(base, "instalacao", "config", "musicas"), { recursive: true });
    writeFileSync(join(base, "instalacao", "config", "musicas", "faixa.mp3"), "x");
    mkdirSync(join(base, "vazia", "config", "musicas"), { recursive: true });
    mkdirSync(join(base, "so-banco", "config"), { recursive: true });
    writeFileSync(join(base, "so-banco", "config", "database.db"), "SQLite format 3\0");
    mkdirSync(join(base, "es", "config"), { recursive: true });
    writeFileSync(join(base, "es", "config", "database.db"), "SQLite format 3\0");
    writeFileSync(join(base, "es", "config", "configES.ja"), "lang=ES\n");
    writeFileSync(join(base, "es", "LoorJA.translate"), "_=ES\n");
  });

  afterAll(() => rmSync(base, { recursive: true, force: true }));

  it("aceita a raiz da instalação", () => {
    const r = validate(join(base, "instalacao"));
    expect(r.ok).toBe(true);
    expect(r.configDir).toBe(join(base, "instalacao", "config"));
    expect(r.folders.musicas).toBe(true);
  });

  it("aceita o próprio config, para quem já entrou nele", () => {
    const r = validate(join(base, "instalacao", "config"));
    expect(r.ok).toBe(true);
    expect(r.configDir).toBe(join(base, "instalacao", "config"));
  });

  it("recusa pasta com a estrutura mas sem arquivo nenhum", () => {
    // Pasta criada e nunca usada não é acervo: aceitar faria o app marcar
    // álbuns como disponíveis e falhar na hora de tocar.
    expect(validate(join(base, "vazia")).ok).toBe(false);
  });

  it("recusa caminho que não existe", () => {
    expect(validate(join(base, "nao-existe")).ok).toBe(false);
  });

  it("recusa caminho vazio", () => {
    expect(validate("").ok).toBe(false);
    expect(validate(null).ok).toBe(false);
  });

  it("aceita instalação que ainda baixou apenas o banco", () => {
    const r = validate(join(base, "so-banco"));
    expect(r.ok).toBe(true);
    expect(r.folders.database).toBe(true);
    expect(r.folders.musicas).toBe(false);
  });

  it("detecta o idioma pelo marcador da instalação selecionada", () => {
    expect(detectLanguage(join(base, "es"), join(base, "es", "config"))).toBe("es");
  });

  it("prioriza o arquivo .translate da instalação sobre configurações antigas", () => {
    writeFileSync(join(base, "es", "config", "configPT.ja"), "lang=PT\n");
    expect(detectLanguage(join(base, "es"), join(base, "es", "config"))).toBe("es");
  });
});
